import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Github,
  Menu,
  X,
  ShieldCheck,
  Smartphone,
  WalletCards,
  Server,
  Zap,
  Plus,
  LockKeyhole,
  ExternalLink,
  Play,
  BookOpen,
} from "lucide-react";
import type { ReactNode } from "react";
import "./public-site.css";

const DemoLedger = lazy(() => import("./DemoLedger"));
const GIT = (import.meta.env.VITE_GITHUB_URL as string | undefined)?.trim();
const RELEASE = "2026-09-21 · 網站 v1.1";
function GitLink({
  children,
  className = "lb-btn lb-btn-ghost",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={GIT || "#open-source"}
      target={GIT ? "_blank" : undefined}
      rel="noreferrer"
    >
      <Github size={17} />
      {children || "GitHub Star"}
      <ArrowUpRight size={15} />
    </a>
  );
}
function CopyBlock({ code, label = "複製" }: { code: string; label?: string }) {
  const [state, setState] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState("已複製");
    } catch {
      setState("請選取下方文字複製");
    }
  }
  return (
    <div className="lb-code">
      <div className="lb-code-top">
        <span>可複製設定</span>
        <button type="button" onClick={() => void copy()} aria-label={label}>
          <Copy size={14} />
          {state || label}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
      <span className="lb-sr" role="status">
        {state}
      </span>
    </div>
  );
}
const STEPS = [
  "準備帳本",
  "安裝捷徑",
  "設定網址",
  "綁定 Apple Pay",
  "傳入交易欄位",
  "測試入帳",
];
const APP_SCREENS = [
  {
    file: "dashboard-mobile",
    title: "總覽",
    text: "今天還能花多少？本月收支與預算，一眼就看懂。",
  },
  {
    file: "ledger-mobile",
    title: "流水",
    text: "每一筆的金額、商家、分類和來源，都有跡可循。",
  },
  {
    file: "reflect-mobile",
    title: "分析",
    text: "看見支出組成，再決定下個月的生活節奏。",
  },
];
function GuideVisual({ step }: { step: number }) {
  return (
    <div className="lb-guide-visual">
      <div className="lb-visual-label">操作示意・非 iOS 原生截圖</div>
      <div className="lb-mini-phone">
        <div className="lb-phone-top">
          <span>9:41</span>
          <span>● ● ▰</span>
        </div>
        <div className="lb-phone-body">
          {step === 0 && (
            <>
              <Server size={32} />
              <h3>你的私人帳本</h3>
              <div className="lb-flow-node">
                <span>Mac／小型主機</span>
                <CheckCircle2 size={18} />
              </div>
              <div className="lb-flow-line" />
              <div className="lb-flow-node">
                <span>自己的 HTTPS 網址</span>
                <LockKeyhole size={18} />
              </div>
              <div className="lb-flow-line" />
              <div className="lb-flow-node">
                <span>iPhone 可以連線</span>
                <Smartphone size={18} />
              </div>
              <p className="lb-phone-note">
                官網是說明與示範
                <br />
                不是接收你交易的主機
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <div className="lb-shortcut-icon">
                <Zap size={28} />
              </div>
              <h3>Ledger 手動記帳</h3>
              <p>留百工作室・公開範本</p>
              <div className="lb-ios-row">
                文字 <span>你的 API URL</span>
              </div>
              <div className="lb-ios-row">
                文字 <span>你的 Token</span>
              </div>
              <div className="lb-ios-row">
                詢問輸入 <span>金額與商家</span>
              </div>
              <div className="lb-ios-row">
                取得 URL 內容 <span>POST</span>
              </div>
              <div className="lb-ios-button">加入捷徑</div>
              <p className="lb-phone-note">先閱讀動作，再加入自己的捷徑庫</p>
            </>
          )}
          {step === 2 && (
            <>
              <h3>自訂你的捷徑</h3>
              <p>兩個範本都要設定</p>
              <div className="lb-ios-row lb-ios-stack">
                API URL
                <code>
                  https://你的主機
                  <br />
                  /api/wallet
                </code>
              </div>
              <div className="lb-ios-row lb-ios-stack">
                X-Ledger-Token<code>••••••••••••••••</code>
              </div>
              <div className="lb-ios-button">完成</div>
              <p className="lb-phone-note">
                不要填這個官網的網址
                <br />
                不要把 Token 貼給別人
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <h3>交易</h3>
              <p>選擇你自己的卡片</p>
              <div className="lb-ios-row">
                <WalletCards size={18} /> 我的日常卡 <CheckCircle2 size={18} />
              </div>
              <div className="lb-ios-row">
                立即執行 <span className="lb-toggle" />
              </div>
              <div className="lb-ios-row">
                執行前詢問 <span>關閉</span>
              </div>
              <div className="lb-ios-row">
                執行捷徑 <ChevronRight size={16} />
              </div>
              <p className="lb-phone-note">
                選卡與執行方式要在 iPhone 設定
                <br />
                按鈕名稱可能隨 iOS 版本不同
              </p>
            </>
          )}
          {step === 4 && (
            <>
              <h3>建立字典</h3>
              <p>把觸發器的值交給接收捷徑</p>
              {[
                ["amount", "交易 → 金額"],
                ["merchant", "交易 → 商家"],
                ["card", "交易 → 卡片"],
                ["occurred_at", "ISO 8601 日期"],
              ].map(([k, v]) => (
                <div className="lb-ios-row" key={k}>
                  <code>{k}</code>
                  <span>{v}</span>
                </div>
              ))}
              <div className="lb-flow-line" />
              <div className="lb-ios-row lb-ios-stack">
                執行「Ledger Apple Pay」<span>輸入 = 上方字典</span>
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <CheckCircle2 className="lb-success-icon" size={44} />
              <h3>確認這一筆，真的到了</h3>
              <div className="lb-demo-receipt">
                <span>示範咖啡店</span>
                <strong>NT$ 1</strong>
                <small>先用手動範本測試</small>
              </div>
              <div className="lb-ios-row">
                API 回應 <code>ok: true</code>
              </div>
              <div className="lb-ios-row">
                交易識別碼 <code>tx_id</code>
              </div>
              <p className="lb-phone-note">
                再到「流水」核對
                <br />
                最後才測試實際 Apple Pay
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function GuideContent({ step }: { step: number }) {
  const [endpoint, setEndpoint] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  function normalize() {
    try {
      const u = new URL(endpoint.trim());
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw new Error("請填自己的 HTTPS 網址，不可包含帳密、查詢參數或 #。");
      if (
        u.hostname.includes("liubai-ledger.vercel.app") ||
        u.hostname.endsWith("example.com") ||
        u.hostname.endsWith(".invalid")
      )
        throw new Error(
          "官網與範例網址不是你的記帳主機，請換成自己部署後取得的網址。",
        );
      if (
        !["/", "", "/api", "/api/", "/api/wallet", "/api/wallet/"].includes(
          u.pathname,
        )
      )
        throw new Error("請填網域根網址，或已確定可用的 /api/wallet 網址。");
      u.pathname = "/api/wallet";
      setResult(u.href);
      setError("");
    } catch (e) {
      setResult("");
      setError(
        e instanceof TypeError
          ? "請輸入完整網址，例如 https://你的主機名稱.ts.net。"
          : (e as Error).message,
      );
    }
  }
  if (step === 0)
    return (
      <>
        <span className="lb-eyebrow">先完成・只需要一次</span>
        <h3>
          先有自己的 Ledger，
          <br />
          再把 iPhone 接進來。
        </h3>
        <p>
          這個網站不會替你保存帳目。請在自己的電腦部署開源版，設定私人連線，再用
          iPhone Safari 確認可以開啟。
        </p>
        <details className="lb-details">
          <summary>
            開啟完整部署指令 <Plus size={17} />
          </summary>
          <p>
            需具備 Python 環境、Node.js（符合 frontend/package.json
            的引擎需求）及 Git。先從 GitHub 的 Code 按鈕複製 clone 網址。
          </p>
          <CopyBlock
            code={
              "git clone 你複製的專案網址 ledger\ncd ledger\npython3 -m venv backend/.venv\nsource backend/.venv/bin/activate\npip install -r backend/requirements.txt\npython3 scripts/setup_env.py\n(cd frontend && npm ci && npm run build)\ncd backend\npython -m uvicorn app.web:app --env-file ../.env --host 127.0.0.1 --port 8000"
            }
          />
          <p>
            本機打開 <code>http://127.0.0.1:8000</code>
            ；主機必須保持開機。環境設定腳本會建立自己的隨機
            Token，並保護設定檔權限，不覆蓋既有設定。
          </p>
        </details>
        <details className="lb-details">
          <summary>
            取得手機可連的私人 HTTPS URL <Plus size={17} />
          </summary>
          <p>
            主機與 iPhone 都安裝 Tailscale、加入同一個
            tailnet。主機執行下方命令，依提示啟用 HTTPS，複製它印出的完整網址。
          </p>
          <CopyBlock code={"tailscale serve --bg http://127.0.0.1:8000"} />
          <p>
            在 iPhone 開啟 Tailscale 連線，再用 Safari 打開「該網址 +
            /api/health」。看到 JSON 的 <code>status: ok</code>{" "}
            才繼續；這只驗證連線，尚未驗證 Token 或交易寫入。
          </p>
        </details>
        <div className="lb-note">
          <ShieldCheck size={20} />
          <p>
            先使用私人 tailnet。
            <strong>Ingest Token 只保護 /api/wallet，不是整站登入保護。</strong>
            其他帳目 API 尚無完整登入機制，不要直接把整個後端裸露到公網。
          </p>
        </div>
      </>
    );
  if (step === 1)
    return (
      <>
        <span className="lb-eyebrow">安裝・兩個公開範本</span>
        <h3>不用從空白捷徑開始。</h3>
        <p>
          先安裝手動版驗證連線，再安裝 Apple Pay 接收版。公開檔案只含範例 URL
          與空白用途的 Token 提示，不含作者的私人連線。
        </p>
        <div className="lb-download-list">
          <a
            href="/shortcuts/Ledger-Manual.shortcut"
            download
            className="lb-download"
          >
            <span className="lb-download-icon">
              <Plus size={21} />
            </span>
            <span>
              <strong>Ledger 手動記帳</strong>
              <small>自己輸入金額、商家和卡片</small>
            </span>
            <Download size={20} />
          </a>
          <a
            href="/shortcuts/Ledger-ApplePay.shortcut"
            download
            className="lb-download"
          >
            <span className="lb-download-icon">
              <WalletCards size={21} />
            </span>
            <span>
              <strong>Ledger Apple Pay</strong>
              <small>接收交易自動化傳入的字典</small>
            </span>
            <Download size={20} />
          </a>
        </div>
        <ol className="lb-ordered">
          <li>
            用 iPhone Safari 點範本；若先下載成檔案，打開「檔案 →
            下載項目」，點選 <code>.shortcut</code>。
          </li>
          <li>
            在捷徑預覽檢查動作，選「加入捷徑」。若未出現匯入頁，從分享選單用「捷徑」開啟；不要略過系統安全警告。
          </li>
          <li>
            依匯入問題填自己的 API URL 與
            Token。沒有跳出問題時，打開捷徑編輯器，修改最前面的兩個「文字」動作。
          </li>
        </ol>
        <div className="lb-note">
          <Smartphone size={20} />
          <p>
            這是可分享的簽署檔案，<strong>不是舊的 iCloud 私人範本</strong>
            。Apple Pay 仍需在你的 iPhone
            完成選卡與字典綁定；檔案簽署不代表已在每款 iPhone 驗證。
          </p>
        </div>
      </>
    );
  if (step === 2)
    return (
      <>
        <span className="lb-eyebrow">連線・不要填官網</span>
        <h3>
          填你自己的 URL，
          <br />
          不是我們的。
        </h3>
        <p>
          例如 Tailscale 命令印出的主機網址。下方只在瀏覽器整理字串，
          <strong>不會發送請求，也不收集 Token</strong>。
        </p>
        <label className="lb-field" htmlFor="endpoint-builder">
          你的 Ledger 主機網址
        </label>
        <div className="lb-input-line">
          <input
            id="endpoint-builder"
            type="url"
            placeholder="https://你的主機名稱.ts.net"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
          <button
            className="lb-btn lb-btn-primary"
            type="button"
            onClick={normalize}
          >
            產生 URL
          </button>
        </div>
        <div role="status">
          {error && <p className="lb-error">{error}</p>}
          {result && <CopyBlock code={result} />}
        </div>
        <ol className="lb-ordered">
          <li>
            把產生的 <code>/api/wallet</code> 網址貼到
            <strong>兩個捷徑最前面的 API URL 文字動作</strong>。
          </li>
          <li>
            在自己的主機打開根目錄 <code>.env</code>，取出{" "}
            <code>LEDGER_INGEST_TOKEN=</code> 後面的值，填到
            <strong>兩個捷徑的 Token 文字動作</strong>。
          </li>
          <li>
            伺服器必須用 <code>--env-file ../.env</code> 啟動；只把 Token
            寫進檔案，不代表執行中的服務已載入。
          </li>
        </ol>
        <div className="lb-note">
          <LockKeyhole size={20} />
          <p>
            Token 是寫入權限。不要放在 URL 查詢字串、截圖、GitHub
            或公開留言，也不要把填好 Token 的捷徑再次分享。
          </p>
        </div>
      </>
    );
  if (step === 3)
    return (
      <>
        <span className="lb-eyebrow">自動化・在 iPhone 完成</span>
        <h3>
          讓你選的卡片，
          <br />
          觸發這條流程。
        </h3>
        <ol className="lb-ordered">
          <li>
            打開「捷徑」App，進入「自動化」並新增「交易／交易記錄」。較新版本也可能從捷徑的「編輯
            → 自動化」新增。
          </li>
          <li>
            勾選<strong>自己的卡片</strong>
            ，不是範例卡名。依畫面選「立即執行」，或關閉「執行前詢問」。
          </li>
          <li>
            建立空白動作流程，先新增下一步的「字典」，再新增「執行捷徑 → Ledger
            Apple Pay」。不要只選一個沒有傳入值的捷徑。
          </li>
        </ol>
        <div className="lb-note">
          <Smartphone size={20} />
          <p>
            Apple 官方把交易觸發描述為選卡後的 <strong>When I tap</strong>
            。不是匯入歷史帳單，也不能保證所有 App
            內購、線上付款或發卡行都提供一樣的欄位。請用自己的卡實測。
          </p>
        </div>
        <a
          className="lb-text-link"
          href="https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios"
          target="_blank"
          rel="noreferrer"
        >
          Apple 交易觸發器說明 <ExternalLink size={14} />
        </a>
      </>
    );
  if (step === 4)
    return (
      <>
        <span className="lb-eyebrow">欄位・這一步不能省略</span>
        <h3>
          不是打上「金額」兩個字，
          <br />
          而是選取交易變數。
        </h3>
        <p>
          在「字典」動作新增以下四個 key。value
          點選「捷徑輸入／交易」魔術變數，再選對應屬性。交易未提供日期時，先新增「目前日期
          → 格式化日期（ISO 8601）」。
        </p>
        <div className="lb-table-wrap">
          <table>
            <thead>
              <tr>
                <th>字典 key</th>
                <th>值從哪裡來</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>amount</code>
                </td>
                <td>交易 → Amount／金額；數字或貨幣字串</td>
              </tr>
              <tr>
                <td>
                  <code>merchant</code>
                </td>
                <td>交易 → Merchant／商家</td>
              </tr>
              <tr>
                <td>
                  <code>card</code>
                </td>
                <td>交易 → Card or Pass／卡片或票卡</td>
              </tr>
              <tr>
                <td>
                  <code>occurred_at</code>
                </td>
                <td>交易時間或觸發當下的 ISO 8601 日期</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>「執行捷徑」的輸入，要選上方的字典。</strong>
          接收範本會讀取四個值，並送出 POST JSON 與
          X-Ledger-Token。缺少金額時不要用固定數字假裝成功；先修好變數綁定。
        </p>
        <details className="lb-details">
          <summary>
            後端實際接收的 JSON 長什麼樣 <Plus size={17} />
          </summary>
          <CopyBlock
            code={
              '{\n  "amount": 128,\n  "merchant": "示範咖啡店",\n  "card": "我的日常卡",\n  "occurred_at": "2026-09-21T12:30:00+08:00",\n  "payment_method": "apple_pay",\n  "time_source": "shortcut_trigger"\n}'
            }
          />
          <p>這是範例，不要直接把固定示範金額用在自動化。位置不是必要欄位。</p>
        </details>
        <details className="lb-details">
          <summary>
            不匯入範本，直接手動建立 HTTP 動作 <Plus size={17} />
          </summary>
          <ol className="lb-ordered">
            <li>
              在交易自動化新增「取得 URL 內容」，URL 填自己的 /api/wallet 網址。
            </li>
            <li>展開選項，方法選 POST、要求本文選 JSON。</li>
            <li>標頭新增 X-Ledger-Token，值填自己主機的 Token。</li>
            <li>
              JSON 新增上表四個欄位並綁定相同變數，再新增 payment_method =
              apple_pay、time_source = shortcut_trigger。
            </li>
            <li>
              這條手動路徑直接送出
              HTTP，不再新增「執行捷徑」，避免同一筆送兩次。測試並核對第 6 步。
            </li>
          </ol>
        </details>
      </>
    );
  return (
    <>
      <span className="lb-eyebrow">驗收・從 1 元測試開始</span>
      <h3>
        看到 API 回應，
        <br />
        還要看到帳本裡的那一筆。
      </h3>
      <ol className="lb-ordered">
        <li>
          先執行「Ledger 手動記帳」，輸入{" "}
          <strong>1 元、示範咖啡店、你的卡片暱稱</strong>
          。這只是一筆記帳測試，不會真的付款。
        </li>
        <li>
          允許捷徑連到<strong>自己的主機</strong>。檢查回應有{" "}
          <code>ok: true</code> 與 <code>tx_id</code>，而不只是「執行完成」。
        </li>
        <li>
          回
          Ledger「流水」查看金額、日期、商家與帳戶；未分類交易也可能在「待確認」，注意篩選條件。
        </li>
        <li>
          手動版通過後，再用自己的卡測試一筆真實 Apple Pay
          交易，確認自動化有觸發、欄位有值，且帳本真的收到。最後刪除那筆 1
          元示範記錄。
        </li>
      </ol>
      <div className="lb-note">
        <CheckCircle2 size={20} />
        <p>
          本頁提供可照做的驗收流程；沒有把 Mac 上的簽署與 API 測試，當成你的
          iPhone 已驗收。每個人的卡片、網路及 iOS 權限仍需核對。
        </p>
      </div>
      <a className="lb-btn lb-btn-primary" href="/demo">
        先試試不連伺服器的互動示範 <ArrowRight size={17} />
      </a>
    </>
  );
}
export default function PublicSite() {
  const [menu, setMenu] = useState(false);
  const [step, setStep] = useState(0);
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    document.title = "Ledger — 留百工作室｜Apple Pay 自動記帳";
    document.body.classList.add("lb-body");
    return () => document.body.classList.remove("lb-body");
  }, []);
  useEffect(() => {
    if (zoom && dialog.current) dialog.current.showModal();
  }, [zoom]);
  function openImage(file: string, title: string) {
    trigger.current = document.activeElement as HTMLElement;
    setZoom({ src: `/screenshots/${file}.webp`, title });
  }
  function closeImage() {
    dialog.current?.close();
    setZoom(null);
    trigger.current?.focus();
  }
  function goStep(n: number) {
    setStep(n);
    if (window.innerWidth < 760)
      document
        .getElementById("guide-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const demo = window.location.pathname.replace(/\/$/, "") === "/demo";
  return (
    <div className="lb">
      <a href="#main" className="lb-skip">
        跳至主要內容
      </a>
      <header className="lb-header">
        <div className="lb-nav">
          <a href="/" className="lb-brand">
            <span className="lb-brand-mark">
              L<span />
            </span>
            <span>
              Ledger<small>留百工作室</small>
            </span>
          </a>
          <nav
            className={menu ? "lb-nav-links is-open" : "lb-nav-links"}
            aria-label="網站導覽"
          >
            <a href="/#screens" onClick={() => setMenu(false)}>
              介面預覽
            </a>
            <a href="/#guide" onClick={() => setMenu(false)}>
              安裝教學
            </a>
            <a href="/demo" onClick={() => setMenu(false)}>
              互動示範
            </a>
            <a href="/#faq" onClick={() => setMenu(false)}>
              常見問題
            </a>
          </nav>
          <GitLink />
          <button
            className="lb-menu"
            type="button"
            aria-label={menu ? "關閉選單" : "開啟選單"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      {demo ? (
        <main id="main" className="lb-demo-main">
          <Suspense fallback={<p>載入示範中…</p>}>
            <DemoLedger />
          </Suspense>
        </main>
      ) : (
        <main id="main">
          <section className="lb-hero lb-container">
            <div className="lb-hero-copy">
              <span className="lb-eyebrow">
                <span className="lb-dot" /> 開源・自架・Apple Pay
              </span>
              <h1>
                記帳這件小事，
                <br />
                <em>讓它自己發生。</em>
              </h1>
              <p className="lb-lead">
                刷卡後，讓 iPhone 捷徑把消費送進自己的帳本。
                <br className="lb-desktop" />
                少一點手動輸入，多一點對生活的掌握。
              </p>
              <div className="lb-actions">
                <a
                  className="lb-btn lb-btn-primary"
                  href="#guide"
                  onClick={() => setStep(0)}
                >
                  開始安裝與設定 <ArrowRight size={18} />
                </a>
                <a className="lb-btn lb-btn-light" href="/demo">
                  <Play size={16} /> 先試用示範
                </a>
              </div>
              <div className="lb-assurances">
                <span>
                  <Check size={14} />
                  不需銀行帳密
                </span>
                <span>
                  <Check size={14} />
                  預設不記錄定位
                </span>
                <span>
                  <Check size={14} />
                  MIT 開源
                </span>
              </div>
            </div>
            <div className="lb-hero-product">
              <div className="lb-browser">
                <div className="lb-browser-top">
                  <i />
                  <i />
                  <i />
                  <span>Ledger・你的私人帳本</span>
                  <LockKeyhole size={12} />
                </div>
                <button
                  className="lb-hero-image"
                  type="button"
                  aria-label="放大 Ledger 總覽實際畫面"
                  onClick={() =>
                    openImage("dashboard-desktop", "總覽・虛構示範資料")
                  }
                >
                  <img
                    src="/screenshots/dashboard-desktop.webp"
                    alt="Ledger 真實總覽畫面，以虛構帳目示範本月預算與最近交易"
                    width="1440"
                    height="1000"
                    fetchPriority="high"
                  />
                </button>
              </div>
              <button
                className="lb-mobile-hero"
                type="button"
                aria-label="放大 Ledger 手機總覽"
                onClick={() =>
                  openImage("dashboard-mobile", "手機總覽・虛構示範資料")
                }
              >
                <img
                  src="/screenshots/dashboard-mobile.webp"
                  alt="Ledger 手機版實際總覽・全部為虛構資料"
                  width="390"
                  height="844"
                />
              </button>
              <div className="lb-capture-note">
                <span>
                  <Check size={18} />
                </span>
                <div>
                  <strong>午餐便當 · NT$128</strong>
                  <small>Apple Pay 捷徑入帳示意</small>
                </div>
                <WalletCards size={21} />
              </div>
              <p className="lb-caption">
                實際軟體畫面・使用虛構示範資料・點圖放大
              </p>
            </div>
          </section>
          <section className="lb-how lb-container" aria-label="運作方式">
            <span>流程很簡單</span>
            <div>
              <Smartphone size={20} />
              <strong>Apple Pay 觸發</strong>
              <ChevronRight size={18} />
              <Zap size={20} />
              <strong>iPhone 捷徑</strong>
              <ChevronRight size={18} />
              <WalletCards size={20} />
              <strong>你的 Ledger</strong>
            </div>
            <small>交易與 Token 只送往你設定的主機</small>
          </section>
          <section id="screens" className="lb-section lb-container">
            <div className="lb-section-head">
              <div>
                <span className="lb-eyebrow">不是只有一個設定頁</span>
                <h2>
                  你的每一筆，
                  <br className="lb-mobile" />
                  都有清楚的位置。
                </h2>
              </div>
              <p>
                以下是用虛構資料啟動開源版後的實際截圖。
                <br />
                可以放大看，也可以直接打開互動示範。
              </p>
            </div>
            <div className="lb-screen-grid">
              {APP_SCREENS.map((screen, i) => (
                <article className="lb-screen-card" key={screen.file}>
                  <div className="lb-screen-heading">
                    <span>0{i + 1}</span>
                    <h3>{screen.title}</h3>
                    <ArrowUpRight size={20} />
                  </div>
                  <p>{screen.text}</p>
                  <button
                    className="lb-phone-shot"
                    type="button"
                    onClick={() =>
                      openImage(screen.file, screen.title + "・虛構示範資料")
                    }
                    aria-label={`放大${screen.title}手機畫面`}
                  >
                    <img
                      src={`/screenshots/${screen.file}.webp`}
                      alt={`Ledger ${screen.title}手機版真實截圖，內容是虛構示範資料`}
                      width="390"
                      height={screen.file === "reflect-mobile" ? 980 : 844}
                      loading="lazy"
                    />
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section id="guide" className="lb-guide-section">
            <div className="lb-container">
              <div className="lb-section-head">
                <div>
                  <span className="lb-eyebrow">一步一步・從安裝到第一筆</span>
                  <h2>
                    把它裝好，
                    <br />
                    不把難題留給你。
                  </h2>
                </div>
                <p>
                  沒有自己的伺服器，從第 1 步開始。
                  <br />
                  已經有 Ledger，直接看第 2 步安裝捷徑。
                </p>
              </div>
              <div className="lb-guide-layout">
                <div
                  className="lb-step-nav"
                  role="tablist"
                  aria-label="安裝教學步驟"
                >
                  {STEPS.map((s, i) => (
                    <button
                      id={`step-${i}`}
                      role="tab"
                      aria-selected={step === i}
                      aria-controls="guide-panel"
                      className={step === i ? "is-active" : ""}
                      key={s}
                      type="button"
                      onClick={() => goStep(i)}
                    >
                      <span>{i + 1}</span>
                      <strong>{s}</strong>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                <section
                  id="guide-panel"
                  className="lb-guide-panel"
                  role="tabpanel"
                  aria-labelledby={`step-${step}`}
                >
                  <div className="lb-guide-text">
                    <GuideContent key={step} step={step} />
                  </div>
                  <GuideVisual step={step} />
                  <div className="lb-guide-bottom">
                    <button
                      className="lb-btn lb-btn-ghost"
                      type="button"
                      disabled={step === 0}
                      onClick={() => goStep(step - 1)}
                    >
                      <ArrowLeft size={16} /> 上一步
                    </button>
                    <span>{step + 1} / 6</span>
                    {step < 5 ? (
                      <button
                        className="lb-btn lb-btn-primary"
                        type="button"
                        onClick={() => goStep(step + 1)}
                      >
                        下一步 <ArrowRight size={16} />
                      </button>
                    ) : (
                      <a className="lb-btn lb-btn-primary" href="#faq">
                        問題排查 <ArrowRight size={16} />
                      </a>
                    )}
                  </div>
                </section>
              </div>
              <div className="lb-guide-foot">
                <BookOpen size={16} />
                <span>
                  教學查核：2026-09-21。系統按鈕與權限提示依你的 iOS 版本為準。
                </span>
              </div>
            </div>
          </section>
          <section id="faq" className="lb-section lb-container lb-faq">
            <div>
              <span className="lb-eyebrow">遇到卡關，先看這裡</span>
              <h2>
                安裝後，
                <br />
                沒有入帳？
              </h2>
              <p>
                先分清楚是連線、權限，
                <br />
                還是欄位綁定出問題。
              </p>
            </div>
            <div className="lb-faq-items">
              {[
                [
                  "下載 .shortcut 後，沒有出現加入畫面？",
                  "先確認用 Safari 而非通訊軟體的內建瀏覽器。到『檔案 → 下載項目』點 .shortcut，或從分享選單用『捷徑』開啟。若系統指出檔案無法驗證，不要繞過警告；改依第 4、5 步手動建立 HTTP 動作，或把錯誤文字回報 GitHub。",
                ],
                [
                  "API 回 401：invalid ingest token",
                  "核對自己的 .env 與兩個捷徑裡的 Token，勿帶入引號、換行或 LEDGER_INGEST_TOKEN= 前綴；Header 名稱為 X-Ledger-Token。用 --env-file 載入設定，變更後重新啟動自己的 Ledger 程序。",
                ],
                [
                  "Safari 能開官網，卻無法自動記帳？",
                  "官網沒有你的記帳後端。必須先部署自己的 Ledger，iPhone 能打開自己的 /api/health；私人 Tailscale 網址只在加入 tailnet 且連線正常時可用。手機裡的 localhost 指手機，不是你的電腦。",
                ],
                [
                  "取得 404、422，或金額是空白？",
                  "404 先查網址是否以 /api/wallet 結尾；422 檢查 amount 是否真的綁到交易金額。『執行捷徑』必須把字典當輸入傳給接收範本。不要用固定金額遮掩變數空值。",
                ],
                [
                  "卡片變成未指定，或流水看不到？",
                  "先在自己的帳戶設定建立卡片暱稱，對照 Wallet 傳入名稱。未命中的卡會歸到『未指定卡片』；未分類交易可能在待確認，請檢查月份、帳戶與狀態篩選。",
                ],
                [
                  "這能抓到所有 Apple Pay 與歷史交易嗎？",
                  "不能保證。這是 iPhone 的交易觸發流程，不是銀行直連或帳單同步；卡片、iOS 版本及付款情境會影響觸發與欄位。歷史資料需要其他匯入流程，失敗也不代表銀行付款失敗。",
                ],
              ].map(([q, a]) => (
                <details className="lb-details" key={q}>
                  <summary>
                    {q}
                    <Plus size={18} />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </section>
          <section id="open-source" className="lb-open-source lb-container">
            <div className="lb-open-mark">
              <Github size={40} />
            </div>
            <div>
              <span className="lb-eyebrow">BUILT BY 留百工作室</span>
              <h2>
                帳本是你的。
                <br />
                程式碼，也是開放的。
              </h2>
              <p>
                自己部署、自己保存。覺得這個專案有幫助，
                <br />
                歡迎到 GitHub 按一顆 Star，讓更多人找到它。
              </p>
            </div>
            <GitLink className="lb-btn lb-btn-white">
              到 GitHub 給顆 Star
            </GitLink>
          </section>
        </main>
      )}
      <footer className="lb-footer lb-container">
        <div>
          <strong>Ledger</strong>
          <span>© 2026 留百工作室 · MIT License</span>
        </div>
        <div>
          <a
            href="https://support.apple.com/zh-tw/guide/shortcuts/apdf01f8c054/ios"
            target="_blank"
            rel="noreferrer"
          >
            Apple 捷徑分享說明
          </a>
          <a
            href="https://tailscale.com/kb/1312/serve"
            target="_blank"
            rel="noreferrer"
          >
            Tailscale 文件
          </a>
          <small>{RELEASE}</small>
        </div>
      </footer>
      {zoom && (
        <dialog
          ref={dialog}
          className="lb-lightbox"
          onCancel={() => {
            setZoom(null);
            trigger.current?.focus();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeImage();
          }}
        >
          <div>
            <header>
              <h2>{zoom.title}</h2>
              <button
                type="button"
                aria-label="關閉放大圖片"
                onClick={closeImage}
              >
                <X />
              </button>
            </header>
            <img src={zoom.src} alt={zoom.title} />
            <p>真實應用截圖，全部內容為虛構示範資料。</p>
          </div>
        </dialog>
      )}
    </div>
  );
}
