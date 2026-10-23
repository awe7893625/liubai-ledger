import { ledgerDay } from "./ledger-data.ts";
import type { LedgerRow } from "./ledger-data";

export type EntryKind = "expense" | "income" | "refund" | "transfer";
export const ENTRY_LABELS: Record<EntryKind, string> = { expense: "支出", income: "收入", refund: "退款", transfer: "轉帳紀錄" };
export function entryKind(row: Pick<LedgerRow, "amount_minor" | "legacy_kind">): EntryKind {
  if (["expense", "income", "refund", "transfer"].includes(row.legacy_kind || "")) return row.legacy_kind as EntryKind;
  return (row.amount_minor ?? -1) > 0 ? "income" : "expense";
}
export function entryDirection(kind: EntryKind, transferFlow: "income" | "expense" = "expense") {
  return kind === "transfer" ? transferFlow : kind === "income" || kind === "refund" ? "income" : "expense";
}

export type ReviewGroup<T> = { key: string; day: string; currency: string; amountMinor: number; rows: T[] };
// Conservative *candidates*, not duplicate decisions: identical date, signed
// amount, currency, merchant and explicit account, seen across distinct sources.
// Two same-day payments can still be legitimate. Never mutates or merges rows.
export function duplicateCandidates<T extends LedgerRow>(rows: T[]): ReviewGroup<T>[] {
  const groups = new Map<string, ReviewGroup<T>>();
  for (const row of rows) {
    if (row.status !== "confirmed" || row.amount_minor === null || !Number.isSafeInteger(row.amount_minor) || row.amount_minor === 0 || !row.account_id || !row.source || entryKind(row) === "transfer") continue;
    const day = ledgerDay(row);
    const merchant = (row.merchant || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-TW");
    if (!day || !merchant) continue;
    const currency = row.currency.trim();
    const key = JSON.stringify([day, row.account_id, currency, row.amount_minor, merchant, entryKind(row)]);
    const group = groups.get(key) || { key, day, currency, amountMinor: row.amount_minor, rows: [] };
    group.rows.push(row); groups.set(key, group);
  }
  return [...groups.values()].filter((group) => new Set(group.rows.map((row) => row.id)).size > 1 && new Set(group.rows.map((row) => row.source)).size > 1)
    .sort((left, right) => right.day.localeCompare(left.day));
}
export function requiresReview(row: Pick<LedgerRow, "status">) {
  return row.status === "pending" || row.status === "error";
}
