import { lazy, Suspense, useMemo, useState } from "react";
import { Search, MapPin, FileText, ArrowRight, RefreshCw } from "lucide-react";
import type { LedgerRow } from "./ledger-data";
import { ledgerDay } from "./ledger-data";
import { answerLedger, locatedExpenses, parseQuickDraft } from "./explore-data";
import type { Named, QuickDraft } from "./explore-data";
import "./ledger-explore.css";
const LocationMap = lazy(() => import("./LedgerLocationMap"));
const amountLabel = (minor: number, currency: string) => `${minor < 0 ? "−" : ""}${currency === "TWD" ? "NT$" : currency + " "}${(Math.abs(minor) / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
type Props = {
  rows: LedgerRow[]; accounts: Named[]; categories: Named[]; months: string[]; currencies: string[];
  initialMonth: string; initialCurrency: string; ready: boolean; error: string; loading: boolean;
  onRefresh: () => void; onDraft: (draft: QuickDraft) => void; onTransaction: (id: string) => void;
};
export function LedgerExplore({ rows, accounts, categories, months, currencies, initialMonth, initialCurrency, ready, error, loading, onRefresh, onDraft, onTransaction }: Props) {
  const [mode, setMode] = useState<"query" | "locations">("query");
  const [month, setMonth] = useState(initialMonth);
  const [currency, setCurrency] = useState(initialCurrency);
  const [question, setQuestion] = useState("目前月份花多少？");
  const [asked, setAsked] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [mapConsent, setMapConsent] = useState(false);
  const [mapDay, setMapDay] = useState("");
  const [locationLimit, setLocationLimit] = useState(30);
  const usable = ready && !loading && !error;
  const result = useMemo(() => {
    if (!asked || !usable) return null;
    try { return { answer: answerLedger(asked, rows, month, currency, categories, accounts), error: "" }; }
    catch (failure) { return { answer: null, error: failure instanceof Error ? failure.message : "無法確認查詢範圍。" }; }
  }, [asked, rows, month, currency, categories, accounts, usable]);
  const points = useMemo(() => locatedExpenses(rows, month, currency), [rows, month, currency]);
  const dates = useMemo(() => [...new Set(points.map((point) => ledgerDay(point.row)))].sort().reverse(), [points]);
  const visiblePoints = useMemo(() => mapDay ? points.filter((point) => ledgerDay(point.row) === mapDay) : points, [points, mapDay]);
  const geoSpend = visiblePoints.reduce((sum, point) => sum - point.row.amount_minor!, 0);
  const latestDay = rows.map(ledgerDay).sort().slice(-1)[0];
  const submitQuestion = (text: string) => { setAsked(text.trim()); setQuestion(text); setShowEvidence(false); };
  const prepareDraft = () => {
    setDraft(null); setDraftError("");
    try { setDraft(parseQuickDraft(draftText, categories, accounts)); }
    catch (failure) { setDraftError(failure instanceof Error ? failure.message : "請確認輸入格式。"); }
  };
  return <div className="ls-app-page lx-page">
    <header className="ls-app-page-head"><div><p>帳本探索</p><h1>查清楚，再記下一筆</h1><span>使用你已載入的帳本，不向外部 AI 傳送交易。</span></div><button type="button" className="ls-button ls-secondary" disabled={loading} onClick={onRefresh} aria-label="重新整理探索資料"><RefreshCw size={16} /></button></header>
    <div className="lx-tabs" role="group" aria-label="探索功能"><button type="button" aria-pressed={mode === "query"} onClick={() => { setMode("query"); setMapConsent(false); }}><Search size={17} />帳本查詢</button><button type="button" aria-pressed={mode === "locations"} onClick={() => setMode("locations")}><MapPin size={17} />消費地點</button></div>
    <div className="lx-controls"><label>月份<select aria-label="探索月份" value={month} onChange={(event) => { setMonth(event.target.value); setMapDay(""); setMapConsent(false); }}>{months.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>幣別<select aria-label="探索幣別" value={currency} onChange={(event) => { setCurrency(event.target.value); setMapConsent(false); }}>{currencies.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><small>{latestDay ? `帳本最新交易：${latestDay}` : "目前沒有交易"}</small></div>
    {!usable ? <section className="lx-card" role="status"><strong>{error ? "資料未完整更新" : "正在載入帳本"}</strong><p>先完成載入再計算，不把部分資料當成完整帳本。</p></section> : mode === "query" ? <>
      <section className="lx-card" aria-label="帳本查詢">
        <div className="lx-card-head"><Search size={18} /><div><h2>問自己的帳</h2><p>規則式查詢，不是生成式 AI；只回答可從明細核對的問題。</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); submitQuestion(question); }}><label htmlFor="ledger-question">帳務問題</label><div className="lx-input-row"><input id="ledger-question" value={question} maxLength={180} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：本月餐飲多少？" /><button className="ls-button ls-primary" type="submit">查詢</button></div></form>
        <div className="lx-question-chips">{["目前月份花多少？", "今天花多少？", "上週花多少？", "本月商家排行"].map((text) => <button key={text} type="button" onClick={() => submitQuestion(text)}>{text}</button>)}</div>
        {result?.error ? <p className="lx-warning" role="alert">{result.error}</p> : null}
        {result?.answer ? <div className="lx-answer" aria-live="polite">
          <p className="lx-range">{result.answer.period.start} 至 {result.answer.period.end} · {currency}{result.answer.category ? ` · ${result.answer.category}` : ""}{result.answer.account ? ` · ${result.answer.account}` : ""}</p>
          <div className="lx-metrics"><div><span>支出</span><strong>{amountLabel(result.answer.expense, currency)}</strong></div><div><span>收入</span><strong>{amountLabel(result.answer.income, currency)}</strong></div><div><span>退款</span><strong>{amountLabel(result.answer.refunds, currency)}</strong></div><div><span>扣除退款後支出</span><strong>{amountLabel(result.answer.netExpense, currency)}</strong></div></div>
          <p className="lx-hint">已確認 {result.answer.rows.length} 筆；排除 {result.answer.ignored} 筆待確認、無效或轉帳資料。不同幣別不合併。</p>
          {!result.answer.rows.length ? <p className="lx-warning">這段期間沒有符合條件的已確認紀錄，不代表沒有實際消費，也不代表銀行資料已完整同步。</p> : null}
          {result.answer.kind === "merchants" ? <ol className="lx-ranking">{result.answer.merchants.slice(0, 10).map((merchant) => <li key={merchant.name}><span>{merchant.name}<small>{merchant.count} 筆</small></span><strong>{amountLabel(merchant.amount, currency)}</strong></li>)}</ol> : null}
          <button type="button" className="lx-link" onClick={() => setShowEvidence(!showEvidence)} aria-expanded={showEvidence}>{showEvidence ? "收起" : "查看"}計算明細（{result.answer.rows.length} 筆）</button>
          {showEvidence ? <div className="lx-evidence">{result.answer.rows.map((row) => <button type="button" key={row.id} onClick={() => onTransaction(row.id)}><span>{row.merchant || "未填商家"}<small>{ledgerDay(row)}</small></span><strong>{amountLabel(row.amount_minor!, currency)}</strong></button>)}</div> : null}
        </div> : null}
      </section>
      <section className="lx-card" aria-label="一句話記帳草稿"><div className="lx-card-head"><FileText size={18} /><div><h2>一句話，先準備草稿</h2><p>例如「午餐 120」或「收入 薪資 50000」。辨識後仍需在記帳頁確認。</p></div></div>
        <form onSubmit={(event) => { event.preventDefault(); prepareDraft(); }}><label htmlFor="ledger-draft">記帳內容</label><div className="lx-input-row"><input id="ledger-draft" value={draftText} maxLength={180} onChange={(event) => { setDraftText(event.target.value); setDraft(null); setDraftError(""); }} placeholder="午餐 120" /><button className="ls-button ls-secondary" type="submit">解析草稿</button></div></form>
        {draftError ? <p className="lx-warning" role="alert">{draftError}</p> : null}
        {draft ? <div className="lx-draft"><strong>{draft.direction === "income" ? "收入" : "支出"} NT${draft.amount} · {draft.merchant}</strong><p>{draft.day} · {accounts.find((account) => account.id === draft.accountId)?.name || "請到表單選擇付款帳戶"}</p><button className="ls-button ls-primary" type="button" onClick={() => onDraft(draft)}>帶入記帳表單 <ArrowRight size={16} /></button><small>尚未入帳。按表單的「儲存交易」才會寫入。</small></div> : null}
      </section>
    </> : <section className="lx-card" aria-label="消費地點檢視">
      <div className="lx-card-head"><MapPin size={18} /><div><h2>已有定位的消費</h2><p>只讀取交易備註裡已保存的座標；不開啟手機定位、不從商家名稱猜地址。</p></div></div>
      {!points.length ? <div className="lx-empty"><strong>這個月份沒有已保存座標的消費</strong><p>現有雲端捷徑不會自動收集位置。這不影響記帳；沒有座標的交易也不會被刪除或憑空補點。</p></div> : <>
        <label className="lx-day">日期<select aria-label="地點日期" value={mapDay} onChange={(event) => { setMapDay(event.target.value); setLocationLimit(30); }}><option value="">全部日期</option>{dates.map((date) => <option key={date} value={date}>{date}</option>)}</select></label>
        <p className="lx-range">{visiblePoints.length} 筆有定位支出 · {amountLabel(geoSpend, currency)}</p>
        {!mapConsent ? <div className="lx-map-consent"><p>載入底圖會向 OpenStreetMap 傳送你的 IP 與地圖可見區域；商家名稱與金額仍只在瀏覽器顯示。只有你按下後才連線。</p><button className="ls-button ls-secondary" type="button" onClick={() => setMapConsent(true)}>同意並載入地圖</button></div> : <><button className="lx-link" type="button" onClick={() => setMapConsent(false)}>關閉地圖，停止新的底圖請求</button><Suspense fallback={<p role="status">正在載入地圖元件…</p>}><LocationMap points={visiblePoints} /></Suspense></>}
        <div className="lx-place-list">{visiblePoints.slice(0, locationLimit).map((point) => <button type="button" key={point.row.id} onClick={() => onTransaction(point.row.id)}><span><strong>{point.row.merchant || "消費"}</strong><small>{point.label || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`} · {ledgerDay(point.row)}</small></span><b>{amountLabel(-point.row.amount_minor!, currency)}</b></button>)}</div>
        {visiblePoints.length > locationLimit ? <button className="ls-button ls-secondary" onClick={() => setLocationLimit((limit) => limit + 30)}>顯示更多地點</button> : null}
      </>}
    </section>}
  </div>;
}
