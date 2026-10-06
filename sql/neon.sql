-- TREE PS Neon bootstrap
-- The backend also creates this automatically on first start.
CREATE TABLE IF NOT EXISTS treeps_state (
  id INTEGER PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Stable ledgers: these tables are the source of truth for wallet and queued Gacha rewards.
CREATE TABLE IF NOT EXISTS treeps_wallets (
  user_id BIGINT PRIMARY KEY,
  wl BIGINT NOT NULL DEFAULT 0,
  dl BIGINT NOT NULL DEFAULT 0,
  bgl BIGINT NOT NULL DEFAULT 0,
  ggl BIGINT NOT NULL DEFAULT 0,
  gems BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treeps_gacha_pending (
  user_id BIGINT PRIMARY KEY,
  rewards JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
