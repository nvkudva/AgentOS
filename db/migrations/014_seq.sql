-- A7 follow-up: the 012 backfill copies explicit ids, so the shared sequence must
-- resume past them — otherwise new events reuse ids 1..N and the log's "ids
-- only move forward" invariant breaks (same id, two rows, order ambiguous).
SELECT setval('event_new_id_seq', (SELECT coalesce(max(id), 1) FROM event));
