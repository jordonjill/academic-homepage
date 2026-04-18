CREATE TABLE IF NOT EXISTS daily_usage (
  ip_hash TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  ask_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (ip_hash, day_utc)
);

CREATE TABLE IF NOT EXISTS ip_reputation (
  ip_hash TEXT PRIMARY KEY,
  abuse_strikes INTEGER NOT NULL DEFAULT 0,
  banned_at TEXT,
  ban_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_log (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  semantic_score REAL,
  matched_intent TEXT,
  abuse_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_log_created_at ON request_log (created_at);
CREATE INDEX IF NOT EXISTS idx_request_log_ip_hash ON request_log (ip_hash);
