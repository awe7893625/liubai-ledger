import { currentMonth, ledgerDay, summarizeMonth } from "./ledger-data.ts";
import type { LedgerRow } from "./ledger-data";

export type MonthlyBudget = {
  period_month: string;
  currency: string;
  total_limit_minor: number;
  safety_buffer_minor: number;
  category_limits: Record<string, number>;
  version: number;
  updated_at: string;
};

export function budgetUsage(rows: LedgerRow[], month: string, currency: string, plan: MonthlyBudget | null, now = new Date()) {
  const summary = summarizeMonth(rows, month, currency);
  const netSpent = Math.max(0, summary.expense - summary.refund);
  const categorySpent: Record<string, number> = {};
  for (const row of rows) {
    if (row.status !== "confirmed" || row.currency.trim() !== currency || row.amount_minor === null || ledgerDay(row).slice(0, 7) !== month || row.legacy_kind === "transfer") continue;
    const id = row.category_id || "";
    const cost = row.legacy_kind === "refund" ? -row.amount_minor : row.amount_minor < 0 ? -row.amount_minor : 0;
    categorySpent[id] = (categorySpent[id] || 0) + cost;
  }
  for (const id of Object.keys(categorySpent)) categorySpent[id] = Math.max(0, categorySpent[id]);
  const remaining = plan ? plan.total_limit_minor - netSpent : null;
  const available = plan ? Math.max(0, (remaining ?? 0) - plan.safety_buffer_minor) : null;
  const [year, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const today = ledgerDay({ occurred_at: now.toISOString() });
  const thisMonth = currentMonth(now);
  const daysRemaining = month < thisMonth ? 0 : month > thisMonth ? daysInMonth : daysInMonth - Number(today.slice(8)) + 1;
  return { ...summary, netSpent, remaining, available, categorySpent, daysRemaining,
    dailyAvailable: available !== null && daysRemaining > 0 ? Math.floor(available / daysRemaining) : null,
    overBudget: remaining !== null && remaining < 0 };
}
