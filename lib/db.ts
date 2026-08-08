import { Pool, type QueryResultRow } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// Reuse the pool across hot reloads in dev, otherwise every edit leaks
// connections until the pooler starts refusing them.
const globalForPool = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPool.pgPool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPool.pgPool = pool;
}

export type Agent = {
  id: string;
  name: string;
  domain: string;
  persona_config: Record<string, unknown>;
  created_at: Date;
};

export type Post = {
  id: string;
  agent_id: string;
  text: string;
  rationale: string | null;
  sources: string[];
  created_at: Date;
};

export type TopicDecision = 'published' | 'rejected';

export type TopicLogEntry = {
  id: string;
  agent_id: string;
  topic: string;
  decision: TopicDecision;
  reason: string | null;
  created_at: Date;
};

async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function createAgent(input: {
  name: string;
  domain: string;
  persona_config?: Record<string, unknown>;
  id?: string;
}): Promise<Agent> {
  const rows = await query<Agent>(
    `INSERT INTO agents (id, name, domain, persona_config)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, domain, persona_config, created_at`,
    [input.id ?? uuidv4(), input.name, input.domain, input.persona_config ?? {}]
  );
  return rows[0];
}

/** Every agent, oldest first — the cron cycle iterates all of them. */
export async function getAllAgents(): Promise<Agent[]> {
  return query<Agent>(
    `SELECT id, name, domain, persona_config, created_at
     FROM agents
     ORDER BY created_at ASC`
  );
}

export async function getAgent(id: string): Promise<Agent | null> {
  const rows = await query<Agent>(
    `SELECT id, name, domain, persona_config, created_at
     FROM agents
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function insertPost(input: {
  id: string;
  agent_id: string;
  text: string;
  rationale?: string | null;
  sources?: string[];
}): Promise<Post> {
  const rows = await query<Post>(
    `INSERT INTO posts (id, agent_id, text, rationale, sources)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, agent_id, text, rationale, sources, created_at`,
    [
      input.id,
      input.agent_id,
      input.text,
      input.rationale ?? null,
      input.sources ?? [],
    ]
  );
  return rows[0];
}

export async function getPostsForAgent(agentId: string): Promise<Post[]> {
  return query<Post>(
    `SELECT id, agent_id, text, rationale, sources, created_at
     FROM posts
     WHERE agent_id = $1
     ORDER BY created_at DESC`,
    [agentId]
  );
}

export async function logTopicDecision(input: {
  agent_id: string;
  topic: string;
  decision: TopicDecision;
  reason?: string | null;
}): Promise<TopicLogEntry> {
  const rows = await query<TopicLogEntry>(
    `INSERT INTO topic_log (agent_id, topic, decision, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id, agent_id, topic, decision, reason, created_at`,
    [input.agent_id, input.topic, input.decision, input.reason ?? null]
  );
  return rows[0];
}

/**
 * Topics this agent actually published, newest first. Feeds the de-duplication
 * check in editorial judgment, so it reads from topic_log rather than posts:
 * only topic_log records what a post was *about*.
 */
export async function getRecentPostTopics(
  agentId: string,
  limit: number
): Promise<string[]> {
  const rows = await query<{ topic: string }>(
    `SELECT topic
     FROM topic_log
     WHERE agent_id = $1 AND decision = 'published'
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, limit]
  );
  return rows.map((row) => row.topic);
}
