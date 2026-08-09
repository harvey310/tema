CREATE TABLE IF NOT EXISTS combination_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_url TEXT NOT NULL,
  period_range TEXT NOT NULL,
  status TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  evidence TEXT NOT NULL,
  error_message TEXT NOT NULL,
  zodiacs_json TEXT NOT NULL,
  numbers_json TEXT NOT NULL,
  UNIQUE(source_key, period_range, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_combination_records_date ON combination_records(captured_at, source_key);
