import {
  getJudgedTopics,
  getRecentPostTopics,
  logTopicDecision,
} from '@/lib/db';
import { titleMatchKey, type DiscoveredTopic } from '@/lib/discovery';
import { judgeTopic, type TopicJudgment } from '@/lib/judgment';

/**
 * How many previously published topics to show the judgment call. The novelty
 * standard is only as good as this window: anything older is invisible to it.
 */
export const RECENT_TOPICS_LIMIT = 10;

/** Reason recorded for candidates skipped by the pre-judgment duplicate check. */
export const DUPLICATE_REASON =
  'duplicate candidate — already judged, skipped re-evaluation';

export type JudgeCycleResult = {
  judgments: TopicJudgment[];
  /** Candidates skipped before the model call because they were already judged. */
  duplicatesSkipped: number;
  /** Candidates actually sent to the model. */
  sentToJudgment: number;
};

/**
 * Judge candidates for one agent, with that agent's recently published topics
 * loaded from topic_log and passed in.
 *
 * This is the only place judgment should be invoked from. Calling judgeTopic
 * directly skips the recent-topics lookup, which silently disables the novelty
 * standard — the model has no other way to know what has already been covered.
 *
 * Candidates already present in topic_log never reach the model. Discovery
 * resurfaces the same stories every cycle, and judgment reliably rejected them
 * again for novelty — paying full token cost to re-derive a settled answer,
 * and crowding out candidates that had never been seen. They are logged
 * straight to topic_log as rejected instead.
 */
export async function judgeTopicsForAgent(
  agentId: string,
  candidates: DiscoveredTopic[]
): Promise<JudgeCycleResult> {
  if (candidates.length === 0) {
    return { judgments: [], duplicatesSkipped: 0, sentToJudgment: 0 };
  }

  const alreadyJudged = new Set(
    (await getJudgedTopics(agentId)).map(titleMatchKey)
  );

  const fresh: DiscoveredTopic[] = [];
  const duplicates: DiscoveredTopic[] = [];
  for (const candidate of candidates) {
    if (alreadyJudged.has(titleMatchKey(candidate.title))) {
      duplicates.push(candidate);
    } else {
      fresh.push(candidate);
    }
  }

  for (const duplicate of duplicates) {
    await logTopicDecision({
      agent_id: agentId,
      topic: duplicate.title,
      decision: 'rejected',
      reason: DUPLICATE_REASON,
    });
  }

  // Every candidate was a repeat: skip the model call altogether.
  if (fresh.length === 0) {
    return {
      judgments: [],
      duplicatesSkipped: duplicates.length,
      sentToJudgment: 0,
    };
  }

  const recentTopics = await getRecentPostTopics(agentId, RECENT_TOPICS_LIMIT);

  return {
    judgments: await judgeTopic(fresh, recentTopics),
    duplicatesSkipped: duplicates.length,
    sentToJudgment: fresh.length,
  };
}

/**
 * Record the topics judgment turned down, preserving its own reasoning.
 *
 * Approved topics are deliberately NOT logged here. A topic only counts as
 * published once a post actually exists for it — see logPublished /
 * logNotPublished, which the caller invokes after attempting the write.
 */
export async function logJudgmentRejections(
  agentId: string,
  judgments: TopicJudgment[]
): Promise<void> {
  for (const judgment of judgments) {
    if (judgment.decision !== 'rejected') continue;
    await logTopicDecision({
      agent_id: agentId,
      topic: judgment.topic,
      decision: 'rejected',
      reason: judgment.reason,
    });
  }
}

/** Record a topic that was approved AND successfully written to posts. */
export async function logPublished(
  agentId: string,
  topic: string,
  reason: string
): Promise<void> {
  await logTopicDecision({
    agent_id: agentId,
    topic,
    decision: 'published',
    reason,
  });
}

/**
 * Record a topic judgment approved but that never became a post — hit the
 * pacing cap, or failed at the write step.
 *
 * Logged as 'rejected' so the novelty check does not treat it as covered: no
 * reader ever saw it, so it must stay eligible for a later cycle. The reason
 * carries the real cause, keeping the audit trail honest.
 */
export async function logNotPublished(
  agentId: string,
  topic: string,
  reason: string
): Promise<void> {
  await logTopicDecision({
    agent_id: agentId,
    topic,
    decision: 'rejected',
    reason,
  });
}
