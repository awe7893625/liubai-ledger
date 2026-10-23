# 留白 Ledger SaaS｜功能、UI/UX 與資料同步交接報告

**評估日期**：2026-10-24（Asia/Taipei）  
**正式網址**：https://app.blankspaces.uk/  
**產品定位**：免費公開 Beta；每人獨立雲端帳本，先驗證手動捷徑，再設定 Wallet 交易觸發。  
**來源**：Git 分支與 Vercel `/version.json`、2026-10-24 多尺寸 QA、M4／Movie Lin 的最後成功唯讀核對。  
**重要**：測試畫面全部使用合成帳本資料；未使用 Movie Lin 的私人交易截圖。

## 一、正式交接結論

**UI/UX 的主要行動流程已改善且可用，但不能宣稱「全產品做完」。** 已上線的網頁 Beta 支援 Google／帳密登入、手動記帳、交易編輯與搜尋、分類、卡片帳戶、基本預算／分析、探索與下載簽署捷徑。尚未驗收 iPhone 真機 Wallet 感應；M4 最新資料沒有安全補入 Movie Lin；固定／預留支出與跨裝置一般設定仍依賴未套用的正式 migration。

本輪視覺修正：有既有交易時，首頁把**最近交易移到重複的捷徑教學之前**；新帳本仍優先提供手動捷徑引導；手機「支出／收入／退款」保持同列；交易「重新整理」在窄螢幕是可觸控的 44px 圖示鍵。其餘錶單、導航、間距及字級沿用已驗證的產品修復。

## 二、版本與驗收狀態

| 層級 | 本輪結論 | 證據 |
|---|---|---|
| 公開 Web Beta | 可供人使用，仍須標示 Beta | live health、正式版本、簽署捷徑下載驗證 |
| 手機首頁／交易／記一筆 | 主要修正完成，已做合成資料瀏覽器 QA | 320／390／430 Chromium、390 WebKit、1280 Chromium，layout assertions |
| 探索／卡片分類／一般設定 | 現有流程可用，未達完整 M4 私人版功能對等 | 測試腳本及 screenshots |
| Apple Pay / Shortcuts | 後端配對和捷徑檔案可用；**真機執行未驗收** | `SHORTCUT_MANUAL_FIRST_20261022.md`、下載檔雜湊；無 iPhone NFC 實測回執 |
| M4 → Movie Lin | **一次性舊匯入完成、最新同步未完成** | M4 來源與雲端最後已知筆數、差異分析 |
| 固定／預留支出與雲端偏好 | 候選程式已隔離測試；**正式資料表／部署未完成** | `PLANNING_SETTINGS_CANDIDATE_20261022.md`、schema guard |
| 真實備份還原／監控 | M4 原始 SQLite 有還原檢查；SaaS 全流程災難復原尚缺 | `M4_SOURCE_BACKUP_AND_SYNC_GATES.md` |

**進度量化方式**：公開網頁 Beta 可用程度約 **80–85%（工程估計）**；以「完整版 M4 功能對等＋多人帳本＋Apple Pay 真機自動記帳＋同步＋運維」為目標，整體約 **55–60%（工程估計，非單元測試通過率）**。此估值不表示剩餘功能只須小幅修正；M4 同步與原生捷徑是阻塞中的 P0。

## 三、UI/UX 交付清單及實際問題

| 頁面／環節 | 已修與現在的行為 | 界線／尚待 |
|---|---|---|
| 登入 | App-first 入口、Google 按鈕、帳密登入與復原碼、429 冷卻提示 | 正式環境新帳號端到端驗收可能遇既有安全限流；不可繞過 |
| 首頁 | 精簡標頭、月份／幣別、兩張收支卡、裝置摘要、最近交易在已登入使用者首屏；新戶捷徑引導仍顯示 | 真機 Safari 不等於桌面 WebKit |
| 記一筆 | 支出／收入／退款同列；商家、金額、分類、帳戶、時間、備註；儲存成功回條與重送去重 | 幣別仍以帳戶為基準；未支援完整離線上傳 |
| 交易 | 日期分組、分類與銀行篩選、來源／狀態／幣別、商家搜尋、CSV、編輯、退款轉帳、重複核對 | 批次編修、完整借貸平衡和帳單結算未達原版 |
| 探索 | 規則式帳本問答、核對明細、一句話先填草稿、使用者同意後地點底圖 | 非生成式 AI；無收據 OCR、語音／自動 GPS 全功能 |
| 設定 | 一般／付款與分類／iPhone 捷徑分組；裝置本機暱稱與深色、信用卡別名 | 跨裝置偏好候選版未部署；自助帳號刪除／帳號合併未完成 |
| 捷徑新手引導 | 安裝手動捷徑 → 同裝置實際入帳確認 → Wallet 設定 → 首次感應驗收 | 手動通過 **不等於** iOS 自動化已安裝或線上 Apple Pay 一定觸發 |

**畫面證據**：`docs/ui-preview/20261024/`。包含 `gallery-daily.png`（首頁、手動記帳、交易）、`gallery-features.png`（探索、卡片／分類、捷徑）及逐頁 WebKit 390px 原始 PNG 和桌面 1280px 截圖。**資料為合成測試資料，不是正式帳本或實體 iPhone。**

## 四、M4／Movie Lin 最新資料真實狀態

正確且曾以 M4 正在運作的程序佐證之來源為 `/Users/rain/ledger/backend/data/ledger.db`，不是 M5 的 159 筆舊副本。

- 2026-10-23 已核對 313 筆；後續 M4 以一致 SQLite 備份及唯讀觀察更新至 **314 → 315 筆**（10/24 01:37 的最後記錄，並非本次重新讀庫）。
- Movie Lin 雲端最後一次成功逐筆讀取證據仍為 **159 筆歷史交易**；2026-10-24 本次沒有新的正式雲端交易讀取成功結果，不能推論其現在仍恆等於 159。
- 313 筆與舊 159 筆原件的 ID 比對結果：**154 個共用 ID、舊件 5 個已不存在於新來源、來源有 159 個不同 ID**。後來 314 筆備份又觀察到 **160 個新來源 ID**，其中 5 個與先前舊消費的日期／金額／商家簽名吻合但 ID 不同；另有一組兩筆疑似相同消費。**不能用「總數相減」決定匯入筆數。**
- 更正描述、交易帳戶、分類、備註存在與舊件不同的情況，應保留兩邊資料而不是 source-wins。
- 多次正式庫核對／寫入遭工具安全檢查拒絕。**沒有這些操作的正式核准結果；不應透過替換工具、認證或代理重送。**

已有離線工具：`scripts/backup_m4_source.py`、`scripts/prepare_m4_snapshot.py`、`scripts/ledger_reconcile.py`；其中離線核對只分類新紀錄、變更、刪除、疑似重複，不做 INSERT／UPDATE／DELETE。

## 五、必須結案的阻塞

**P0 — 最新 M4 增量搬遷**：由有權限的流程取得來源與雲端一致快照、原始確認匯入基線，先跑唯讀差異分類、逐筆解決 5 個來源缺失與相同消費疑慮；只允許核准後插入確定缺少的交易，禁止覆蓋雲端既有修改、禁止重建使用者刪除資料。保存逐筆對帳與其他租戶不變證據。

**P0 — 正式 planning/preferences schema**：須經正常核准，套用 `20261022101858_planning_and_preferences.sql` + `20261023074854_planning_reference_ownership.sql`；兩者雜湊、五組 owner composite FK、RLS、GRANT、跨租戶拒絕、版本衝突皆須實庫驗收。先前工具阻擋仍未解除，尚未正式部署。

**P0 — iPhone 真機捷徑**：使用自己的 iPhone 安裝兩支簽署捷徑，至少驗證配對、手動入帳回條、原生 Wallet Transaction 感應、商家與卡片別名、前景／鎖定狀態和重送去重。網頁／App Apple Pay 不能保證有交易觸發。

**P1 — 完整 M4 功能對等／運維**：定期帳單週期、帳戶餘額、進階反思分析、收據辨識與語音、持續同步監控、正式 SaaS 備份還原演練、自助帳號刪除與安全設定。須分模組定義驗收，不能拿「有一個頁籤」當成完工。

## 六、交接操作與拒絕發布條件

**正式版 UI-only 發布**：發布前應確認只有 Web UI、安全測試、合成截圖，沒有帶入待套用 migration。從獨立公開 release 分支執行 `bash scripts/release_public_beta.sh --check`；只有全部通過後才可執行 `--deploy`，且須檢查 `/version.json` 與兩支簽署捷徑雜湊。不得將待發布 planning 分支直接蓋到正式站。

**候選版 schema**：`scripts/check_planning_schema_ready.py` 已具備唯讀門檻檢查。缺少資料表時發布應直接拒絕，不能關掉 guard。

**測試覆蓋**：`npm run typecheck`、`npm run lint`、`npm run test:ledger-ui`、`npm run test:cloud-api`、`npm run build`；`python3 scripts/check_product_finish_ui.py`、`python3 scripts/check_transaction_integrity_ui.py`、`python3 scripts/check_auth_diagnostics_ui.py`。UI fixture 攔截所有 Auth/API 並使用合成測試資料；不能把此成績寫成真實 Apple Pay 驗收。

## 七、2026-10-24 實際發布與測試回執

**正式部署版本**：`57af37fd44e63609f8f72625654734553080db6d`（簡寫 `57af37f`）。  
**Vercel deployment**：`dpl_ChfmL1sAMVMBYvoWSkmbUGr1MhDM`，回報 READY，正式 Alias `app.blankspaces.uk`。  
**已驗證的公開入口**：`/connect`、`/privacy`、`/terms`、`/api/v2/health`、`/version.json`；兩支 `.shortcut` 與簽署發行原檔雜湊相符。

| 具體測試 | 結果 | 性質 |
|---|---:|---|
| API protocol/unit | **49/49 通過** | 本機／合成資源 |
| Ledger presentation/unit | **34/34 通過** | 本機／合成資源 |
| 日常 App 五頁流程 | **30/30 通過** | Chromium 320/390/430/1280、WebKit 390 |
| 交易核對／退款／轉帳 | **20/20 通過** | 隔離 Auth/API |
| 登入錯誤冷卻／診斷 | **16/16 通過** | 隔離 Auth/API |
| 正式站匿名登入畫面 | **2/2 通過** | 正式站 WebKit 390、Chromium 1280 |
| 正式站其他使用者資料寫入 | **未執行** | 原有註冊限流仍存在 |
| 實體 iPhone Wallet 觸發 | **未驗收** | 不能以 WebKit 代替 |

另有 TypeScript、ESLint、production build、正式套件稽核（0 筆已知 production vulnerability）和 release check 通過。測試報告保存在 `.qa/product-finish-20261023` 等忽略資料夾；`docs/ui-preview/20261024/` 保留可供人觀看的合成畫面和匿名正式站登入畫面。

**本輪修正的 UX regressions**：首頁在已記帳用戶優先顯示最近交易；新用戶保留手動捷徑 onboarding；支出、收入、退款三鍵在 320px 仍同列且可觸控；小手機刷新採不換行的 44px 圖示鍵。另有 Codex Luna 唯讀程式審查，限定範圍未發現 P0／P1；它沒有進行部署或真機測試。

**視覺仍待精修**：WebKit 模擬器中的原生日期輸入在截圖顯示類 ISO 格式；需要實體 iPhone 比對所在地格式。完整無障礙輔助功能、低階 iPhone 效能與多語系尚未做正式完整矩陣。

## 八、驗收口徑

- **「程式已寫」不等於「部署完成」。**
- **「部署 READY」不等於「登入後端到端可用」。**
- **「WebKit 截圖」不等於「實體 iPhone 測試」。**
- **「M4 找到最新 DB」不等於「Movie Lin 已更新」。**
- **「手動捷徑成功」不等於「Wallet 觸發成功」。**

正式宣稱完成時，需附：版本 commit／deployment ID、真實使用者流程的隔離驗收、資料對帳筆數、截圖、失敗與回滾紀錄，並明列**沒有執行的測試**。

---

本報告與公開 UI 截圖可交由 Codex／Luna／Claude Code 接手；私人金額明細、憑證與完整帳號 ID 均未寫入。
