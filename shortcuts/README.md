# Ledger 公開捷徑範本

兩個範本以 `shortcuts/build_shortcuts.py` 產生。`source/*.json` 是可閱讀動作定義，`source/*.shortcut` 為可重現的未簽署 plist；可安裝的公開版在 `frontend/public/shortcuts/`。

- **Ledger 手動記帳**：詢問金額、商家、帳戶暱稱；產生 ISO 8601 時間；POST 至你自己的 API；顯示伺服器回應，不假定 HTTP 成功就一定有入帳。
- **Ledger Apple Pay**：接收交易自動化傳入的字典（amount、merchant、card、occurred_at），POST 到你自己的 API，輸出回應文字。沒有取得定位、通訊錄、銀行登入或作者主機的動作。

兩個範本都必須自訂前兩個文字動作：API URL 與 Ingest Token。URL 預設為不可實際部署的 `.invalid` 網域；Token 預設為要求替換的提示值。匯入問題也指向這兩個動作。若匯入問題沒顯示，直接在編輯器修改。

## 建置及簽署

```sh
python3 shortcuts/build_shortcuts.py
shortcuts sign --mode anyone --input shortcuts/source/Ledger-Manual.shortcut --output frontend/public/shortcuts/Ledger-Manual.shortcut
shortcuts sign --mode anyone --input shortcuts/source/Ledger-ApplePay.shortcut --output frontend/public/shortcuts/Ledger-ApplePay.shortcut
```

Apple 會取得乾淨範本以驗證簽署。不可改用 `people-who-know-me` 對外發布，因為該模式可能附加聯絡資訊。不可把填好私人 URL 或 Token 的範本送去當公開版。

## 驗證界線

本輪驗證涵蓋 plist 結構、欄位綁定、範本設定項、Apple CLI 簽署、公開 URL 檔案下載與後端 API。**未宣稱已在每位使用者的 iPhone 上完成加入捷徑、匯入問題呈現或實際 Apple Pay 付款觸發驗收。** iOS 實機測試請依官網的六步教學執行。

完整圖文安裝教學：https://liubai-ledger.vercel.app/#guide
Apple 官方分享說明：https://support.apple.com/zh-tw/guide/shortcuts/apdf01f8c054/ios
