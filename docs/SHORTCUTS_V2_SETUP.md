# 留白記帳：先手動測通，再設定 Apple Pay（捷徑 v3）

正式入口： https://app.blankspaces.uk/connect?tab=settings

## 使用者只需設定一次

1. 登入自己的帳號，在「設定 → 我的信用卡與付款方式」新增暱稱。
   可選信用卡、現金、銀行／轉帳、電子支付、其他。這版帳本以 TWD 為主；
   不要求完整信用卡號、驗證碼、銀行密碼。兩張同銀行卡要有可區別的名稱。
2. 先安裝／更新「留白手動記帳」，保留此名稱供網站配對按鈕呼叫。
   這一階段不必先安裝自動捷徑；公開檔不含任何帳號或 Token。
3. 網站按「連接 iPhone」，由手動捷徑用一次性票券交換裝置憑證。
   舊的自動捷徑仍可處理配對票券，兩支共用同一憑證檔。
4. 開手動捷徑選「記支出」並成功記一筆，再回網站確認「手動捷徑入帳已確認」。
   建議記真實小額支出；1 元「捷徑測試」會真的新增交易，可驗證後刪除。
   「測試連線（不記帳）」只檢查連線，不會完成此入帳驗證；網頁記帳也不算。
5. 網站確認這個裝置的成功入帳紀錄後，顯示「安裝自動記帳」及 Apple Pay 教學。
6. 日常手動：支出／收入 → 金額 → 商家 → 付款方式 → 分類 → 備註 → 確認。
   確認頁列出帳本名稱，避免瀏覽器換帳號但 iCloud 配對仍指向舊帳號。

## 手動成功後，設定 Apple Pay 自動化

iPhone 的交易個人自動化仍須由每位使用者自己選卡並允許執行。
網站不能替 iPhone 開啟自動化。新版介面可另建「Apple Pay 入口」捷徑加入交易觸發器；
入口建立辭典並執行「留白自動記帳」，不要讓捷徑呼叫自己。
自動化傳入一個 Dictionary：`amount`（金額）、`merchant`（商家文字）、
`card`（Wallet 卡片名稱文字），再執行「留白自動記帳」。不要把手動用途
選單的輸出錯接成付款方式；Google 登入也不是付款方式。

銀行不限品牌。後端只用**該使用者**的名稱與 Wallet 別名作正規化後的精確匹配，
不以銀行名稱 contains/fuzzy matching 猜卡。找不到或多個候選時，交易與原始卡名
仍保留，回應明示待對應，不把交易記到任意一張卡。設定別名適用於後續交易；
不會未經確認批次更改既有歷史交易。

官方 Transaction trigger 描述為卡片感應：
https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios
因此網站／App 內 Apple Pay 不宣稱必定觸發，也不承諾一定有 Wallet 通知。
線上付款可先由手動捷徑記錄。

## 網站進度判定

`GET /api/v2/devices?onboarding=1` 只接受登入 session，查該使用者各啟用裝置的
伺服器端 ingestion 紀錄。已處理的 `payload.source=manual` 才能開放 Wallet 教學。
配對回呼、點擊「已完成」、連線 probe、網頁 POST 都不能取代此證據。

進度按裝置分開，已撤銷裝置不參與；新配對需重新驗證。交易刪除後，原成功處理事件
仍保留，所以不必重做測試。收到 Wallet 資料與 iOS 真實觸發是不同證據層級；
回應永遠維持 `ios_trigger_attested=false`，不以 API 模擬冒充真機 NFC 驗收。

畫面回到前景或手動刷新時重新確認。檢查中輪詢只在前景、最多 90 秒；狀態查詢
失敗時不顯示新的成功，並暫停下一步引導。此教學 gate 不會阻擋已存在的 ingest。

## 請求與通知

- GET `/api/v2/wallet/ingest`：裝置憑證驗證後，只回自己的帳本顯示名稱、
  付款方式 ID/名稱、分類 ID/名稱與一次使用的隨機 request ID。沒有交易或餘額。
- POST 同路徑：`source=manual` 或 `apple_pay`。手動記帳使用明確的
  `direction=expense|income`，金額輸入正數，後端決定正負號。
- 付款方式與分類 ID 必須屬於裝置的 user_id；不信任 payload.user_id。
- 成功只在資料庫交易建立且事件關聯完成後，回 `ok=true`、`tx_id`、
  `receipt=ledger_saved_v2`、`result=saved|review|duplicate`、`message`。
- 捷徑先檢查交易編號與收據，再顯示後端訊息；不把 HTTP 動作完成當作入帳成功。
- 缺金額／商家及未知卡片會清楚提示確認，不產生假的成功通知。

## 手動送出草稿與重試的邊界

憑證保存在使用者自己的 iCloud Drive `Shortcuts/LiubaiLedger/device-token.txt`。
手動捷徑送出前把唯一 request_id 與資料存成同檔案夾的 `pending-manual.json`；
成功確認才清空。下次執行有草稿時可重送、保留取消，或明確確認後捨棄。
捨棄草稿不刪除雲端交易，應先查帳再重新輸入。

這是**未確認請求的重送機制**，不是完整離線記帳：取得付款選項仍需要網路，
網路層硬錯誤可能直接停止 iOS 捷徑。自動 Wallet 版目前沒有持久化離線佇列。
未使用定位、通訊錄、Gmail 或銀行憑證；GPS 不會卡住記帳。

## 工程與驗收

- 本次引導改版不改私人 M4 Ledger，也不執行歷史資料匯入或新的資料庫 migration。
- 沿用既有 accounts/card_aliases/category/event payload 欄位，不需要新資料庫 migration。
- `/api/v2/accounts` 驗證瀏覽器 session，所有查詢和修改均限定 user_id。
- 原有配對、撤銷及 v1 ingest 保持相容。v1 用戶要重新安裝新版才能使用新提示與手動入口。
- `scripts/build_cloud_shortcut.py` 生成兩份來源與未簽署檔；`shortcuts sign --mode anyone`
  產生公開檔。產生／簽署不等於真實 iPhone 執行成功。
- `npm run test:cloud-api` 測資料隔離、映射、收支、重送及撤銷。
- `scripts/e2e_shortcuts_v2.py` 只使用新建合成帳號驗證正式 API 和 390/1280px UI，
  並刪除本輪測試帳號。它不冒充 iPhone/NFC 的實機驗收。
- 真機最後檢查：iOS 匯入、iCloud 檔案權限、選單、草稿讀寫、Wallet 感應觸發。
