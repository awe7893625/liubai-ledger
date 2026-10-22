import "./site.css";

const SUPPORT_EMAIL = "asdapper8866@gmail.com";

function Privacy() {
  return (
    <>
      <p className="ls-legal-kicker">Privacy</p>
      <h1>隱私權政策</h1>
      <p className="ls-legal-updated">最後更新：2026 年 10 月 22 日</p>
      <p>留白 Ledger 是一個免費 Beta 記帳服務。我們以「完成記帳功能所需的最少資料」為原則處理資料，不販售個人資料，也不以帳務內容做廣告定向。</p>

      <h2>我們處理哪些資料</h2>
      <p><strong>帳號資料：</strong>使用帳號密碼登入時，我們保存帳號識別資訊與 Supabase Auth 所需資料；使用 Google 登入時，我們會驗證 Google 提供的 ID token 與 Email 已驗證狀態，但不把 Google Email 或大頭貼寫入 Ledger 資料庫。我們只保存 Google 帳號穩定識別碼的不可逆雜湊，以及 Google 提供的顯示名稱（若有）。</p>
      <p><strong>帳本資料：</strong>你主動建立或由裝置送入的交易、金額、商家、時間、帳戶、分類、備註，以及必要的去重與裝置配對資訊。</p>
      <p><strong>安全資料：</strong>為防止濫用，我們會建立短期 rate-limit 記錄。網路位址只用於產生不可逆的安全雜湊；rate-limit 記錄目前保留約 48 小時。</p>

      <h2>Google 登入的範圍</h2>
      <p>Google 登入只用於確認你的身份。我們不要求 Gmail、Google Drive、Google Calendar、聯絡人或其他 Google API 的存取權，也不會讀取這些服務的內容。</p>

      <h2>資料如何使用</h2>
      <p>資料僅用於登入驗證、建立及顯示帳本、裝置配對、自動記帳去重、提供你要求的功能、安全防護、錯誤排查與必要的服務維運。</p>

      <h2>服務供應商</h2>
      <p>目前雲端版主要使用 Cloudflare 提供品牌網域代理與 HTTPS、Vercel 提供網站與 API runtime、Supabase 提供身份驗證與 PostgreSQL 資料庫、Google 提供 Google Sign-In 身份驗證。這些供應商會依各自條款處理執行服務所需的資料。</p>

      <h2>資料控制與刪除</h2>
      <p>你可以在「交易」頁匯出 CSV 備份，也可確認後刪除帳本中的個別交易。Beta 期間若要刪除整個帳號與雲端帳本，可寄信至 <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> 提出要求；我們會在確認帳號所有權後處理。</p>

      <h2>安全與限制</h2>
      <p>我們使用租戶隔離（RLS）、伺服器端身份判定與裝置憑證分離來降低跨帳號存取風險。但任何線上服務都無法保證絕對安全，請勿把信用卡完整卡號、銀行密碼、Apple ID 密碼或其他高敏感憑證輸入備註欄位。</p>

      <h2>聯絡方式</h2>
      <p>隱私或資料刪除問題：<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
    </>
  );
}

function Terms() {
  return (
    <>
      <p className="ls-legal-kicker">Terms</p>
      <h1>服務條款</h1>
      <p className="ls-legal-updated">最後更新：2026 年 10 月 21 日</p>
      <p>使用留白 Ledger 免費 Beta 即表示你同意以下條款。若你不同意，請不要建立帳號或送入交易資料。</p>

      <h2>服務內容</h2>
      <p>留白 Ledger 提供雲端記帳、手動交易紀錄，以及在支援條件下的 iPhone／Wallet 自動記帳串接。Beta 功能、容量、介面與支援範圍可能調整。</p>

      <h2>不是金融建議</h2>
      <p>本服務是個人資訊整理工具，不提供會計、稅務、投資、法律或其他專業建議。帳本數字可能因通知延遲、Wallet／銀行資料缺失、重複事件或使用者輸入而不完整。</p>

      <h2>自動記帳限制</h2>
      <p>Apple Wallet、銀行通知、網站 Apple Pay 與作業系統自動化的觸發能力由 Apple、發卡行與裝置環境決定。我們不保證每一筆付款都會自動觸發或即時入帳；重要交易請自行核對。</p>

      <h2>帳號與安全</h2>
      <p>你應妥善保管密碼、復原碼與已配對裝置。請勿濫用服務、繞過 rate limit、嘗試讀取其他使用者資料，或利用服務進行違法活動。</p>

      <h2>免費 Beta 與可用性</h2>
      <p>Beta 目前免費提供，可能設有帳號數、裝置數或合理使用限制。我們可能因維護、安全、供應商限制或產品調整暫停部分功能，並會盡量避免不必要的資料損失。</p>

      <h2>終止與資料刪除</h2>
      <p>你可以停止使用服務並要求刪除帳號。若帳號明顯用於攻擊、濫用或危害其他使用者，我們可能限制或終止存取。</p>

      <h2>聯絡方式</h2>
      <p>服務問題：<a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
    </>
  );
}

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <main className="ledger-site">
      <div className="ls-legal-shell">
        <header className="ls-legal-header">
          <a className="ls-brand" href="/" aria-label="留白 Ledger 首頁"><span className="ls-brand-mark">留</span><span>Ledger</span></a>
          <a href="/connect">登入</a>
        </header>
        <article className="ls-legal-card">{kind === "privacy" ? <Privacy /> : <Terms />}</article>
        <nav className="ls-legal-nav" aria-label="法律文件">
          <a href="/privacy">隱私權政策</a><span>·</span><a href="/terms">服務條款</a>
        </nav>
      </div>
    </main>
  );
}
