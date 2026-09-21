import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, CheckCheck, ChevronRight, Code2, Copy, CreditCard, Download, ExternalLink, Github, Layers3, LockKeyhole, Menu, Moon, Plus, Server, ShieldCheck, Sun, Terminal, Wallet, X, Zap } from "lucide-react";
import type { ReactNode } from "react";
import "./site.css";

const REPO = (import.meta.env.VITE_GITHUB_URL as string | undefined) || "";
const SAMPLES = [
  { name: "日常咖啡", category: "餐飲", time: "09:41", amount: 120 },
  { name: "街角午餐", category: "餐飲", time: "12:10", amount: 180 },
  { name: "城市捷運", category: "交通", time: "13:05", amount: 45 },
  { name: "週末書店", category: "教育", time: "16:20", amount: 420 },
];
const money = (n: number) => n.toLocaleString("zh-TW");
const sourceLinks = {
  transaction: "https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios",
  sharing: "https://support.apple.com/zh-tw/guide/shortcuts/apdf01f8c054/ios",
  signing: "https://support.apple.com/guide/shortcuts-mac/share-shortcuts-apdf01f8c054/mac",
};
const setupCommand = `python3 -m venv .venv\nsource .venv/bin/activate\npip install -r backend/requirements.txt\ncp .env.example .env\npython3 -c 'import secrets; print(secrets.token_urlsafe(32))'`;
const startCommand = `.venv/bin/python -m uvicorn app.web:app \\\n  --app-dir backend --env-file .env \\\n  --host 127.0.0.1 --port 8000`;
const frontendCommand = `cd frontend\nnpm ci\nnpm run build\ncd ..`;
const samplePayload = JSON.stringify({amount:120,merchant:"示範咖啡店",card:"我的日常卡",payment_method:"apple_pay",time_source:"server_received"},null,2);

function CopyButton({ value, label = "複製" }: { value: string; label?: string }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <button type="button" className="ls-copy" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setMessage("已複製"); }
    catch { setMessage("請選取下方文字複製"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2400);
  }}>{message === "已複製" ? <Check size={14}/> : <Copy size={14}/>}<span aria-live="polite">{message || label}</span></button>;
}
function CodeBlock({ title, children }: { title: string; children: string }) {
  return <div className="ls-code"><div className="ls-code-head"><span><Terminal size={14}/>{title}</span><CopyButton value={children}/></div><pre><code>{children}</code></pre></div>;
}
function SectionTitle({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return <div className="ls-section-head"><span className="ls-index">{index}</span><div><h2>{title}</h2><p>{children}</p></div></div>;
}
function ProductDemo() {
  const [tab, setTab] = useState("overview");
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState("");
  const rows = count ? [{name:"示範感應交易",category:"餐飲",time:"剛剛",amount:120},...SAMPLES] : SAMPLES;
  const total = SAMPLES.reduce((s, x) => s + x.amount, 0) + (count ? 120 : 0);
  const used = Math.round(total / 12000 * 100);
  return <div className="ls-demo-stage" id="interactive-demo">
    <div className="ls-demo-orbit" aria-hidden="true"/>
    <div className="ls-demo-app">
      <div className="ls-demo-chrome"><span><i/><i/><i/></span><span><LockKeyhole size={11}/> 你的私人 Ledger</span><span className="ls-mini-label">示範</span></div>
      <div className="ls-demo-body"><aside className="ls-demo-sidebar" aria-label="示範帳本導覽"><div className="ls-demo-brand"><Layers3 size={19}/><strong>Ledger</strong></div><span className="ls-mini-label">MY SPACE</span><button type="button" aria-pressed={tab === "overview"} onClick={() => setTab("overview")}><Wallet size={15}/>總覽</button><button type="button" aria-pressed={tab === "ledger"} onClick={() => setTab("ledger")}><CreditCard size={15}/>交易紀錄</button><div className="ls-demo-local"><span/>僅示範資料</div></aside>
      <div className="ls-demo-content"><div className="ls-demo-top"><h3>{tab === "overview" ? "日常，有跡可循。" : "每一筆，都很清楚。"}</h3><span>2026 年 9 月</span></div>
        {tab === "overview" ? <><div className="ls-demo-balance"><span>本月支出</span><strong><small>NT$</small>{money(total)}</strong><div className="ls-demo-budget"><span>預算 NT$12,000</span><b>{used}%</b></div><div className="ls-progress"><i style={{width:used+"%"}}/></div></div><div className="ls-demo-trends"><div><span>支出節奏</span><div className="ls-bars" aria-label="虛構的每週支出示意">{[28,52,35,72,42,86,58,36,65,48,75,52].map((h,i)=><i key={i} style={{height:h+"%"}}/>)}</div><div className="ls-axis"><span>月初</span><span>現在</span></div></div><div className="ls-demo-category"><span>主要分類</span><div className="ls-ring"><b>餐飲</b></div><small>留點預算，給喜歡的事</small></div></div></> : <div className="ls-demo-ledger-title"><strong>{rows.length} 筆示範紀錄</strong><span>全部分類</span></div>}
        <div className="ls-demo-rows">{rows.slice(0,tab === "overview" ? 2 : 5).map((r,i)=><div className="ls-demo-row" key={r.name}><span className="ls-demo-row-icon">{i%2 ? <CreditCard size={16}/> : <Wallet size={16}/>}</span><div><b>{r.name}</b><small>{r.category} · {r.time}</small></div><strong>−{money(r.amount)}</strong></div>)}</div>
      </div></div>
    </div>
    <div className="ls-demo-phone"><div className="ls-phone-island"/><div className="ls-phone-time">9:41 <span>••• ▰</span></div><div className="ls-phone-emblem"><CheckCheck size={25}/></div><span className="ls-mini-label">APPLE PAY → LEDGER</span><h3>{count ? "示範交易已加入" : "一碰，記下一筆。"}</h3><div className="ls-phone-amount"><small>NT$</small>120</div><p>示範咖啡店<br/><span>我的日常卡 · 餐飲</span></p><button type="button" className="ls-button ls-primary" onClick={()=>{setCount(count?0:1);setTab("ledger");setNotice(count ? "示範帳本已還原。" : "已加入示範交易，沒有傳送任何資料。");}}><Zap size={15}/>{count ? "重設示範" : "模擬刷卡"}</button><small>不連線銀行、不送出資料</small><div className="ls-phone-home"/></div>
    <div className="ls-demo-note" aria-live="polite">{notice || "可以試按「模擬刷卡」，看看帳本如何更新。"}</div>
  </div>;
}
const screens = [
  {id:"overview",title:"總覽，掌握每一天",desc:"今日可花、預算進度與最近交易，不用在表格裡找答案。"},
  {id:"transactions",title:"流水，找得到每一筆",desc:"依月份與帳戶查看交易，再點開調整金額、分類與備註。"},
  {id:"capture",title:"現金也能，隨手記下",desc:"金額優先的輸入介面。Apple Pay 之外，手動記帳一樣直覺。"},
];
function ScreenGallery() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected,setSelected] = useState(screens[0]);
  return <><div className="ls-gallery">{screens.map((s,i)=><button className="ls-screen-card" type="button" key={s.id} onClick={()=>{setSelected(s);dialog.current?.showModal();}}><div className="ls-screen-image"><img loading="lazy" src={`/screens/${s.id}.webp`} width="1200" height="900" alt={`Ledger ${s.title}，使用虛構帳本的實際介面截圖`}/><span>點開放大 <Plus size={13}/></span></div><div className="ls-screen-caption"><span>0{i+1} / REAL APP</span><h3>{s.title}</h3><p>{s.desc}</p></div></button>)}</div><p className="ls-caption">實際 App 截圖，使用獨立建立的虛構示範資料；上方互動區是網站展示元件。</p><dialog className="ls-lightbox" ref={dialog} onClick={(e)=>{if(e.target===e.currentTarget)dialog.current?.close();}}><div><header><h3>{selected.title}</h3><button type="button" className="ls-icon-button" aria-label="關閉截圖" onClick={()=>dialog.current?.close()}><X size={20}/></button></header><img src={`/screens/${selected.id}.webp`} alt={selected.title}/><p>虛構資料 · 非私人帳本</p></div></dialog></>;
}
function UrlBuilder() {
  const [base,setBase] = useState("");
  let endpoint = "https://ledger.example.com/api/wallet";
  let error = "";
  let valid = false;
  if(base.trim()) {
    try {
      const u=new URL(base.trim());
      if(u.protocol!=="https:" || u.username || u.password || u.search || u.hash) throw Error("請使用 HTTPS，且不要在網址放帳密、token 或查詢參數。");
      if(["localhost","127.0.0.1","[::1]"].includes(u.hostname)) throw Error("localhost 是手機自己，不是你的 Ledger 主機。");
      const path=u.pathname.replace(/\/+$/,"");
      if(path && path!=="/api/wallet") throw Error("這份教學使用獨立網域；請只貼網域，或完整 /api/wallet 網址。");
      endpoint=u.origin+"/api/wallet"; valid=true;
    } catch(e) {error=e instanceof TypeError ? "請填完整網址，例如 https://你的主機.你的-tailnet.ts.net" : (e as Error).message;}
  }
  return <div className="ls-url-builder"><div className="ls-url-title"><span className="ls-number">02</span><div><h3>填入你的網址，不是我們的網址。</h3><p>只在你的瀏覽器組合 URL，不會送到本站。</p></div></div><label htmlFor="ls-server-url">你的 Ledger HTTPS 網域</label><input id="ls-server-url" type="url" autoComplete="off" spellCheck={false} placeholder="https://你的主機.你的-tailnet.ts.net" value={base} onChange={(e)=>setBase(e.target.value)} aria-invalid={!!error} aria-describedby="ls-url-note"/><p className={error?"ls-error":"ls-input-note"} id="ls-url-note">{error || "Tailscale 使用者：iPhone 與主機需登入同一個私人網路。"}</p><div className="ls-endpoint"><div><small>捷徑裡的 LEDGER_URL</small><code>{endpoint}</code></div><CopyButton value={endpoint}/></div>{valid ? <a className="ls-text-link" target="_blank" rel="noreferrer" href={endpoint.replace(/wallet$/,"health")}>在新分頁檢查自己的 API <ExternalLink size={14}/></a> : <span className="ls-input-note">上方是範例，填入自己的網域後才能檢查連線。</span>}<div className="ls-callout"><ShieldCheck size={18}/><p>API Token 請直接填在自己的捷徑裡。公開網站不收你的 Token，也不是記帳 API。</p></div></div>;
}
const autoSteps = [
  {title:"選擇交易觸發器",subtitle:"捷徑 → 自動化 → ＋ → 交易／錢包",copy:"這個自動化必須在你的 iPhone 建立；下載捷徑不會代替這一步。以 Wallet 提供的感應交易觸發器為準。",screenTitle:"新增自動化",rows:["時間", "抵達", "交易／錢包", "App"],active:2},
  {title:"選卡片與執行方式",subtitle:"勾選想記錄的卡片 → 立即執行",copy:"選自己的卡片；首次執行先完成網路權限。若鎖定時無法執行，先解鎖測試再切回立即執行。",screenTitle:"當我感應時",rows:["✓ 我的日常卡", "○ 其他卡片", "立即執行", "執行前確認"],active:2},
  {title:"把交易欄位放進字典",subtitle:"新增「字典」→ 綁定交易輸出變數",copy:"amount 綁 Amount、merchant 綁 Merchant、card 綁 Card or Pass。不要把「Amount」幾個字打成固定文字；要點選真正的變數。",screenTitle:"字典",rows:["amount  →  Amount", "merchant  →  Merchant", "card  →  Card or Pass"],active:0},
  {title:"把字典交給 Wallet 捷徑",subtitle:"執行捷徑 → Ledger Wallet → 輸入：字典",copy:"選剛剛安裝並設定好的 Ledger Wallet，把前一步的字典設為輸入。感應測試後，回到自己的 Ledger 檢查流水；未知卡片會進「未指定卡片」。",screenTitle:"執行捷徑",rows:["捷徑  Ledger Wallet", "輸入  字典", "完成"],active:1},
];
function AutomationGuide() {
  const [step,setStep] = useState(0);
  const s=autoSteps[step];
  return <div className="ls-automation"><div className="ls-step-list" role="tablist" aria-orientation="vertical" aria-label="iPhone 自動化步驟">{autoSteps.map((x,i)=><button type="button" key={x.title} id={`auto-tab-${i}`} role="tab" aria-selected={step===i} aria-controls="auto-panel" onClick={()=>setStep(i)} onKeyDown={(e)=>{if(e.key==="ArrowDown" || e.key==="ArrowUp"){e.preventDefault();const n=(i+(e.key==="ArrowDown"?1:3))%4;setStep(n);document.getElementById(`auto-tab-${n}`)?.focus();}}}><span className="ls-number">0{i+1}</span><span><b>{x.title}</b><small>{x.subtitle}</small></span><ChevronRight size={18}/></button>)}</div><div className="ls-auto-panel" id="auto-panel" role="tabpanel" aria-labelledby={`auto-tab-${step}`}><div className="ls-auto-phone"><div className="ls-phone-island"/><div className="ls-auto-phone-head"><span>‹ 返回</span><b>{s.screenTitle}</b><span>完成</span></div><div className="ls-auto-logo"><Layers3 size={27}/></div>{s.rows.map((row,i)=><div className={`ls-auto-row ${i===s.active?"is-selected":""}`} key={row}><span>{row}</span>{i===s.active?<Check size={16}/>:<ChevronRight size={13}/>}</div>)}<div className="ls-auto-foot">設定示意 · 畫面名稱可能因 iOS 版本不同</div></div><div className="ls-auto-copy"><span className="ls-mini-label">STEP 0{step+1} / 04</span><h3>{s.title}</h3><p>{s.copy}</p><div className="ls-auto-pagination">{autoSteps.map((_,i)=><button type="button" key={i} aria-label={`第 ${i+1} 步`} aria-pressed={step===i} onClick={()=>setStep(i)}/> )}</div></div></div></div>;
}
const faqs = [
  ["這個公開網站可以直接幫我記帳嗎？","不可以。這是產品展示、捷徑下載與設定教學站，不接收交易，也沒有連到作者的私人主機。你需要在自己的電腦或伺服器部署 Ledger，再把捷徑 URL 指向自己的服務。"],
  ["每一筆 Apple Pay、Apple Watch 和網購都會自動記嗎？","不要把它當作完整銀行同步。這份流程使用 iPhone Wallet 的感應交易觸發器；Apple Watch、App 內付款、網購或退款不保證觸發。請依自己的卡片與 iOS 實測，未觸發的交易可用手動捷徑補記。"],
  ["下載檔案後，iPhone 沒有直接出現安裝畫面？","在 Safari 的下載項目或「檔案」App 找到 .shortcut 檔並打開，再加入捷徑。也可由 Mac 用 AirDrop 傳到 iPhone。下載檔已使用 macOS 的 anyone 模式簽章，但這不代表 Apple 審核或保證功能。"],
  ["為什麼回傳 401、404 或 422？","401：確認 X-Ledger-Token 與主機的 LEDGER_INGEST_TOKEN 相同，且主機真的有載入 .env。404：檢查完整路徑 /api/wallet。422：檢查字典欄位，尤其 amount 是否綁定數字而非變數名稱的文字。"],
  ["人在外面，怎麼連到家裡的 Ledger？","建議 iPhone 和主機使用同一個 Tailscale 私人網路，再以 Tailscale Serve 提供 HTTPS。主機必須保持開機，手機也要連上私人網路。只填 localhost 或 127.0.0.1 不會連到你的電腦。"],
  ["只有 X-Ledger-Token 就能安全放到公開網路嗎？","不夠。這個 token 只保護 /api/wallet 的寫入，不保護其他帳戶、流水、匯出 API。請優先使用私人網路；公開部署必須另外在整個服務前加上登入／存取閘道。不要直接把整套後端裸露上網。"],
  ["資料會送去 AI、或保存我的定位嗎？","基本記帳不需要 AI；位置預設不保存。啟用本機或雲端 AI 後，相關辨識內容才會送到你選定的模型。請在自己的部署設定供應者與金鑰。若啟用消費地圖，圖磚服務也會接收到地圖請求。"],
];

export function PublicSite() {
  const [theme,setTheme] = useState<"light"|"dark">(()=>{try{return localStorage.getItem("ledger.site.theme")==="dark"?"dark":"light";}catch{return "light";}});
  const [menu,setMenu] = useState(false);
  const [progress,setProgress] = useState(0);
  useEffect(()=>{document.title="Ledger｜留百工作室 — 讓每次感應，自然成帳";try{localStorage.setItem("ledger.site.theme",theme);}catch{/* optional preference */}document.querySelector('meta[name="theme-color"]')?.setAttribute("content",theme==="dark"?"#15161A":"#F3EFE6");},[theme]);
  useEffect(()=>{const update=()=>{const d=document.documentElement;setProgress(d.scrollHeight>d.clientHeight?d.scrollTop/(d.scrollHeight-d.clientHeight)*100:0);};update();window.addEventListener("scroll",update,{passive:true});return()=>window.removeEventListener("scroll",update);},[]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setMenu(false);};document.addEventListener("keydown",key);return()=>document.removeEventListener("keydown",key);},[]);
  const nav=[ ["preview","畫面導覽"],["install","開始部署"],["shortcuts","安裝捷徑"],["automation","iPhone 設定"] ];
  const cloneCommand=`git clone ${REPO ? REPO+".git" : "YOUR_REPOSITORY_URL"} ledger\ncd ledger`;
  return <div className="ledger-site" data-theme={theme}>
    <a href="#main" className="ls-skip">跳至主要內容</a><div className="ls-reading-progress" style={{width:progress+"%"}}/>
    <header className="ls-nav"><div className="ls-wrap ls-nav-inner"><a className="ls-brand" href="#"><span className="ls-logo"><Layers3 size={22}/></span><span><strong>Ledger<span className="ls-brand-dot">.</span></strong><small>留百工作室</small></span></a><nav className="ls-desktop-nav" aria-label="網站導覽">{nav.map(([id,label])=><a href={`#${id}`} key={id}>{label}</a>)}</nav><div className="ls-nav-actions"><button type="button" className="ls-icon-button" aria-label={theme==="light"?"切換深色模式":"切換淺色模式"} onClick={()=>setTheme(theme==="light"?"dark":"light")}>{theme==="light"?<Moon size={18}/>:<Sun size={18}/>}</button>{REPO?<a className="ls-button ls-github-nav" href={REPO} target="_blank" rel="noreferrer"><Github size={17}/><span>Star on GitHub</span><span aria-hidden="true">↗</span></a>:null}<button type="button" className="ls-icon-button ls-menu-button" aria-label="展開導覽" aria-expanded={menu} aria-controls="ls-mobile-nav" onClick={()=>setMenu(!menu)}>{menu?<X size={20}/>:<Menu size={20}/>}</button></div></div>{menu?<nav id="ls-mobile-nav" className="ls-mobile-menu" aria-label="手機導覽">{nav.map(([id,label])=><a key={id} href={`#${id}`} onClick={()=>setMenu(false)}>{label}<ArrowRight size={16}/></a>)}</nav>:null}</header>
    <main id="main"><section className="ls-hero ls-wrap"><div className="ls-hero-copy"><span className="ls-eyebrow"><span/> LOCAL-FIRST · OPEN SOURCE</span><h1>花錢的瞬間，<br/><em>生活自動成帳。</em></h1><p className="ls-hero-description">Apple Pay 感應後，用 iPhone 捷徑留下一筆紀錄。<br className="ls-desktop-only"/>一個自己的帳本，一次設定的輕鬆。</p><div className="ls-hero-actions"><a className="ls-button ls-primary" href="#shortcuts">安裝記帳捷徑 <ArrowRight size={17}/></a><a className="ls-button ls-secondary" href="#preview">先看看畫面 <ArrowDown size={16}/></a></div><div className="ls-hero-trust"><span><ShieldCheck size={15}/> 不需要銀行帳密</span><span><Server size={15}/> 帳本在自己的主機</span></div><p className="ls-hero-footnote">適用 Wallet 感應交易觸發器 · 不是銀行帳務同步服務</p></div><ProductDemo/></section>
    <div className="ls-strip"><div className="ls-wrap"><span>記帳可以簡單，<b>資料不必交出去。</b></span><div><span><Code2 size={15}/> FastAPI + React</span><span><Server size={15}/> SQLite</span><span><Github size={15}/> MIT License</span></div></div></div>
    <section className="ls-section ls-wrap" id="preview"><SectionTitle index="01 / THE PRODUCT" title="不是另一張表格，是你的日常。">從一筆支出，到整個月的節奏。先看看實際介面，再決定怎麼使用。</SectionTitle><ScreenGallery/></section>
    <section className="ls-workflow-band"><div className="ls-wrap"><div><span className="ls-eyebrow">A SIMPLE CONNECTION</span><h2>一次設定，<br/>之後少做一件事。</h2></div><div className="ls-flow">{[[CreditCard,"感應付款","你自己的 Wallet 卡片"],[Zap,"捷徑傳送","金額 · 商家 · 卡片標籤"],[Wallet,"你的 Ledger","分類、預算與日常紀錄"]].map(([Icon,title,desc],i)=>{const I=Icon as typeof Wallet;return <div className="ls-flow-item" key={i}><span><I size={22}/></span><h3>{title as string}</h3><p>{desc as string}</p></div>;})}</div></div></section>
    <section className="ls-section ls-wrap" id="install"><SectionTitle index="02 / SELF-HOST" title="先安頓帳本，再連接手機。">這是自架系統，不是註冊即用的雲端帳本。以下命令皆從專案根目錄執行。</SectionTitle><div className="ls-install-grid"><div className="ls-install-intro"><span className="ls-tag">Mac / Linux · Node.js 22.12+ · Python 3.11+</span><h3>一台主機，<br/>一個私人的資料空間。</h3><p>準備 Git、Python、Node.js，下載程式碼後建立環境。不要把你的資料庫放進 GitHub。</p><div className="ls-callout"><LockKeyhole size={18}/><p>先採用私人網路。<strong>Token 只保護捷徑寫入</strong>，不是整個帳本的登入機制。</p></div>{REPO?<a className="ls-text-link" href={`${REPO}/blob/main/README.md`} target="_blank" rel="noreferrer">完整部署文件 <ExternalLink size={14}/></a>:null}</div><div className="ls-install-code"><CodeBlock title="01 — 下載程式碼">{cloneCommand}</CodeBlock><details className="ls-install-detail"><summary>02 — 安裝後端與產生 Token <Plus size={16}/></summary><CodeBlock title="專案根目錄">{setupCommand}</CodeBlock><p>把最後一行產生的隨機值，填入自己的 .env 中 LEDGER_INGEST_TOKEN；不要使用預設值。DATABASE_URL 保持以專案根目錄為基準。</p></details><details className="ls-install-detail"><summary>03 — 啟動後端與前端 <Plus size={16}/></summary><CodeBlock title="步驟一：建立前端">{frontendCommand}</CodeBlock><CodeBlock title="步驟二：同源網站 + API，會載入 .env">{startCommand}</CodeBlock><p>在電腦打開 http://localhost:8000。手機端使用下一步的 HTTPS 網址，同一個網址同時提供帳本與 API。</p></details><details className="ls-install-detail"><summary>04 — 手機在外面，也能連回來 <Plus size={16}/></summary><p>iPhone 與主機安裝 Tailscale、登入同一個私人網路。以 Tailscale Serve 把你選定的本機服務放到 HTTPS；設定後先用 iPhone Safari 開 /api/health 檢查。不要開啟 Funnel 把私人帳本公開。</p><CodeBlock title="主機上執行；僅分享至你的私人網路">{"tailscale serve --bg http://127.0.0.1:8000"}</CodeBlock><p>複製 Tailscale 顯示的 HTTPS 網址。在 iPhone Safari 開啟，應看得到帳本；網址後加 /api/health 應回 status: ok。再把同一網域填入下方工具，產生捷徑 URL。</p><a className="ls-text-link" href="https://tailscale.com/kb/1242/tailscale-serve" target="_blank" rel="noreferrer">Tailscale 官方設定說明 <ExternalLink size={14}/></a></details></div></div></section>
    <section className="ls-section ls-shortcuts-section" id="shortcuts"><div className="ls-wrap"><SectionTitle index="03 / INSTALL SHORTCUTS" title="把兩個小幫手，放進你的 iPhone。">公開版捷徑沒有作者的網址、Token 或卡片。安裝後，只連到你自己的 Ledger。</SectionTitle><div className="ls-download-grid"><article className="ls-download-card"><div className="ls-download-icon"><Zap size={24}/></div><div className="ls-download-tags"><span>自動化用</span><span>不要求定位</span></div><h3>Ledger Wallet</h3><p>接收自動化傳入的交易字典，記錄金額、商家與卡片標籤。需要搭配下方 iPhone 設定。</p><a className="ls-button ls-primary" href="/shortcuts/Ledger-Wallet.shortcut" download><Download size={17}/> 下載 Wallet 捷徑</a><small>.shortcut · macOS anyone 模式簽章</small></article><article className="ls-download-card"><div className="ls-download-icon ls-download-icon-alt"><Plus size={24}/></div><div className="ls-download-tags"><span>隨手記帳</span><span>現金也適用</span></div><h3>Ledger Manual</h3><p>手動輸入金額、商家與卡片／現金名稱。先用這個測通，再設定自動化。</p><a className="ls-button ls-secondary" href="/shortcuts/Ledger-Manual-v1_1.shortcut" download><Download size={17}/> 下載手動記帳捷徑</a><small>.shortcut · 不會取得銀行帳密</small></article></div><div className="ls-import-steps">{[["01","加入捷徑","用 iPhone Safari 下載，從下載項目／檔案 App 打開 .shortcut，再點加入捷徑。"],["02","改兩格設定","打開捷徑右上角 ⋯，把最上方 LEDGER_URL 與 LEDGER_TOKEN 兩個文字動作改成自己的值。"],["03","先跑手動版","輸入 NT$1、商家「連線測試」。看到 API 回應後，回自己的 Ledger 流水確認；測試紀錄可手動刪除。"]].map(([n,t,d])=><div key={n}><span className="ls-number">{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div><UrlBuilder/><div className="ls-shortcut-check"><Check size={15}/><p>下載檔已做結構與簽章檢查；iPhone 首次匯入、網路權限及實際感應交易仍需在你的裝置完成驗收。<a href={sourceLinks.signing} target="_blank" rel="noreferrer">了解捷徑分享</a></p></div></div></section>
    <section className="ls-section ls-wrap" id="automation"><SectionTitle index="04 / IPHONE AUTOMATION" title="最後，讓感應付款觸發它。">這不是只有一個下載按鈕。照著四步，把 Wallet 交易交給你剛安裝的捷徑。</SectionTitle><AutomationGuide/><div className="ls-auto-source"><a href={sourceLinks.transaction} target="_blank" rel="noreferrer">Apple 官方：交易記錄觸發器 <ExternalLink size={13}/></a><span>操作圖為示意，非 iOS 實機截圖 · 教學查核 2026-09-21</span></div></section>
    <section className="ls-section ls-wrap ls-details-grid" id="payload"><div><span className="ls-eyebrow">FOR THE CURIOUS</span><h2>送出去的，<br/>就是這些欄位。</h2><p>捷徑使用 POST /api/wallet，搭配 X-Ledger-Token 標頭。金額以「元」表示，正數為支出。下載模板由伺服器補上接收時間，不要求位置，也不讀卡號。</p><CodeBlock title="JSON 範例 · 非真實交易">{samplePayload}</CodeBlock></div><div className="ls-privacy-list">{[[ShieldCheck,"銀行帳密，不需要","Wallet 感應自動化不是登入銀行；不用填網銀帳號、密碼或完整卡號。"],[LockKeyhole,"自己的網址，自己的帳本","開源程式公開，資料庫不公開。網站展示、作者私人帳本與你的部署彼此分離。"],[Server,"AI 可選，定位預設關閉","基本記帳不依賴 AI。雲端模型和位置記錄，都由你自行配置及啟用。"]].map(([Icon,t,d],i)=>{const I=Icon as typeof ShieldCheck;return <div key={i}><span><I size={23}/></span><div><h3>{t as string}</h3><p>{d as string}</p></div></div>;})}</div></section>
    <section className="ls-section ls-wrap" id="faq"><SectionTitle index="05 / GOOD TO KNOW" title="開始之前，說清楚。">功能邊界與常見問題，放在你找得到的地方。</SectionTitle><div className="ls-faq">{faqs.map(([q,a])=><details key={q}><summary>{q}<Plus size={17}/></summary><p>{a}</p></details>)}</div></section>
    <section className="ls-final-cta ls-wrap"><div><span className="ls-eyebrow">BUILT TO BE YOURS</span><h2>留點空間，給生活。<br/><span>記帳交給自己的小工具。</span></h2><p>覺得有幫助，給 Ledger 一顆 Star。<br/>也歡迎回報問題，讓這個開源帳本變得更好。</p></div><div><a className="ls-button ls-primary" href="#shortcuts">開始安裝 <ArrowRight size={16}/></a>{REPO?<a className="ls-button ls-secondary" href={REPO} target="_blank" rel="noreferrer"><Github size={17}/> 到 GitHub 按 Star ↗</a>:null}</div></section></main>
    <footer className="ls-footer"><div className="ls-wrap"><a className="ls-brand" href="#"><span className="ls-logo"><Layers3 size={21}/></span><span><strong>Ledger.</strong><small>留百工作室</small></span></a><p>自己的資料，自己的日常。<br/><span>MIT License · Open source, not your private ledger.</span></p><nav aria-label="頁尾">{REPO?<><a href={REPO} target="_blank" rel="noreferrer">GitHub</a><a href={`${REPO}/issues`} target="_blank" rel="noreferrer">回報問題</a></>:null}<a href="#faq">常見問題</a></nav></div><div className="ls-footer-bottom ls-wrap"><span>© 2026 留百工作室</span><span>Public site v1.1 · NexPilot palette</span></div></footer>
  </div>;
}
