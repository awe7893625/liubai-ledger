-- 0007_merchant_normalization.sql
-- Generic merchant normalization table. Public builds ship with no personal merchant history.

CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_name TEXT NOT NULL UNIQUE,
    normalized_name TEXT NOT NULL,
    default_category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_merchants_normalized ON merchants(normalized_name);
