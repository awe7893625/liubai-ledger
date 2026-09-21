-- 0002_seed.sql — privacy-safe defaults for a single-user local Ledger.

INSERT INTO users (id, display_name, default_currency, timezone)
SELECT 'local', 'Ledger User', 'TWD', 'Asia/Taipei'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 'local');

-- Generic starter accounts. Add your actual cards in Settings after first launch.
INSERT OR IGNORE INTO funding_accounts
  (id, user_id, type, issuer, nickname, last4, sort_order, metadata)
VALUES
  ('cash','local','cash',NULL,'現金',NULL,0,'{"aliases":["現金","cash"]}'),
  ('unknown','local','other',NULL,'未指定卡片',NULL,99,'{}');

-- Default categories contain no personal data.
INSERT OR IGNORE INTO categories (id, user_id, name, slug, sort_order) VALUES
 ('c_food','local','餐飲','food',0),
 ('c_transport','local','交通','transport',1),
 ('c_home','local','居家','home',2),
 ('c_shopping','local','購物','shopping',3),
 ('c_fun','local','娛樂','entertainment',4),
 ('c_health','local','健康','health',5),
 ('c_education','local','教育','education',6),
 ('c_bills','local','公共事業','bills',7),
 ('c_travel','local','旅遊','travel',8),
 ('c_other','local','其他','other',99);

-- Optional integrations are disabled until the operator configures them.
INSERT OR IGNORE INTO settings (
  user_id, default_category_id, default_funding_account_id, default_subcategory,
  default_recurring, update_interval, ai_enabled, ai_provider_name, ai_model_text,
  ai_model_code, ai_endpoint_url, ai_temperature, ai_max_tokens, ai_max_retries, ai_timeout_s,
  ai_fallback_json, telegram_bot_token, telegram_chat_id, telegram_enabled,
  hsbc_email_account, hsbc_email_password_encrypted, hsbc_email_host, hsbc_email_port, hsbc_enabled
) VALUES (
  'local','c_other','cash',NULL,0,3600,0,
  NULL,NULL,NULL,NULL,0.1,256,1,30,'{}',
  NULL,NULL,0,NULL,NULL,NULL,993,0
);
