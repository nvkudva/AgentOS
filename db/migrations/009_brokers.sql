-- A4: pooled DB identity. Per-room LOGIN roles stay (defense in depth + existing
-- grants), but live tool traffic goes through a small set of broker roles via
-- SET LOCAL ROLE on a checkout from the main pool — no per-room pool, no connection
-- fan-out, and application_name keeps attribution in pg_stat_activity + the event log.

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='broker_reader')
  THEN CREATE ROLE broker_reader NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='broker_writer')
  THEN CREATE ROLE broker_writer NOLOGIN; END IF; END $$;

GRANT USAGE ON SCHEMA bizdata TO broker_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA bizdata TO broker_reader;
GRANT USAGE ON SCHEMA support, bizdata TO broker_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA support TO broker_reader;
GRANT SELECT ON bizdata.customer TO broker_reader;

GRANT broker_reader TO broker_writer;
GRANT UPDATE (note) ON bizdata.pipeline TO broker_writer;
GRANT UPDATE (reply, status, answered_at) ON support.ticket TO broker_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA support TO broker_writer;

-- The pool owner must be able to assume the broker roles.
GRANT broker_reader TO CURRENT_USER;
GRANT broker_writer TO CURRENT_USER;

-- Which data profile a room was provisioned with. The gate (toolbelt) and the
-- broker (checkout) both read it; neither trusts the other alone.
ALTER TABLE room ADD COLUMN IF NOT EXISTS access_profile text;

-- Backfill from the grants that actually landed on each room's role.
UPDATE room SET access_profile = CASE
  WHEN db_role IS NULL THEN 'none'
  WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE grantee = room.db_role AND table_schema = 'support'
                 AND table_name = 'ticket' AND privilege_type = 'UPDATE') THEN 'support_desk'
  WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE grantee = room.db_role AND table_schema = 'bizdata'
                 AND table_name = 'pipeline' AND privilege_type = 'UPDATE') THEN 'write_pipeline'
  WHEN EXISTS (SELECT 1 FROM information_schema.role_table_grants
               WHERE grantee = room.db_role AND privilege_type = 'SELECT') THEN 'read_business'
  ELSE 'none' END
WHERE access_profile IS NULL;
