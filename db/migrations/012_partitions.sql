-- A7: the event log is partitioned by month so replay stays fast at V2 volumes,
-- and per-room snapshots let the fold start from a checkpoint instead of genesis.
--
-- A partitioned primary key must include the partition column, so the PK becomes
-- (id, ts). Nothing references event(id) from another table, so this is safe.
CREATE TABLE IF NOT EXISTS event_new (
  id bigserial,
  ts timestamptz NOT NULL DEFAULT now(),
  room_id text,
  agent_id text,
  run_id text,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX IF NOT EXISTS event_new_room_idx ON event_new(room_id, id DESC);
CREATE INDEX IF NOT EXISTS event_new_run_idx ON event_new(run_id, id);

-- Monthly partitions, two years out; the DEFAULT catches anything outside.
DO $$
DECLARE m date;
BEGIN
  FOR i IN 0..23 LOOP
    m := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF event_new FOR VALUES FROM (%L) TO (%L)',
      'event_' || to_char(m, 'YYYY_MM'), m, m + interval '1 month');
  END LOOP;
  EXECUTE 'CREATE TABLE IF NOT EXISTS event_default PARTITION OF event_new DEFAULT';
END $$;

-- Backfill, then swap.
INSERT INTO event_new SELECT * FROM event;
ALTER TABLE event RENAME TO event_legacy;
ALTER TABLE event_new RENAME TO event;

-- Snapshots: per-room checkpoints the fold can start from.
CREATE TABLE IF NOT EXISTS snapshot (
  id            bigserial PRIMARY KEY,
  room_id       text NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  upto_event_id bigint NOT NULL,
  projection    jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snapshot_room_idx ON snapshot(room_id, id DESC);
