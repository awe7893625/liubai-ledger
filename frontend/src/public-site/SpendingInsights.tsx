import { useMemo } from "react";
import { ledgerDay } from "./ledger-data";
import type { LedgerRow } from "./ledger-data";
import "./spending-insights.css";

type Label = { id: string; name: string };
type Props = { transactions: LedgerRow[]; month: string; currency: string; categories: Label[]; accounts: Label[]; onFilterCategory: (id: string) => void };
const money = (value: number, currency: string) => `${currency === "TWD" ? "NT$" : currency + " "}${(value / 100).toLocaleString("zh-TW", {maximumFractionDigits: 2})}`;
export function SpendingInsights({ transactions, month, currency, categories, accounts, onFilterCategory }: Props) {
  const insights = useMemo(() => {
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
    const groups = new Map<string, { id: string; name: string; amount: number; count: number }>();
    const cards = new Map<string, number>();
    const days = new Map<string, number>();
    let total = 0; let count = 0;
    for (const tx of transactions) {
      if (ledgerDay(tx).slice(0, 7) !== month || tx.currency.trim() !== currency || tx.status !== "confirmed" || tx.amount_minor === null || tx.legacy_kind === "transfer") continue;
      if (tx.amount_minor >= 0 || tx.legacy_kind === "refund") continue;
      const amount = -tx.amount_minor;
      total += amount; count++;
      const id = tx.category_id || "";
      const group = groups.get(id) || { id, name: categoryNames.get(id) || "未分類", amount: 0, count: 0 };
      group.amount += amount; group.count++; groups.set(id, group);
      const account = accountNames.get(tx.account_id || "") || tx.card_label || "未指定帳戶";
      cards.set(account, (cards.get(account) || 0) + amount);
      const day = ledgerDay(tx); days.set(day, (days.get(day) || 0) + amount);
    }
    return { total, count, categories: [...groups.values()].sort((a,b) => b.amount-a.amount),
      cards: [...cards.entries()].sort((a,b) => b[1]-a[1]).slice(0,5),
      days: [...days.entries()].sort((a,b) => a[0].localeCompare(b[0])) };
  }, [transactions, month, currency, categories, accounts]);
  return <section className="ls-insights" aria-label="收支分析">
    <div className="ls-app-panel-head"><div><p>SPENDING INSIGHTS</p><h2>支出分析</h2></div><small>{month} · {currency} · {insights.count} 筆支出</small></div>
    {insights.total === 0 ? <p className="ls-insights-empty">這個月份尚無已確認的支出，記一筆後就會顯示分類分析。</p> : <>
      <div className="ls-insights-top"><strong>{money(insights.total, currency)}</strong><span>當月支出總額（退款另列）</span></div>
      <div className="ls-insights-bars">{insights.categories.slice(0,6).map((group) => <button key={group.id} type="button" onClick={() => onFilterCategory(group.id)} title={`篩選 ${group.name}`}><span className="ls-insights-bar-label">{group.name}<small>{group.count} 筆</small></span><span className="ls-insights-bar-track"><i style={{width:`${100*group.amount/insights.total}%`}} /></span><b>{money(group.amount,currency)}</b></button>)}</div>
      <div className="ls-insights-bottom"><div><h3>付款帳戶</h3>{insights.cards.map(([name,amount])=><p key={name}><span>{name}</span><b>{money(amount,currency)}</b></p>)}</div><div><h3>消費日期</h3><p>有支出天數 <b>{insights.days.length} 天</b></p><p>單日最高 <b>{money(Math.max(...insights.days.map(([,n])=>n)),currency)}</b></p><p>每筆平均 <b>{money(Math.round(insights.total/insights.count),currency)}</b></p></div></div>
    </>}
  </section>;
}
