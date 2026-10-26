-- A9: auth + scoped tokens. Secrets are hashes; the plaintext lives with the
-- operator (env / boot printout), never in the database.
CREATE TABLE IF NOT EXISTS api_token (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  scope_room_id text REFERENCES room(id) ON DELETE CASCADE,  -- NULL = operator, everything
  secret_hash text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Random per-room role passwords replace password==rolename (REVIEW P0).
ALTER TABLE room ADD COLUMN IF NOT EXISTS db_password text;
