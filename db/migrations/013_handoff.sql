-- PM-10: rooms request data/compute from each other through logged, revocable,
-- scope-checked handoffs instead of operator copy-paste.
CREATE TABLE IF NOT EXISTS handoff (
  id          text PRIMARY KEY,
  from_room_id text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  to_room_id   text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  artifact_ids jsonb NOT NULL DEFAULT '[]',
  message     text NOT NULL DEFAULT '',
  state       text NOT NULL DEFAULT 'pending',   -- pending|accepted|rejected|revoked
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
CREATE INDEX IF NOT EXISTS handoff_rooms_idx ON handoff(from_room_id, to_room_id, state);
