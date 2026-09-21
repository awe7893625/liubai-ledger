-- 0003_reserved_expenses.sql — Phase 2 Budget Core (T22/T23)
-- Reserved (earmarked) expenses: money already committed for upcoming
-- known bills within the budget month. Drives safe-to-spend & forecast.

CREATE TABLE reserved_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_id TEXT REFERENCES budgets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_minor INT NOT NULL CHECK (amount_minor > 0),
  expected_date TEXT,
  -- ISO YYYY-MM-DD, optional
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  funding_account_id TEXT REFERENCES funding_accounts(id) ON DELETE SET NULL,
  matched_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','matched','cancelled')),
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reserved_budget ON reserved_expenses(budget_id);
CREATE INDEX idx_reserved_status ON reserved_expenses(status);
CREATE INDEX idx_reserved_user ON reserved_expenses(user_id, status);
