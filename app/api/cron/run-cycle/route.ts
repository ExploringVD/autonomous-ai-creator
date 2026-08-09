import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllAgents, insertPost } from '@/lib/db';
import { discoverTopics, type DiscoveredTopic } from '@/lib/discovery';
import { JudgmentError } from '@/lib/judgment';
import {
  judgeTopicsForAgent,
  logJudgmentRejections,
  logNotPublished,
  logPublished,
} from '@/lib/pipeline';
import { writePost } from '@/lib/writer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Publishing budget per agent per cycle. Judgment may approve more than this;
 * the surplus is logged as not-published so it stays eligible next cycle rather
 * than queueing up for a burst.
 */
const MAX_POSTS_PER_CYCLE = 2;

/**
 * Agents the cron is allowed to spend judgment budget on, from CRON_AGENT_IDS
 * (comma-separated uuids).
 *
 * Without this the cycle judged every row in the agents table, and since
 * POST /api/agent/init creates a permanent agent, each click of the dashboard's
 * API tester permanently added one more agent's worth of Groq spend per cycle.
 * Six agents put the daily judgment cost at ~167k tokens against a 100k/day
 * limit, which exhausted the quota and made judgment silently return nothing.
 *
 * Unset means no allowlist and every agent runs — the previous behaviour, kept
 * so a local or fresh deployment still works without extra configuration.
 */
function allowedAgentIds(): Set<string> | null {
  const raw = process.env.CRON_AGENT_IDS?.trim();
  if (!raw) return null;

  const ids = raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : null;
}

type AgentSummary = {
  agentId: string;
  name: string;
  domain: string;
  candidatesDiscovered: number;
  duplicatesSkipped: number;
  sentToJudgment: number;
  topicsJudged: number;
  approved: number;
  attempted: number;
  published: number;
  failed: number;
  skippedByCap: number;
  errors: string[];
};

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Guard the misconfigured case explicitly: without this, an unset CRON_SECRET
  // would make a request with no header compare undefined === undefined.
  if (!secret) {
    console.error('run-cycle: CRON_SECRET is not set');
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const allowlist = allowedAgentIds();
    const allAgents = await getAllAgents();
    const agents = allowlist
      ? allAgents.filter((agent) => allowlist.has(agent.id.toLowerCase()))
      : allAgents;

    const summaries: AgentSummary[] = [];

    for (const agent of agents) {
      const summary: AgentSummary = {
        agentId: agent.id,
        name: agent.name,
        domain: agent.domain,
        candidatesDiscovered: 0,
        duplicatesSkipped: 0,
        sentToJudgment: 0,
        topicsJudged: 0,
        approved: 0,
        attempted: 0,
        published: 0,
        failed: 0,
        skippedByCap: 0,
        errors: [],
      };

      // One agent's failure must not stop the rest of the cycle.
      try {
        const candidates = await discoverTopics(agent.domain);
        summary.candidatesDiscovered = candidates.length;

        const judged = await judgeTopicsForAgent(agent.id, candidates);
        const judgments = judged.judgments;
        summary.duplicatesSkipped = judged.duplicatesSkipped;
        summary.sentToJudgment = judged.sentToJudgment;
        summary.topicsJudged = judgments.length;

        // Judgment's own rejections are final, so log them straight away.
        await logJudgmentRejections(agent.id, judgments);

        const approved = judgments.filter((j) => j.decision === 'published');
        summary.approved = approved.length;

        const byTitle = new Map<string, DiscoveredTopic>(
          candidates.map((c) => [c.title, c])
        );

        for (const judgment of approved.slice(0, MAX_POSTS_PER_CYCLE)) {
          summary.attempted += 1;

          const topic = byTitle.get(judgment.topic);
          if (!topic) {
            summary.failed += 1;
            summary.errors.push(
              `no candidate matched judged topic: ${judgment.topic}`
            );
            await logNotPublished(
              agent.id,
              judgment.topic,
              'approved by judgment but not published this cycle: no matching candidate found'
            );
            continue;
          }

          // writePost throws on ungrounded output by design — a failure here
          // must not cost the agent its remaining budget or the other agents.
          // Nothing is logged as published until insertPost has returned.
          try {
            const written = await writePost(topic, judgment.reason);
            await insertPost({
              id: uuidv4(),
              agent_id: agent.id,
              text: written.text,
              rationale: written.rationale,
              sources: written.sources,
            });
            summary.published += 1;
            await logPublished(agent.id, judgment.topic, judgment.reason);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            summary.failed += 1;
            summary.errors.push(message);
            await logNotPublished(
              agent.id,
              judgment.topic,
              `approved by judgment but write failed: ${message}`
            );
          }
        }

        // Anything approved beyond the per-cycle budget stays eligible for a
        // later cycle, so it must not be recorded as covered.
        for (const judgment of approved.slice(MAX_POSTS_PER_CYCLE)) {
          summary.skippedByCap += 1;
          await logNotPublished(
            agent.id,
            judgment.topic,
            'approved by judgment but not published this cycle: pacing cap'
          );
        }
      } catch (error) {
        // Label judgment failures so an exhausted quota is legible in the
        // summary itself. This used to surface as topicsJudged: 0 with an
        // empty errors array, which was indistinguishable from a quiet cycle.
        summary.errors.push(
          error instanceof JudgmentError
            ? `judgment failed (${error.cause}): ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error)
        );
      }

      summaries.push(summary);
    }

    return NextResponse.json({
      agentsProcessed: summaries.length,
      agentsSkippedByAllowlist: allAgents.length - agents.length,
      duplicatesSkipped: summaries.reduce((n, s) => n + s.duplicatesSkipped, 0),
      topicsJudged: summaries.reduce((n, s) => n + s.topicsJudged, 0),
      postsPublished: summaries.reduce((n, s) => n + s.published, 0),
      postsFailed: summaries.reduce((n, s) => n + s.failed, 0),
      skippedByCap: summaries.reduce((n, s) => n + s.skippedByCap, 0),
      agents: summaries,
    });
  } catch (error) {
    console.error('POST /api/cron/run-cycle failed:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
