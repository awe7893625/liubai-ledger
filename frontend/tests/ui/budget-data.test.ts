import test from "node:test";
import assert from "node:assert/strict";
import { budgetUsage } from "../../src/public-site/budget-data.ts";
import type { MonthlyBudget } from "../../src/public-site/budget-data.ts";
import type { LedgerRow } from "../../src/public-site/ledger-data.ts";
const now = new Date("2026-10-22T10:00:00Z");
const plan: MonthlyBudget = { period_month: "2026-10", currency: "TWD", total_limit_minor: 100000, safety_buffer_minor: 10000, category_limits: { food: 50000 }, version: 1, updated_at: now.toISOString() };
const row = (patch: Partial<LedgerRow> = {}): LedgerRow => ({ id: "1", amount_minor: -20000, currency: "TWD", occurred_at: now.toISOString(), status: "confirmed", category_id: "food", ...patch });
test("budget nets refunds, excludes transfers/unconfirmed/FX, and keeps safe spending nonnegative", () => {
  const usage = budgetUsage([row(), row({ id: "2", amount_minor: 2000, legacy_kind: "refund" }), row({ status: "pending" }), row({ legacy_kind: "transfer", amount_minor: -900000 }), row({ currency: "USD" }), row({ amount_minor: 80000 })], "2026-10", "TWD", plan, now);
  assert.equal(usage.netSpent, 18000); assert.equal(usage.remaining, 82000);
  assert.equal(usage.available, 72000); assert.equal(usage.categorySpent.food, 18000);
  assert.equal(usage.daysRemaining, 10); assert.equal(usage.dailyAvailable, 7200);
});
test("past/future periods use original dates and do not invent daily spending figures", () => {
  const usage = budgetUsage([row({ legacy_date: "2026-07-01" })], "2026-07", "TWD", plan, now);
  assert.equal(usage.netSpent, 20000); assert.equal(usage.daysRemaining, 0); assert.equal(usage.dailyAvailable, null);
  assert.equal(budgetUsage([], "2026-11", "TWD", plan, now).daysRemaining, 30);
});
test("unconfigured and zero budgets are distinct; over-budget amounts remain explicit", () => {
  assert.equal(budgetUsage([row()], "2026-10", "TWD", null, now).remaining, null);
  const usage = budgetUsage([row()], "2026-10", "TWD", { ...plan, total_limit_minor: 0, safety_buffer_minor: 0 }, now);
  assert.equal(usage.overBudget, true); assert.equal(usage.remaining, -20000); assert.equal(usage.available, 0);
});
