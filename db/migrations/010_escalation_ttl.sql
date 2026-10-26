-- A5: the escalation lattice is bounded and auto-expiring. Gate approvals
-- (irreversible actions) never expire — a human must see them. Questions do:
-- an unanswered escalation/clarify releases the agent instead of parking it
-- forever, and the expiry itself is an event so replay stays faithful.
ALTER TABLE approval ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS approval_expiry_idx ON approval(state, expires_at) WHERE state = 'pending';
