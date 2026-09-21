import { useMemo, useState } from "react";
import { Check, Copy, Github, ShieldCheck, Smartphone, Wifi } from "lucide-react";

const IS_PUBLIC_DOCS = import.meta.env.VITE_PUBLIC_DOCS === "1";
const GITHUB_URL = (import.meta.env.VITE_GITHUB_URL as string | undefined)?.trim();

function defaultEndpoint(): string {
  if (IS_PUBLIC_DOCS || typeof window === "undefined") {
    return "https://YOUR-LEDGER.example.com/api/wallet";
  }
  return window.location.origin + "/api/wallet";
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function SetupPage() {
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [health, setHealth] = useState<"idle" | "checking" | "ok" | "error">("idle");

  const healthUrl = useMemo(
    () => endpoint.replace(/\/api\/wallet\/?$/, "/api/health"),
    [endpoint],
  );

  const copy = async (key: string, value: string) => {
    await copyText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const checkConnection = async () => {
    setHealth("checking");
    try {
      const res = await fetch(healthUrl);
      setHealth(res.ok ? "ok" : "error");
    } catch {
      setHealth("error");
    }
  };

  return (
    <div className="setup-page">
      <header className="setup-hero">
        <div className="setup-hero-icon" aria-hidden="true"><Smartphone size={26} /></div>
        <div>
          <p className="section-eyebrow">Apple Pay 自動記帳</p>
          <h1 className="page-title">把 iPhone 交易接到你的 Ledger</h1>
          <p className="page-subtitle">不用銀行帳密。Wallet 交易觸發後，由捷徑把必要欄位 POST 到你自己的 Ledger。</p>
          {IS_PUBLIC_DOCS ? (
            <div className="setup-public-actions">
              <span className="setup-public-badge">留白工作室 · Open Source</span>
              {GITHUB_URL ? (
                <a className="secondary-action" href={GITHUB_URL} target="_blank" rel="noreferrer">
                  <Github size={16} /> GitHub 開源專案 ★
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <section className="card setup-card">
        <div className="setup-step-head"><span className="setup-step-no">1</span><div><h2>設定你的 Ledger URL</h2><p>網址必須從 iPhone 可連線，並以 <code>/api/wallet</code> 結尾。</p></div></div>
        <label className="setup-label" htmlFor="ledger-endpoint">Ledger API URL</label>
        <div className="setup-copy-row">
          <input id="ledger-endpoint" className="lp-input setup-mono" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
          <button className="secondary-action" type="button" onClick={() => void copy("url", endpoint)}>{copied === "url" ? <Check size={16}/> : <Copy size={16}/>}複製</button>
        </div>
        <button className="text-action setup-health" type="button" onClick={() => void checkConnection()} disabled={health === "checking"}>
          <Wifi size={16}/>{health === "checking" ? "檢查中…" : health === "ok" ? "連線正常 ✓" : health === "error" ? "連線失敗，再試一次" : "檢查 API 連線"}
        </button>
      </section>
      <section className="card setup-card">
        <div className="setup-step-head"><span className="setup-step-no">2</span><div><h2>加入 API Token</h2><p>如果伺服器設定了 LEDGER_INGEST_TOKEN，捷徑也要送同一個值。</p></div></div>
        <label className="setup-label" htmlFor="ledger-token">X-Ledger-Token</label>
        <div className="setup-copy-row">
          <input id="ledger-token" className="lp-input setup-mono" type="password" autoComplete="off" placeholder="貼上你自己的 token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="secondary-action" type="button" disabled={!token} onClick={() => void copy("token", token)}>{copied === "token" ? <Check size={16}/> : <Copy size={16}/>}複製</button>
        </div>
        <p className="setup-privacy-note">這個欄位只存在瀏覽器記憶體，不會寫進 Ledger 資料庫或 localStorage。</p>
      </section>

      <section className="card setup-card">
        <div className="setup-step-head"><span className="setup-step-no">3</span><div><h2>建立 iPhone「交易」自動化</h2><p>捷徑 App → 自動化 → ＋ → 交易，選要監聽的卡片並設為自動執行。</p></div></div>
        <ol className="setup-list">
          <li>新增「取得 URL 內容」，URL 貼上上面的 Ledger API URL。</li>
          <li>方法選 <strong>POST</strong>，Request Body 選 <strong>JSON</strong>。</li>
          <li>Header 新增 <code>X-Ledger-Token</code>，值填你自己的 token。</li>
          <li>JSON 依下方欄位，把「交易」觸發器輸出變數帶入。</li>
        </ol>
      </section>
      <section className="setup-payload-grid">
        <div className="card setup-mini-card"><code>amount</code><span>交易 → Amount</span></div>
        <div className="card setup-mini-card"><code>merchant</code><span>交易 → Merchant</span></div>
        <div className="card setup-mini-card"><code>card</code><span>交易 → Card or Pass</span></div>
        <div className="card setup-mini-card"><code>payment_method</code><span>固定填 apple_pay</span></div>
        <div className="card setup-mini-card"><code>time_source</code><span>固定填 wallet_transaction</span></div>
        <div className="card setup-mini-card"><code>occurred_at</code><span>可選；沒有就省略</span></div>
      </section>

      <section className="card setup-card setup-security">
        <ShieldCheck size={22} aria-hidden="true" />
        <div>
          <h2>隱私預設</h2>
          <p>Ledger 不要求定位。公開版預設不保存 GPS、原始 Wallet payload 或卡片 raw label；只有你主動開啟 LEDGER_STORE_LOCATION 才保存位置。</p>
          <p>若使用公開網域，務必設定 LEDGER_INGEST_TOKEN；若只想私人使用，可用 Tailscale Serve 讓 URL 僅在自己的 tailnet 存取。</p>
        </div>
      </section>
    </div>
  );
}
