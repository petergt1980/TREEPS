-- TREE PS Neon bootstrap
-- The backend also creates this automatically on first start.
CREATE TABLE IF NOT EXISTS treeps_state (
  id INTEGER PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
