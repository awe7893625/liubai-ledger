-- 0001_init.sql — Ledger Personal Finance
-- SQLite-flavoured schema derived from DATA_MODEL.sql (spec v1.0)
-- SQLite has no JSONB / NUMERIC types, so:
--   * JSONB -> TEXT
--   * NUMERIC -> TEXT (stored as minor-unit integers)
--   * TIMESTAMPTZ -> TEXT (ISO 8601)
--   * BOOLEAN -> INTEGER with CHECK(x IN (0,1))
--   * UUID    -> TEXT

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  default_currency CHAR(3) NOT NULL DEFAULT 'TWD',
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE funding_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit_card','cash','bank_account','other')),
  issuer TEXT,
  nickname TEXT NOT NULL,
  last4 CHAR(4),
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE (user_id, slug)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funding_account_id TEXT NOT NULL REFERENCES funding_accounts(id) ON DELETE RESTRICT,
  amount MINOR INT NOT NULL,
  -- (positive = credit/income, negative = debit/expense)
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  date TEXT NOT NULL,
  -- ISO 8601 local naive
  occurred_at TEXT NOT NULL,
  -- ISO 8601 UTC
  description TEXT,
  merchant TEXT,
  merchant_normalized TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  subcategory TEXT,
  tag TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','telegram','email','statement','sync')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','archived','duplicate')),
  is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, funding_account_id, date, amount, merchant_normalized, source, status)
);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month TEXT NOT NULL,
  -- YYYY-MM
  total_limit_minor INT NOT NULL,
  safety_buffer_minor INT NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, period_month)
);

CREATE TABLE budget_categories (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  category_limit_minor INT NOT NULL DEFAULT 0,
  safety_buffer_minor INT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (budget_id, category_id)
);

CREATE TABLE transactions_archive (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  original_id TEXT NOT NULL UNIQUE,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  archive_reason TEXT,
  original_json TEXT NOT NULL,
  -- full transaction row snapshot
  -- All original columns copied from transactions
  funding_account_id TEXT NOT NULL,
  amount MINOR INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  description TEXT,
  merchant TEXT,
  merchant_normalized TEXT,
  category_id TEXT,
  subcategory TEXT,
  tag TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'archived'
);

CREATE TABLE statement_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funding_account_id TEXT NOT NULL REFERENCES funding_accounts(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  statement_period TEXT,
  import_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (import_status IN ('pending','processing','completed','failed')),
  imported_count INT NOT NULL DEFAULT 0,
  error_log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE email_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funding_account_id TEXT NOT NULL REFERENCES funding_accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  -- e.g. "hsbc"
  subject TEXT,
  received_at TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL
  CHECK (event_type IN ('payment','refund','income','transfer','unknown')),
  parsed_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5,
  needs_review INTEGER NOT NULL DEFAULT 0
  CHECK (needs_review IN (0,1)),
  inbox_status TEXT NOT NULL DEFAULT 'open'
  CHECK (inbox_status IN ('open','resolved','dismissed')),
  linked_transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE telegram_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_json TEXT NOT NULL DEFAULT '{}',
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','confirmed','failed','undone')),
  failed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, chat_id, message_id)
);

CREATE TABLE ai_call_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  provider TEXT,
  input_tokens INT,
  output_tokens INT,
  latency_ms INT,
  cost_estimate_minor INT DEFAULT 0,
  request_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_category_id TEXT,
  default_funding_account_id TEXT,
  default_subcategory TEXT,
  default_recurring INTEGER NOT NULL DEFAULT 0,
  update_interval INT NOT NULL DEFAULT 3600,
  -- seconds
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  ai_provider_name TEXT,
  ai_model_text TEXT,
  ai_model_code TEXT,
  ai_endpoint_url TEXT,
  ai_api_key_encrypted TEXT,
  ai_api_key_source TEXT,
  ai_temperature REAL DEFAULT 0.1,
  ai_max_tokens INT DEFAULT 64,
  ai_max_retries INT DEFAULT 2,
  ai_timeout_s INT DEFAULT 8,
  ai_fallback_json TEXT NOT NULL DEFAULT '{}',
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  hsbc_email_account TEXT,
  hsbc_email_password_encrypted TEXT,
  hsbc_email_host TEXT,
  hsbc_email_port INT DEFAULT 993,
  hsbc_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_merchant ON transactions(merchant_normalized);
CREATE INDEX idx_tx_funding ON transactions(funding_account_id);
CREATE INDEX idx_tx_category ON transactions(category_id);
CREATE INDEX idx_email_created ON email_events(created_at);
CREATE INDEX idx_telegram_status ON telegram_events(status);

-- 注意: schema_migrations 表由 db.py / init_db() 建立，不在遷移 SQL 中重複建立
