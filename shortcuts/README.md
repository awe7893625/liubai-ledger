# Ledger 公開捷徑

公開版重新建立，不包含作者原始捷徑的網址、卡片資訊或聯絡人。

- `src/Ledger-Wallet.plist`：可閱讀的來源；接收 `amount`、`merchant`、`card` 三個 key 的字典。
- `src/Ledger-Manual.plist`：可閱讀的來源；手動詢問金額、商家與卡片／現金。
- 已簽章的下載檔在 `frontend/public/shortcuts/`；SHA-256 在同目錄的 `manifest.json`。

兩份捷徑都使用 `POST /api/wallet`，Header 為 `X-Ledger-Token`，不要求定位、不讀卡號。時間由伺服器補上，因此模板使用 `time_source=server_received`，不偽稱它是銀行交易的原始時間。兩份目前都透過 capture 管線入帳。

安裝：用 iPhone Safari 下載 `.shortcut`，從下載項目或「檔案」App 打開，加入捷徑，再編輯最上方的兩個文字動作（URL、Token）。第一次先執行手動版，以商家「連線測試」、金額 1 元測通，再在自己的 Ledger 流水確認。

Wallet 版必須在 iPhone 自行建立交易自動化：新增字典，把交易 Amount / Merchant / Card or Pass 依序綁到 amount / merchant / card，然後執行 Ledger Wallet，輸入選該字典。勿直接使用作者原始 iCloud 分享連結。

檔案採 macOS `shortcuts sign --mode anyone` 簽章；這不是 Apple 對功能的審核或推薦。已驗證 plist 結構與輸出引用，尚未代表每部 iPhone 都已完成實機匯入或感應驗收。

## 重建

在專案根目錄執行 `python3 scripts/build_public_shortcuts.py`，來源會固定生成，簽章檔須另外透過 macOS 產生。請在簽章之前重新掃描來源，絕對不要把自己配置好的 URL / Token 打包分享。

## Compatible earlier templates

The earlier Ledger-ApplePay.shortcut and Ledger-Manual.shortcut public URLs and their sources under `source/` remain unchanged. The new site's manual template uses Ledger-Manual-v1_1.shortcut, so the published older download is not silently overwritten. The new Wallet template and the new manual template are the two entries described by the public manifest.
