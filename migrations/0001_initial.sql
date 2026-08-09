CREATE TABLE draw_records (
  year INTEGER NOT NULL CHECK (year = 2026),
  period INTEGER NOT NULL CHECK (period > 0),
  draw_date TEXT NOT NULL CHECK (draw_date GLOB '2026-[0-1][0-9]-[0-3][0-9]'),
  normal_1 TEXT NOT NULL,
  normal_2 TEXT NOT NULL,
  normal_3 TEXT NOT NULL,
  normal_4 TEXT NOT NULL,
  normal_5 TEXT NOT NULL,
  normal_6 TEXT NOT NULL,
  special TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (year, period)
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  source_url TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  latest_period INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  error_message TEXT
);

CREATE TABLE admin_login_attempts (
  client_hash TEXT NOT NULL,
  failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_draw_records_date ON draw_records(draw_date);
CREATE INDEX idx_sync_runs_started ON sync_runs(started_at DESC);
CREATE INDEX idx_login_attempts_hash ON admin_login_attempts(client_hash, expires_at);
