CREATE TABLE IF NOT EXISTS clicks (
  ping_id TEXT NOT NULL,
  clicked_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS clicks_ping ON clicks (ping_id);
