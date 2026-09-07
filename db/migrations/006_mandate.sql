-- One sentence of human intent, as a row — and the tasks it decomposes into.
-- Events, approvals, artifacts and ledger lines already carry run_id, so they
-- inherit the mandate through the run. Nothing is added to them.

ALTER TABLE agent ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'worker';  -- manager | worker

CREATE TABLE IF NOT EXISTS mandate (
  id            text PRIMARY KEY,
  text          text NOT NULL,
  room_id       text REFERENCES room(id) ON DELETE SET NULL,
  state         text NOT NULL DEFAULT 'heard',   -- heard|routed|planned|working|blocked|done|recalled
  -- frozen from the room colour when it is routed, so re-colouring a room never
  -- re-colours work already in flight, and the client never computes a colour.
  color         text,
  quoted_cents  integer NOT NULL DEFAULT 0,
  spent_cents   integer NOT NULL DEFAULT 0,
  report        text NOT NULL DEFAULT '',
  artifact_id   text,
  context       jsonb NOT NULL DEFAULT '[]',     -- artifact ids carried across a redirect
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mandate_state_idx ON mandate(state, created_at DESC);

CREATE TABLE IF NOT EXISTS task (
  id          text PRIMARY KEY,
  mandate_id  text NOT NULL REFERENCES mandate(id) ON DELETE CASCADE,
  agent_id    text REFERENCES agent(id) ON DELETE SET NULL,
  run_id      text,
  title       text NOT NULL,
  state       text NOT NULL DEFAULT 'queued',    -- queued|working|done|failed|killed
  ord         integer NOT NULL DEFAULT 0,
  kill_reason text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_mandate_idx ON task(mandate_id, ord);
CREATE INDEX IF NOT EXISTS task_agent_idx ON task(agent_id, state);

ALTER TABLE run ADD COLUMN IF NOT EXISTS mandate_id text;
ALTER TABLE run ADD COLUMN IF NOT EXISTS task_id text;
CREATE INDEX IF NOT EXISTS run_mandate_idx ON run(mandate_id);
CREATE INDEX IF NOT EXISTS run_task_idx ON run(task_id);

-- Rooms provisioned before the manager tier existed still need the two tools that
-- tier uses. They are not on the room form; every room has them.
UPDATE room SET tool_grants = tool_grants || '["assign","report"]'::jsonb
 WHERE NOT (tool_grants @> '["assign"]'::jsonb);
