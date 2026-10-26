-- A2: leased scheduler. The in-memory `inflight` set dies with the process and is
-- invisible to a second scheduler; a lease row is neither.
ALTER TABLE agent ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE agent ADD COLUMN IF NOT EXISTS lease_expires timestamptz;
CREATE INDEX IF NOT EXISTS agent_lease_idx ON agent(state, lease_expires) WHERE current_run_id IS NOT NULL;
