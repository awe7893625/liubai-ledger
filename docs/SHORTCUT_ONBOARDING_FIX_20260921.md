# 留白工作室 · 捷徑安裝教學修正 1.1.2

日期：2026-09-21。

## 本次修正

- 工作室名稱更正為「留白工作室」：目前首頁、Demo、自架 App、HTML metadata、README、LICENSE、API 標題與下載捷徑說明同步修正。
- 官網頁尾與 README 加入工作室既有產品設定使用的 Threads： https://www.threads.net/@blankspacestw 。沒有猜測其他同名帳號。
- 新增 #shortcut-fields：明確區分註解（給人看，可保留）與兩個文字設定（URL／Token，只改內容、不可刪動作）。
- 補上 Value／數值不是強制數字轉換的說明，以及展開「取得 URL 內容」後 URL／POST／Header／JSON 的核對方式。
- Wallet、Manual 新版各分為說明、URL、Token 與執行區，加入兩個個人化輸入問題；仍可手動編輯。既有下載 URL 保留；舊手機捷徑不會被網站自動修改。
- 新／舊下載別名都重新以 anyone 模式簽章，公開檔仍只有占位 URL／Token，未填入任何人的實際設定。

## 驗證證據

Backend：91 項通過。新增 9 項設定／API 契約檢查，驗證：輸入問題指向真正的文字動作、刪除註解不改變請求、URL 不會誤連 Token、標頭使用另一格 Token、商家與卡片保持字串、生成請求在獨立測試 DB 可建立正確的 120 元支出、未帶 Token 時被拒絕。

Frontend：lint 與 production build 通過。六種寬度 320 / 375 / 390 / 430 / 768 / 1440 px 完成測試，包含新逐格教學、品牌、Threads href、深淺色與橫向溢出檢查。13 組 browser assertions 通過，含兩份下載檔 SHA-256 和完整 demo。

瀏覽器斷言完成後，Playwright driver 有一次未正常結束；既有 QA 清理程序只回收該 QA 自己的子行程，未重啟或停止任何私人服務。這不等於 iPhone 實機交易驗收。

## 誠實的驗證邊界

使用者提供的畫面可確認舊版已在 iPhone 編輯器開啟，當時 URL 與 Token 仍為占位值。不能因此宣稱感應付款已記帳成功。

本次針對原始動作及生成的 POST 請求做契約測試，再用測試 API 驗證。此測試不是 Apple Shortcuts 執行引擎，不能取代 iPhone 首次匯入、權限、實際網路連線及感應付款驗收。新版輸入問題的實際顯示也應以目標 iPhone 為準。

通知為 API 回應，非無條件成功提示。只有 ok:true、tx_id 且自己的流水核對正確才算連通；完整流程另外需要交易自動化傳入字典。不得公開自己的 Token，不得同時保留會重複處理同一交易的兩個自動化。

官方說明：
- https://support.apple.com/zh-tw/guide/shortcuts/apdf01294032/ios
- https://support.apple.com/zh-tw/guide/shortcuts/apd58d46713f/ios
- https://support.apple.com/zh-tw/guide/shortcuts/apdf330fd3a0/ios
