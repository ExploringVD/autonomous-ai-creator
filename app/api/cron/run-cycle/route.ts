import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getAllAgents, insertPost } from '@/lib/db';
import { discoverTopics, type DiscoveredTopic } from '@/lib/discovery';
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

type AgentSummary = {
  agentId: string;
  name: string;
  domain: string;
  candidatesDiscovered: number;
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
    const agents = await getAllAgents();
    const summaries: AgentSummary[] = [];

    for (const agent of agents) {
      const summary: AgentSummary = {
        agentId: agent.id,
        name: agent.name,
        domain: agent.domain,
        candidatesDiscovered: 0,
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

        const judgments = await judgeTopicsForAgent(agent.id, candidates);
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
        summary.errors.push(
          error instanceof Error ? error.message : String(error)
        );
      }

      summaries.push(summary);
    }

    return NextResponse.json({
      agentsProcessed: summaries.length,
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
