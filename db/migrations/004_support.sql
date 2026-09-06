-- The support desk's real data. Its own schema so a room role can be granted
-- against it without touching the sales and analytics tables.
CREATE SCHEMA IF NOT EXISTS support;

CREATE TABLE IF NOT EXISTS support.ticket (
  id serial PRIMARY KEY,
  customer_id int REFERENCES bizdata.customer(id),
  subject text NOT NULL,
  body text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',   -- low | normal | urgent
  status text NOT NULL DEFAULT 'open',       -- open | answered | closed
  reply text,
  opened_at date NOT NULL DEFAULT current_date,
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS ticket_status_idx ON support.ticket(status, priority, opened_at);
