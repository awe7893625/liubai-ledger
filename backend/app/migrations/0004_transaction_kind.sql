-- BLOCKER 2: amount sign alone cannot tell a refund from income, so every
-- positive transaction was offsetting the budget and salary zeroed the month.
-- email_events already carries this taxonomy; transactions dropped it on landing.
ALTER TABLE transactions ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown'
  CHECK (kind IN ('expense','income','refund','transfer','unknown'));

-- Conservative backfill: existing positives become income, never refunds, so no
-- historical row can silently keep discounting the budget.
UPDATE transactions
   SET kind = CASE WHEN amount < 0 THEN 'expense' ELSE 'income' END
 WHERE kind = 'unknown';

CREATE INDEX IF NOT EXISTS idx_transactions_kind ON transactions(user_id, kind, date);
