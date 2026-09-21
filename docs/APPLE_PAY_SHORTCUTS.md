# Apple Pay 與捷徑安裝教學

[完整圖文教學（六步）](https://liubai-ledger.vercel.app/#guide) · [專案部署與文字安裝教學](../README.md) · [捷徑原始動作／簽署說明](../shortcuts/README.md)

順序：準備私人 Ledger → 加入手動與 Apple Pay 範本 → 填自己的 URL／Token → 設定交易自動化 → 傳入四個欄位的字典 → 驗證 API 回應與流水。

Ingest Token 只保護 /api/wallet，不保護所有帳目 API。私人部署請使用 tailnet；官網不是你的交易接收網址。範本簽署、下載及 API 測試不等於每一部 iPhone 上的實機付款觸發均已驗收。
