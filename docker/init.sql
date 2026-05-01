-- Creates both databases on first container start

CREATE USER suppression_user WITH PASSWORD 'changeme_suppression';
CREATE DATABASE suppression_db OWNER suppression_user;
GRANT ALL PRIVILEGES ON DATABASE suppression_db TO suppression_user;

\c suppression_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS suppressions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_hash  TEXT NOT NULL,
  dealer_id   UUID NOT NULL,
  source      TEXT DEFAULT 'one_click',
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email_hash, dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_lookup
  ON suppressions(email_hash, dealer_id);

CREATE TABLE IF NOT EXISTS unsub_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_hash  TEXT NOT NULL,
  dealer_id   UUID,
  send_id     UUID,
  action      TEXT NOT NULL,
  ip          TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
