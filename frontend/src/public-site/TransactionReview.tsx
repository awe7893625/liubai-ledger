import { useMemo } from "react";
import type { LedgerRow } from "./ledger-data";
import { duplicateCandidates, requiresReview } from "./transaction-integrity";
import "./transaction-review.css";

type Props = { rows: LedgerRow[]; ready: boolean; onEdit: (id: string) => void; onPending: () => void };
const SOURCES: Record<string, string> = { manual: "手動", apple_pay: "Apple Pay", email: "郵件", statement: "帳單", capture: "舊帳本", notification: "通知" };
export function TransactionReview({ rows, ready, onEdit, onPending }: Props) {
  const groups = useMemo(() => duplicateCandidates(rows), [rows]);
  const pending = useMemo(() => rows.filter(requiresReview), [rows]);
  if (!ready || (!pending.length && !groups.length)) return null;
  return <details className="ti-review" aria-label="帳務核對">
    <summary>帳務核對{pending.length ? ` · ${pending.length} 筆待處理` : ""}{groups.length ? ` · ${groups.length} 組可能重複` : ""}</summary>
    <p>比對完整已載入帳本，不受下方篩選影響。相同商家可能是多次正常消費，不會自動排除或刪除。</p>
    {pending.length ? <button className="ls-button ls-secondary" type="button" onClick={onPending}>查看 {pending.length} 筆待核對交易</button> : null}
    {groups.slice(0, 10).map((group) => <section key={group.key} className="ti-review-group">
      <h3>{group.rows[0]?.merchant || "交易"}</h3>
      <p>{group.day} · {group.currency} {(Math.abs(group.amountMinor) / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} · 同帳戶、相同金額、不同來源</p>
      <div>{group.rows.slice(0, 12).map((row) => <button key={row.id} type="button" onClick={() => onEdit(row.id)} aria-label={`核對 ${row.merchant} ${SOURCES[row.source || ""] || row.source || "來源未知"}`}><span>{SOURCES[row.source || ""] || row.source || "來源未知"}</span><span>查看／編輯 →</span></button>)}</div>
      {group.rows.length > 12 ? <p>本組另有 {group.rows.length - 12} 筆，請以商家與日期搜尋後逐筆核對。</p> : null}
    </section>)}
    {groups.length > 10 ? <p>尚有 {groups.length - 10} 組；完成目前項目後重新整理可繼續查看。</p> : null}
    {groups.length ? <p>確認重複後，在編輯中選「重複（不計入收支）」。紀錄會保留，之後可改回已確認；這不是自動合併。</p> : null}
  </details>;
}
