import { ledgerDay, summarizeMonth } from "./ledger-data.ts";
import type { LedgerRow } from "./ledger-data.ts";

export type LedgerSort = "newest" | "oldest" | "amount_desc" | "amount_asc";
export function sortLedger<T extends LedgerRow>(rows: T[], sort: LedgerSort): T[] {
  const currencies = new Set(rows.map((row) => row.currency.trim()));
  if (sort.startsWith("amount") && currencies.size > 1) throw new Error("依金額排序前，請先選擇單一幣別；不同幣別不直接比較。");
  return [...rows].sort((a, b) => {
    const tie = ledgerDay(b).localeCompare(ledgerDay(a)) || b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id);
    if (sort.startsWith("amount")) {
      if (a.amount_minor === null) return b.amount_minor === null ? tie : 1;
      if (b.amount_minor === null) return -1;
      const delta = Math.abs(a.amount_minor) - Math.abs(b.amount_minor);
      return (sort === "amount_asc" ? delta : -delta) || tie;
    }
    return sort === "oldest" ? -tie : tie;
  });
}
export function groupLedger<T extends LedgerRow>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) { const day = ledgerDay(row); groups.set(day, [...(groups.get(day) || []), row]); }
  return [...groups].map(([day, items]) => ({ day, rows: items, totals: [...new Set(items.map((row) => row.currency.trim()))].sort().map((currency) => ({ currency, ...summarizeMonth(items, day.slice(0, 7), currency) })) }));
}
export function monthWindow(month: string, length = 6): string[] {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(length) || length < 1 || length > 24) return [];
  const [year, value] = month.split("-").map(Number);
  return Array.from({ length }, (_, index) => new Date(Date.UTC(year, value - length + index, 1)).toISOString().slice(0, 7));
}
export function monthlySeries(rows: LedgerRow[], endMonth: string, currency: string) {
  return monthWindow(endMonth).map((month) => ({ month, ...summarizeMonth(rows, month, currency) }));
}
export function ledgerFreshness(rows: LedgerRow[], now = new Date()) {
  const days = rows.map(ledgerDay).filter(Boolean).sort();
  const latest = days[days.length - 1] || null;
  const today = ledgerDay({ occurred_at: now.toISOString() });
  const gapDays = latest ? Math.max(0, Math.round((Date.parse(today + "T12:00:00+08:00") - Date.parse(latest + "T12:00:00+08:00")) / 86400000)) : null;
  return { count: rows.length, latest, gapDays, importedCount: rows.filter((row) => Boolean(row.legacy_date)).length };
}
