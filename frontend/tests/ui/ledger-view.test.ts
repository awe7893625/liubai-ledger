import assert from "node:assert/strict";
import test from "node:test";
import { sortLedger, groupLedger, monthWindow, monthlySeries, ledgerFreshness } from "../../src/public-site/ledger-view.ts";
import type { LedgerRow } from "../../src/public-site/ledger-data.ts";
const row = (id: string, patch: Partial<LedgerRow> = {}): LedgerRow => ({ id, amount_minor: -12000, currency: "TWD", status: "confirmed", occurred_at: "2026-10-23T00:00:00Z", ...patch });
test("date and amount sorting is stable, immutable and puts missing amounts last", () => {
  const rows = [row("new"), row("old", { legacy_date: "2026-07-01", amount_minor: -30000 }), row("pending", { amount_minor: null, status: "pending" })];
  assert.equal(sortLedger(rows, "oldest")[0].id, "old");
  assert.deepEqual(sortLedger(rows, "amount_desc").map((item) => item.id), ["old", "new", "pending"]);
  assert.equal(sortLedger(rows, "amount_asc")[0].id, "new");
  assert.equal(rows[0].id, "new");
});
test("mixed-currency amount sorting is rejected instead of silently comparing currencies", () => {
  assert.throws(() => sortLedger([row("twd"), row("usd", { currency: "USD" })], "amount_desc"), /單一幣別/);
  assert.equal(sortLedger([row("twd"), row("usd", { currency: "USD" })], "newest").length, 2);
});
test("daily totals keep currency, refunds and transfers separate", () => {
  const groups = groupLedger([row("a"), row("b", { currency: "USD", amount_minor: -500 }), row("r", { legacy_kind: "refund", amount_minor: 1000 }), row("t", { legacy_kind: "transfer", amount_minor: -999999 }), row("pending", { status: "pending", amount_minor: -333 }), row("old", { legacy_date: "2026-09-01" })]);
  assert.equal(groups.length, 2);
  const twd = groups[0].totals.find((item) => item.currency === "TWD")!;
  assert.equal(twd.expense, 12000); assert.equal(twd.refund, 1000); assert.equal(twd.transfers, 1); assert.equal(twd.pending, 1);
  assert.equal(groups[0].totals.find((item) => item.currency === "USD")!.expense, 500);
});
test("six-month series crosses years and keeps zero-record months explicit", () => {
  assert.deepEqual(monthWindow("2026-02"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthWindow("2026-13"), []);
  const series = monthlySeries([row("a", { legacy_date: "2026-01-31" })], "2026-02", "TWD");
  assert.equal(series[4].expense, 12000); assert.equal(series[5].confirmed, 0);
});
test("freshness means latest transaction date, not a claim of bank/M4 synchronization", () => {
  const info = ledgerFreshness([row("a", { legacy_date: "2026-09-18" }), row("b", { legacy_date: "2026-08-01" })], new Date("2026-10-23T00:00:00Z"));
  assert.equal(info.latest, "2026-09-18"); assert.equal(info.importedCount, 2); assert.equal(info.gapDays, 35);
  assert.equal(ledgerFreshness([]).latest, null);
});
