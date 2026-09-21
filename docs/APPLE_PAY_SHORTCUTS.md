# Apple Pay / iPhone 捷徑設定

Ledger 使用 iOS「交易」個人自動化取得 Wallet 交易欄位，再用「取得 URL 內容」POST 到你自己的 `/api/wallet`。

## 1. 先準備 Ledger URL

你需要一個 iPhone 能連到的 URL，例如：

```text
https://ledger.example.com/api/wallet
```

私人使用建議用 Tailscale；公開網域則務必使用 HTTPS 與 ingest token。

先確認：

```text
https://ledger.example.com/api/health
```

會回：

```json
{"status":"ok","service":"ledger-api","version":"1.0.0"}
```

## 2. 設定 ingest token

在 `.env`：

```env
LEDGER_INGEST_TOKEN=換成你自己的長隨機字串
```

可用 Python 產生：

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```
## 3. 建立「交易」自動化

1. iPhone 開啟「捷徑」。
2. 進入「自動化」。
3. 點 `+`，新增個人自動化。
4. 選「交易」。
5. 選要監聽的卡片或票卡。
6. 設定為自動執行／立即執行，不要每次都要求確認。
7. 新增動作「取得 URL 內容」。

URL 填：

```text
https://你的-Ledger-網址/api/wallet
```

方法選 `POST`，Request Body 選 `JSON`。

Header：

```text
X-Ledger-Token: 你的 LEDGER_INGEST_TOKEN
```

JSON 欄位：

| Key | Value |
| --- | --- |
| `amount` | 交易 → Amount |
| `merchant` | 交易 → Merchant |
| `card` | 交易 → Card or Pass |
| `payment_method` | `apple_pay` |
| `time_source` | `wallet_transaction` |
| `occurred_at` | 可選；交易日期時間 |
## 4. 卡片如何對到 Ledger 帳戶

先在 Ledger「我的 → 帳戶」建立自己的信用卡／銀行帳戶。

Wallet 傳來的 Card or Pass 名稱會比對：

- account id
- nickname
- issuer
- metadata.aliases（進階用法）

沒有命中不會丟交易，而是放到「未指定卡片」。

## 5. 定位是可選的

公開版預設：

```env
LEDGER_STORE_LOCATION=false
```

因此即使捷徑傳了位置，Ledger 也不會保存 GPS。若真的需要消費地圖，再自行改成 `true`。

## 6. 常見錯誤

- `401 invalid ingest token`：捷徑 Header token 跟 `.env` 不一致。
- `404`：URL 通常少了 `/api/wallet`，或 reverse proxy path 設錯。
- `422`：JSON 的 `amount` 沒綁到 Wallet Amount，或欄位型別錯誤。
- iPhone 連不到：先直接用 Safari 打 `/api/health`，確認網路／DNS／Tailscale。
- 卡片都進「未指定」：把 Ledger 帳戶 nickname 改成接近 Wallet 顯示的 Card or Pass 名稱。

## 7. 手動測試

不必等 Apple Pay，可先用 curl：

```bash
curl -X POST 'https://你的-Ledger-網址/api/wallet' \
  -H 'Content-Type: application/json' \
  -H 'X-Ledger-Token: 你的-token' \
  -d '{"amount":120,"merchant":"Demo Cafe","card":"Demo Card","payment_method":"apple_pay"}'
```

成功會回 `ok: true` 與 `tx_id`。
