-- 0006_unknown_account.sql
-- Catch-all funding account for unmatched Wallet capture cards.

INSERT OR IGNORE INTO funding_accounts (id, user_id, type, issuer, nickname, last4, sort_order, metadata)
VALUES ('unknown','local', 'other', NULL, '未知卡片', NULL, 4, '{}');
