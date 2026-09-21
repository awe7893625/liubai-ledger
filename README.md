# Ledger

**留百工作室**開源的 local-first 個人記帳系統。

[線上 Apple Pay 設定指南](https://liubai-ledger.vercel.app) · GitHub 開源專案（就在本頁）

> 覺得有用的話，歡迎到 GitHub 右上角按 **Star**。這能讓更多想做 Apple Pay 自動記帳的人找到這個專案。

FastAPI + SQLite + React，支援手動記帳、預算、分析，以及 iPhone Wallet「交易」自動化把 Apple Pay 消費送回自己的 Ledger。

> 你的資料留在自己的主機與 SQLite。專案不需要銀行網銀帳密，也不內建作者的卡號、交易紀錄、私人網址或 API key。

## 特色

- Apple Pay / Wallet 交易自動記帳
- iPhone Shortcuts `POST /api/wallet`
- `X-Ledger-Token` 防止陌生請求灌入交易
- 預設不保存 GPS、原始 Wallet payload 或 raw card label
- 帳戶、分類、流水、月預算、分析與匯出
- 手動快速記帳與可選 AI 收據解析
- SQLite 單機部署，適合 Mac / NAS / 小型主機
- 手機優先介面，無外部字型或追蹤器

## 隱私設計

公開版使用本機單使用者 ID `local`，但 UI 不顯示帳號。初始資料只有「現金」與「未指定卡片」，不建立任何特定銀行或卡尾碼。

## 快速啟動

```bash
git clone <THIS_REPOSITORY_URL> ledger
cd ledger
cp .env.example .env
```

編輯 `.env`，至少把 `LEDGER_INGEST_TOKEN` 改成自己的長隨機字串。

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一個終端：

```bash
cd frontend
npm install
npm run dev
```

打開 `http://localhost:5173`。

## Apple Pay 自動記帳

iPhone「捷徑」App →「自動化」→ `+` →「交易」，選擇要監聽的卡片，設定為自動執行。

新增「取得 URL 內容」：

- URL：`https://你的-Ledger-網址/api/wallet`
- 方法：`POST`
- Header：`X-Ledger-Token` = 你在 `.env` 設定的 `LEDGER_INGEST_TOKEN`
- Request Body：`JSON`

JSON 欄位：

| key | iOS 交易變數 |
| --- | --- |
| `amount` | Amount |
| `merchant` | Merchant |
| `card` | Card or Pass |
| `payment_method` | 固定填 `apple_pay` |
| `time_source` | 固定填 `wallet_transaction` |
| `occurred_at` | 可選；沒有就省略 |

網站內也有「我的 → Apple Pay 設定」，可檢查自己的 API URL。

## 讓 iPhone 連到 Ledger

最簡單的私人方案是 Tailscale。先確定 iPhone 與 Ledger 主機都登入同一個 tailnet，再用目前版本的 Tailscale Serve 將服務暴露在 tailnet 內。不同 Tailscale 版本的 CLI 參數可能不同，請以 `tailscale serve --help` 顯示為準。

如果改用公開 HTTPS 網域，務必保留 `LEDGER_INGEST_TOKEN`，並把後端置於 HTTPS reverse proxy 後方。

## 帳戶與 Apple Pay 卡片對應

進「我的 → 帳戶」新增自己的卡片。Apple Pay 傳來的 Card or Pass 名稱會依序比對帳戶 ID、nickname、issuer 與 metadata 中的 `aliases`。沒有命中時會進「未指定卡片」，不會丟掉交易。

## 位置資料

預設 `LEDGER_STORE_LOCATION=false`。如果你自己擴充捷徑送 latitude / longitude / location_name，只有把它改成 `true` 才會存位置。

## AI

AI 完全可選。公開版不會讀取作者電腦上的 key 檔案。若要使用：

```env
LEDGER_OLLAMA_MODEL=your-local-model
# 或
OPENROUTER_API_KEY=your-key
```

## 測試

```bash
cd backend && pytest
cd ../frontend && npm run build
```

## 安全提醒

不要 commit `.env`、SQLite DB、log、Tailscale hostname、私人 IP、API key、真實交易匯出或含卡號的截圖。`.gitignore` 已預設排除這些常見檔案。

## License

MIT — © 留百工作室
