-- Atrium core schema. Append-only event log + projections.

CREATE TABLE IF NOT EXISTS room (
  id            text PRIMARY KEY,
  key           text UNIQUE NOT NULL,
  name          text NOT NULL,
  objective     text NOT NULL,
  x int NOT NULL, y int NOT NULL, w int NOT NULL, h int NOT NULL,
  budget_cents    integer NOT NULL DEFAULT 0,
  spent_cents     integer NOT NULL DEFAULT 0,
  tool_grants     jsonb   NOT NULL DEFAULT '[]',
  approval_policy jsonb   NOT NULL DEFAULT '{"low":"auto","medium":"auto","high":"approve"}',
  db_role         text,
  status          text NOT NULL DEFAULT 'open'   -- open | halted | capped
);

CREATE TABLE IF NOT EXISTS agent (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL,
  policy_key text NOT NULL,
  state text NOT NULL DEFAULT 'idle',            -- idle|working|blocked|awaiting_approval|failed|killed
  activity text NOT NULL DEFAULT '',
  current_run_id text,
  step_budget integer NOT NULL DEFAULT 40,
  cost_budget_cents integer NOT NULL DEFAULT 200,
  steps_used integer NOT NULL DEFAULT 0,
  spent_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_room_idx ON agent(room_id);

CREATE TABLE IF NOT EXISTS run (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'running',        -- running|done|failed|killed|awaiting_approval
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  steps_used integer NOT NULL DEFAULT 0,
  spent_cents integer NOT NULL DEFAULT 0,
  kill_reason text,
  scratch jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS run_room_idx ON run(room_id, started_at DESC);

-- THE source of truth. Append-only; never UPDATE, never DELETE.
CREATE TABLE IF NOT EXISTS event (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  room_id text,
  agent_id text,
  run_id text,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS event_room_idx ON event(room_id, id DESC);
CREATE INDEX IF NOT EXISTS event_run_idx  ON event(run_id, id);

CREATE TABLE IF NOT EXISTS approval (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  run_id text NOT NULL,
  kind text NOT NULL DEFAULT 'approval',         -- approval | escalation
  action text NOT NULL,
  tool text,
  args jsonb NOT NULL DEFAULT '{}',
  blast_radius text NOT NULL DEFAULT 'high',
  est_cost_cents integer NOT NULL DEFAULT 0,
  run_spent_cents integer NOT NULL DEFAULT 0,
  touches jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'pending',         -- pending|approved|rejected|expired
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_note text,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS approval_pending_idx ON approval(state, est_cost_cents DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS artifact (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  run_id text,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  uri text,
  shared boolean NOT NULL DEFAULT false,         -- readable across rooms via artifact.read grant
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifact_room_idx ON artifact(room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory (
  room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, key)
);

CREATE TABLE IF NOT EXISTS ledger (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  room_id text NOT NULL,
  agent_id text,
  run_id text,
  cents integer NOT NULL,
  reason text NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_room_idx ON ledger(room_id, ts DESC);

CREATE TABLE IF NOT EXISTS observation_log (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  view text NOT NULL,                            -- floor | list
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'
);

-- marketing's real output queue
CREATE TABLE IF NOT EXISTS content_queue (
  id text PRIMARY KEY,
  room_id text NOT NULL,
  run_id text,
  channel text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'draft',           -- draft|approved|published
  created_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz
);

CREATE TABLE IF NOT EXISTS global_config (
  id int PRIMARY KEY DEFAULT 1,
  global_budget_cents integer NOT NULL DEFAULT 5000,
  global_spent_cents  integer NOT NULL DEFAULT 0,
  panic_stop boolean NOT NULL DEFAULT false,
  CHECK (id = 1)
);
INSERT INTO global_config (id) VALUES (1) ON CONFLICT DO NOTHING;
