-- A6: policies become data. The registry is the authority on what jobs exist,
-- what they need granted, and which version is current; the TS step arrays are
-- the execution of the registered version. validate() reads this table first.
CREATE TABLE IF NOT EXISTS policy (
  key     text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  goal    text NOT NULL,
  uses    jsonb NOT NULL DEFAULT '[]',
  steps   integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
