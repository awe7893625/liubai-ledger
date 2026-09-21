-- Idempotency for automated ingestion (SMS/Email/Telegram): the same external
-- event replayed must land at most once. unique index on (source, external_id);
-- external_id = sha1(raw event text + sender + date[:10]) computed by the ingester.
ALTER TABLE transactions ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id
  ON transactions(source, external_id)
  WHERE external_id IS NOT NULL;
