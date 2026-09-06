-- The real business database the analytics and sales rooms query.
-- Separate schema so room DB roles can be granted against it independently.
CREATE SCHEMA IF NOT EXISTS bizdata;

CREATE TABLE IF NOT EXISTS bizdata.customer (
  id serial PRIMARY KEY, name text NOT NULL, plan text NOT NULL,
  region text NOT NULL, signed_up date NOT NULL, churned_at date
);
CREATE TABLE IF NOT EXISTS bizdata.orders (
  id serial PRIMARY KEY, customer_id int NOT NULL REFERENCES bizdata.customer(id),
  placed_at date NOT NULL, amount_cents int NOT NULL, status text NOT NULL
);
CREATE TABLE IF NOT EXISTS bizdata.pipeline (
  id serial PRIMARY KEY, account text NOT NULL, stage text NOT NULL,
  value_cents int NOT NULL, owner text NOT NULL, last_touch date NOT NULL, note text
);
