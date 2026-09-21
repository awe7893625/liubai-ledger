-- 0006_sms_source_check.sql
-- Widen transactions.source CHECK to include 'sms' (SMS 解析) and 'capture'
-- (Wallet Shortcut automation) — already applied to the live db out-of-band,
-- this file was missing from the repo so fresh installs never got it.
-- SQLite CHECK constraints can't be altered in place, so rebuild the table.

CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  funding_account_id TEXT NOT NULL REFERENCES funding_accounts(id) ON DELETE RESTRICT,
  amount MINOR INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'TWD',
  date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  description TEXT,
  merchant TEXT,
  merchant_normalized TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  subcategory TEXT,
  tag TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','telegram','email','statement','sync','sms','capture')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','archived','duplicate')),
  is_recurring INTEGER NOT NULL DEFAULT 0 CHECK (is_recurring IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('expense','income','refund','transfer','unknown')),
  external_id TEXT,
  UNIQUE (user_id, funding_account_id, date, amount, merchant_normalized, source, status)
);

INSERT INTO transactions_new
  (id, user_id, funding_account_id, amount, currency, date, occurred_at,
   description, merchant, merchant_normalized, category_id, subcategory, tag,
   source, status, is_recurring, notes, created_at, updated_at, kind, external_id)
SELECT id, user_id, funding_account_id, amount, currency, date, occurred_at,
       description, merchant, merchant_normalized, category_id, subcategory, tag,
       source, status, is_recurring, notes, created_at, updated_at, kind, external_id
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(user_id, kind, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id
  ON transactions(source, external_id)
  WHERE external_id IS NOT NULL;
