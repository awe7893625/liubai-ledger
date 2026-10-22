import test from "node:test";
import assert from "node:assert/strict";
import { duplicateCandidates, entryKind, entryDirection, requiresReview } from "../../src/public-site/transaction-integrity.ts";
import { summarizeMonth } from "../../src/public-site/ledger-data.ts";
import { budgetUsage } from "../../src/public-site/budget-data.ts";
import type { LedgerRow } from "../../src/public-site/ledger-data.ts";
const row = (id: string, changes: Partial<LedgerRow> = {}): LedgerRow => ({ id, amount_minor: -10000, currency: "TWD", occurred_at: "2026-10-23T04:00:00Z", merchant: "測試咖啡", account_id: "a", category_id: "food", source: "manual", status: "confirmed", ...changes });

test("explicit refund and transfer override the sign-based fallback", () => {
  assert.equal(entryKind(row("x", { legacy_kind: "refund", amount_minor: 1000 })), "refund");
  assert.equal(entryKind(row("x", { legacy_kind: "transfer" })), "transfer");
  assert.equal(entryKind(row("x", { legacy_kind: "unknown", amount_minor: 2000 })), "income");
  assert.equal(entryDirection("refund"), "income");
  assert.equal(entryDirection("transfer", "expense"), "expense");
});

test("only cross-source, same-account exact matches become review candidates", () => {
  const rows = [row("a", { source: "apple_pay" }), row("b", { source: "email", merchant: " 測試咖啡 " })];
  const groups = duplicateCandidates(rows);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].rows.map((item) => item.id), ["a", "b"]);
  assert.equal(rows.every((item) => item.status === "confirmed"), true);
  assert.equal(duplicateCandidates([row("a"), row("b")]).length, 0);
});

test("different card, currency, amount, day, incomplete and excluded rows do not collide", () => {
  const original = row("original");
  for (const changes of [{ account_id: "b" }, { currency: "USD" }, { amount_minor: -10100 }, { legacy_date: "2026-09-01" }, { account_id: null }, { merchant: "" }, { status: "duplicate" }, { status: "pending" }, { legacy_kind: "transfer" }, { amount_minor: null }]) {
    assert.equal(duplicateCandidates([original, row("other", { source: "email", ...changes })]).length, 0);
  }
});

test("same calendar day with historical precision remains only a candidate, not an automatic merge", () => {
  const rows = [row("a", { legacy_date: "2026-07-03", source: "capture" }), row("b", { legacy_date: "2026-07-03", source: "statement" })];
  const groups = duplicateCandidates(rows);
  assert.equal(groups.length, 1); assert.equal(groups[0].day, "2026-07-03");
  assert.equal(rows.length, 2); assert.equal(summarizeMonth(rows, "2026-07").expense, 20000);
});

test("manual review and reinstatement update totals; refunds do not count as income", () => {
  const rows = [row("expense"), row("refund", { amount_minor: 2000, legacy_kind: "refund" }), row("income", { amount_minor: 4000, legacy_kind: "income" }), row("transfer", { amount_minor: -5000, legacy_kind: "transfer" }), row("excluded", { status: "duplicate" })];
  const summary = summarizeMonth(rows, "2026-10");
  assert.equal(summary.expense, 10000); assert.equal(summary.income, 4000); assert.equal(summary.refund, 2000); assert.equal(summary.transfers, 1);
  const plan = { period_month: "2026-10", currency: "TWD", total_limit_minor: 20000, safety_buffer_minor: 0, category_limits: {}, version: 1, updated_at: "2026-10-23T00:00:00Z" };
  assert.equal(budgetUsage(rows, "2026-10", "TWD", plan).remaining, 12000);
  rows[4].status = "confirmed";
  assert.equal(summarizeMonth(rows, "2026-10").expense, 20000);
});

test("pending/error review is distinct from a deliberately excluded duplicate", () => {
  assert.equal(requiresReview({ status: "pending" }), true); assert.equal(requiresReview({ status: "error" }), true);
  assert.equal(requiresReview({ status: "duplicate" }), false); assert.equal(requiresReview({ status: "confirmed" }), false);
});
