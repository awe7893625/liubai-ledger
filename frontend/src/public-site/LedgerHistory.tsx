import { useMemo } from "react";
import { ledgerFreshness, monthlySeries } from "./ledger-view";
import type { LedgerRow } from "./ledger-data";

const money = (value: number, currency: string) => `${currency === "TWD" ? "NT$" : currency + " "}${(value / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
export function LedgerFreshness({ rows, loadedAt, loading, failed, onLatest }: { rows: LedgerRow[]; loadedAt: string | null; loading: boolean; failed: boolean; onLatest: (month: string) => void }) {
  const info = ledgerFreshness(rows);
  if (!loadedAt) return null;
  return <details className="lf-freshness"><summary>雲端 {info.count} 筆 · 最新交易 {info.latest || "尚無紀錄"}{loading ? " · 讀取中" : failed ? " · 更新失敗" : ""}</summary><p>上次成功讀取雲端：{new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(loadedAt))}。讀取成功不代表銀行或舊帳本已同步。</p>{info.importedCount ? <p>含 {info.importedCount} 筆歷史匯入。重新整理只讀取目前雲端帳本，不會自動搬入舊系統的新交易。</p> : null}{info.latest ? <button type="button" className="ls-button ls-secondary" onClick={() => onLatest(info.latest!.slice(0, 7))}>查看最新有交易的月份</button> : null}</details>;
}
export function LedgerHistory({ rows, month, currency, onMonth }: { rows: LedgerRow[]; month: string; currency: string; onMonth: (month: string) => void }) {
  const series = useMemo(() => monthlySeries(rows, month, currency), [rows, month, currency]);
  const max = Math.max(1, ...series.flatMap((row) => [row.expense, row.income]));
  const previous = series[series.length - 2];
  const current = series[series.length - 1];
  if (!current) return null;
  const change = previous?.expense ? (current.expense - previous.expense) / previous.expense * 100 : null;
  return <section className="lf-history" aria-label="六個月收支趨勢"><header><div><h2>六個月收支趨勢</h2><p>只計雲端已確認交易 · {currency} · 不換算幣別</p></div></header><div className="lf-history-legend"><span data-series="expense">支出</span><span data-series="income">收入</span></div><div className="lf-history-chart">{series.map((row) => <button type="button" key={row.month} aria-label={`查看 ${row.month} 交易`} title={`${row.month} 支出 ${money(row.expense, currency)}／收入 ${money(row.income, currency)}`} onClick={() => onMonth(row.month)}><span className="lf-history-columns" aria-hidden="true"><i data-series="expense" style={{ height: `${100 * row.expense / max}%` }} /><i data-series="income" style={{ height: `${100 * row.income / max}%` }} /></span><b>{row.month.slice(5)} 月</b><small>{row.confirmed} 筆</small></button>)}</div><p className="lf-helper">{change === null ? "上月支出為零或沒有紀錄，暫不顯示變化百分比。" : `目前選定月份的已記錄支出較上月${change >= 0 ? "增加" : "減少"} ${Math.abs(change).toFixed(1)}%。` } 這是已記錄金額，不是完整銀行對帳或月底預測。</p><details><summary>查看每月精確數字</summary><div className="lf-history-table"><table><thead><tr><th>月份</th><th>支出</th><th>收入</th><th>退款</th></tr></thead><tbody>{series.map((row) => <tr key={row.month}><th>{row.month}</th><td>{money(row.expense, currency)}</td><td>{money(row.income, currency)}</td><td>{money(row.refund, currency)}</td></tr>)}</tbody></table></div></details></section>;
}
