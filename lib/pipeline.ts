import { getRecentPostTopics, logTopicDecision } from '@/lib/db';
import type { DiscoveredTopic } from '@/lib/discovery';
import { judgeTopic, type TopicJudgment } from '@/lib/judgment';

/**
 * How many previously published topics to show the judgment call. The novelty
 * standard is only as good as this window: anything older is invisible to it.
 */
export const RECENT_TOPICS_LIMIT = 20;

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
 * Judge candidates and record every decision in topic_log, so the next cycle's
 * novelty check can see what this one covered.
 */
export async function judgeAndLogTopicsForAgent(
  agentId: string,
  candidates: DiscoveredTopic[]
): Promise<TopicJudgment[]> {
  const judgments = await judgeTopicsForAgent(agentId, candidates);

  for (const judgment of judgments) {
    await logTopicDecision({
      agent_id: agentId,
      topic: judgment.topic,
      decision: judgment.decision,
      reason: judgment.reason,
    });
  }

  return judgments;
}
