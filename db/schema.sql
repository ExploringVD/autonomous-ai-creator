-- Schema for the autonomous AI creator.
--
-- RLS is enabled on every table with no policies attached. That denies all
-- access through Supabase's client-side (anon/authenticated) API, which this
-- project never uses. The server-side pg pool in lib/db.ts connects as the
-- table owner and is unaffected.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agents (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  domain         text NOT NULL,
  persona_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS posts (
  id         text PRIMARY KEY,
  agent_id   uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  text       text NOT NULL,
  rationale  text,
  sources    text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS topic_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  topic      text NOT NULL,
  decision   text NOT NULL CHECK (decision IN ('published', 'rejected')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE topic_log ENABLE ROW LEVEL SECURITY;

-- Supports getPostsForAgent (agent_id filter + created_at DESC ordering).
CREATE INDEX IF NOT EXISTS posts_agent_id_created_at_idx
  ON posts (agent_id, created_at DESC);

-- Supports getRecentPostTopics (published topics for one agent, newest first).
CREATE INDEX IF NOT EXISTS topic_log_agent_id_created_at_idx
  ON topic_log (agent_id, created_at DESC);
