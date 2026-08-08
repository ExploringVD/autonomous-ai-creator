import { getRecentPostTopics, logTopicDecision } from '@/lib/db';
import type { DiscoveredTopic } from '@/lib/discovery';
import { judgeTopic, type TopicJudgment } from '@/lib/judgment';

/**
 * How many previously published topics to show the judgment call. The novelty
 * standard is only as good as this window: anything older is invisible to it.
 */
export const RECENT_TOPICS_LIMIT = 10;

/**
 * Judge candidates for one agent, with that agent's recently published topics
 * loaded from topic_log and passed in.
 *
 * This is the only place judgment should be invoked from. Calling judgeTopic
 * directly skips the recent-topics lookup, which silently disables the novelty
 * standard — the model has no other way to know what has already been covered.
 */
export async function judgeTopicsForAgent(
  agentId: string,
  candidates: DiscoveredTopic[]
): Promise<TopicJudgment[]> {
  if (candidates.length === 0) return [];

  const recentTopics = await getRecentPostTopics(agentId, RECENT_TOPICS_LIMIT);

  return judgeTopic(candidates, recentTopics);
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
