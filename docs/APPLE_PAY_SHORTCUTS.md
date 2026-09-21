# iPhone 捷徑安裝與 Wallet 自動化

本文件與[公開網站逐步圖解](https://liubai-ledger.vercel.app/#automation)配合使用。查核日期：2026-09-21。

## 編輯畫面：說明可以保留，兩個文字不能刪

對照[逐格教學](https://liubai-ledger.vercel.app/#shortcut-fields)：

| 畫面裡的動作 | 要做什麼 | 要刪嗎？ |
|---|---|---|
| 最上方的註解 | 讀取安裝說明，不會送進帳本 | 不必刪；只刪註解不影響設定 |
| 第一個文字 | 把 example.invalid 整段換成自己的 HTTPS /api/wallet URL | 不可刪動作，只換內容 |
| 第二個文字 | 把 REPLACE_WITH_YOUR_INGEST_TOKEN 換成自己 .env 的 token 值 | 不可刪動作，只換內容 |
| 取得 amount／merchant／card 的數值 | 從傳入的字典取值；「數值」是 Value，不是數字型別轉換 | 保留 |
| URL 與取得 URL 內容 | 第一格 URL → POST；第二格 Token → X-Ledger-Token；三個辭典值 → JSON | 保留 |

不要把 `LEDGER_INGEST_TOKEN=` 整行貼進第二格，只貼等號右邊、不含引號的值。不要將 token 貼到官網、Threads、issue 或截圖。

新版兩格有輸入問題設定；沒有顯示問題時，直接在編輯畫面修改兩個文字內容。網站更新不會修改已加入你手機的捷徑，舊版也可以照上表設定，無需只為整理註解而重建。

若下載新版替換：先保留原捷徑，核對 URL/Token 並測通，再確認交易自動化執行的是哪一份；不要同時留下兩個會處理同一張卡的自動化。

**Wallet 不是手動空跑測試用。**先用 Manual 輸入 1 元與「連線測試」，回應 `ok:true` 與 `tx_id` 且流水核對正確後，再建立交易自動化傳入字典。不要將「通知有出現」當成成功證據。

Apple 官方說明：[取得辭典值](https://support.apple.com/zh-tw/guide/shortcuts/apdf01294032/ios)、[API 要求](https://support.apple.com/zh-tw/guide/shortcuts/apd58d46713f/ios)、[個人化輸入問題](https://support.apple.com/zh-tw/guide/shortcuts/apdf330fd3a0/ios)。教學核對：2026-09-21；裝置界面用詞可能因 iOS 版本不同。

## 先決條件

必須先在自己的主機部署 Ledger，並取得 iPhone 可連線的 HTTPS 網域。公開展示網站不提供 /api/wallet，也不接受你的 token。

依 README 從專案根目錄建立前端，使用 app.web:app 加上 --env-file .env 啟動同源網站與 API，再以自己的私人網路連線。X-Ledger-Token 只保護捷徑寫入，不是整個帳本的登入機制。

## A. 下載、加入並設定捷徑

1. 在 iPhone Safari 開[捷徑下載區](https://liubai-ledger.vercel.app/#shortcuts)，下載 Ledger Manual 與 Ledger Wallet。
2. 在 Safari 下載項目或「檔案」App 打開 .shortcut 檔案，確認內容後加入捷徑。無法直接開啟時，也可在 Mac 下載後透過 AirDrop 傳給 iPhone。
3. 進入捷徑編輯畫面（右上角 ⋯）。最上方說明下面有兩個文字動作：第一格填 URL，第二格填 Token。兩份捷徑都要設定。
4. URL 必須完整到 `/api/wallet`，例如 `https://自己的主機.自己的-tailnet.ts.net/api/wallet`。不要填公開展示站、localhost 或作者的主機。
5. Token 直接填在自己的捷徑裡，與主機的 LEDGER_INGEST_TOKEN 完全相同。不要貼到公開網站、issue、截圖或分享檔。

模板原始值為 example.invalid 與占位 Token，未修改時不會送到任何人的 Ledger。

## B. 先用手動版做 1 元測試

執行 Ledger Manual，輸入金額 1、商家「連線測試」、卡片「現金」。首次使用可能需要允許連到你自己的網域。捷徑會顯示 API 回應，成功應包含 ok:true 及 tx_id；仍需回到自己的 Ledger 流水檢查。

如果卡片名稱無法配對，交易會進「未指定卡片」，不是被丟棄。需要自己的卡片時，在帳戶設定新增 nickname／issuer／metadata.aliases。

## C. 建立交易自動化（下載捷徑不會代做）

1. iPhone 捷徑 App → 自動化 → ＋ → 選「交易／錢包」的感應觸發器。
2. 選自己的卡片，選立即執行。先解鎖手機授權並測通，再檢查鎖定時的實際行為。
3. 新增「字典」動作，建立下面三項。值要選真正的交易變數，不是打入 Amount 等字樣。

| 字典 key | 交易輸出的屬性 |
|---|---|
| amount | Amount（金額） |
| merchant | Merchant（商家） |
| card | Card or Pass（卡片或票卡） |

4. 在字典下方新增「執行捷徑」，選 Ledger Wallet；展開動作，把輸入設為前一步字典。
5. 儲存，自行完成一次 iPhone 感應付款。查看 API 回應，再回自己的流水確認。

此設計不引用作者手機的 TriggerOutput；公開 Wallet 捷徑接收標準 Dictionary，由自己的自動化提供資料。

## D. 這份模板實際送出的內容

POST 到自己的 /api/wallet；Header 為 X-Ledger-Token。

```json
{
  "amount": 120,
  "merchant": "示範咖啡店",
  "card": "我的日常卡",
  "payment_method": "apple_pay",
  "time_source": "server_received"
}
```

金額單位為元，正數為支出。模板省略 occurred_at，由伺服器記錄接收時間；不要將它當成銀行提供的交易原始時間。高階使用者可自行加入穩定的事件時間，請同時處理重試與重複交易辨識。

模板不要求位置，不讀完整卡號或銀行登入資料。Manual 也走相同的 capture 管線，payment_method 為 manual；目前不是獨立銀行來源同步功能。

## 排錯

| 現象 | 檢查方式 |
|---|---|
| iPhone 連不到 | Safari 開自己的 /api/health；主機保持開機、iPhone 連上私人網路。 |
| 401 | 檢查 header token、主機 .env，以及是否真的使用 --env-file 載入。 |
| 404 | 使用完整 /api/wallet，不是只填網域；不要填本專案的公開展示站。 |
| 422 | 檢查 amount 是否綁數值變數、字典 key 是否正確。 |
| 金額空白 | 確认 iPhone 交易觸發器確實提供此欄位；先測手動版。 |
| 全進未指定卡片 | 新增自己的帳戶 nickname，與 Wallet Card or Pass 對應。 |
| 不自動觸發 | 檢查是否在 iPhone 感應、是否勾選卡片、是否設立即執行及授權。 |

## 已知限制與驗證

iPhone Wallet 的感應觸發器不是完整銀行帳務同步。不保證 Apple Watch、網購、App 內付款及退款都會觸發；未涵蓋交易用手動捷徑補記。若自行加入重試，不要把相同請求反覆送入而未檢查回應。

檔案已透過 macOS anyone 模式簽章、檢查來源結構與動作引用，並提供公開下載檔案雜湊。**真實 iPhone 匯入、首次權限與感應付款必須在使用者裝置完成驗收。**這不是 Apple 審核或推薦。

## 官方資料

- [Apple：交易記錄觸發器](https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios)
- [Apple：分享捷徑](https://support.apple.com/zh-tw/guide/shortcuts/apdf01f8c054/ios)
- [Apple：Mac 分享與簽章](https://support.apple.com/guide/shortcuts-mac/share-shortcuts-apdf01f8c054/mac)
- [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)
