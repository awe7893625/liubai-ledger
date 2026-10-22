import assert from "node:assert/strict";
import test from "node:test";
import { currentMonth, ledgerDay, summarizeMonth, filterLedger, ledgerCsv, loadAllLedgerPages, retryRequest } from "../../src/public-site/ledger-data.ts";
import type { LedgerRow } from "../../src/public-site/ledger-data.ts";

const row = (patch: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "tx", amount_minor: -12345, currency: "TWD", occurred_at: "2026-10-22T00:00:00Z",
  status: "confirmed", merchant: "午餐", ...patch,
});

test("calendar keys use Taipei dates and preserve historical purchase dates", () => {
  assert.equal(ledgerDay(row({ occurred_at: "2026-09-30T16:30:00Z" })), "2026-10-01");
  assert.equal(ledgerDay(row({ legacy_date: "2026-07-01" })), "2026-07-01");
  assert.equal(currentMonth(new Date("2026-09-30T16:01:00Z")), "2026-10");
  assert.equal(ledgerDay(row({ occurred_at: "invalid" })), "");
});

test("monthly totals exclude pending, duplicates, transfers and other currencies", () => {
  const result = summarizeMonth([
    row(), row({ amount_minor: 10000 }), row({ status: "pending", amount_minor: -9000 }),
    row({ status: "duplicate", amount_minor: -8000 }), row({ currency: "USD", amount_minor: -99900 }),
    row({ legacy_kind: "transfer", amount_minor: -200000 }), row({ legacy_kind: "refund", amount_minor: 400 }),
    row({ legacy_date: "2026-09-01", amount_minor: -7000 }),
  ], "2026-10");
  assert.deepEqual(result, { expense: 12345, income: 10000, refund: 400, transfers: 1, confirmed: 4, pending: 1 });
});

test("historical month and account/category search work without changing source rows", () => {
  const rows = [row({ id: "1", legacy_date: "2026-07-02", account_id: "a", category_id: "c" }), row({ id: "2" })];
  const accounts = new Map([["a", { name: "玉山日常卡" }]]);
  const categories = new Map([["c", { name: "餐飲" }]]);
  assert.deepEqual(filterLedger(rows, "2026-07", "玉山", accounts, categories).map((r) => r.id), ["1"]);
  assert.equal(filterLedger(rows, "", "餐飲", accounts, categories).length, 1);
  assert.equal(filterLedger(rows, "2026-08", "", accounts, categories).length, 0);
  assert.equal(rows.length, 2);
});

test("CSV exports preserve negative monetary numbers and neutralize spreadsheet formulas", () => {
  const csv = ledgerCsv([row({ merchant: '=HYPERLINK("x")', note: " \t+cmd", legacy_date: "2026-07-03" })], new Map(), new Map());
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"-123.45"'));
  assert.ok(csv.includes("'="));
  assert.ok(csv.includes("' \t+cmd"));
  assert.ok(csv.includes("2026-07-03"));
});

test("pagination loads every row beyond the old 1000 limit", async () => {
  const rows = Array.from({ length: 1201 }, (_, index) => ({ id: String(index) }));
  const calls: number[] = [];
  const loaded = await loadAllLedgerPages(async (offset, size) => {
    calls.push(offset); return { rows: rows.slice(offset, offset + size), total: rows.length };
  });
  assert.equal(loaded.length, 1201);
  assert.deepEqual(calls, [0, 500, 1000]);
});

test("partial, duplicate or changing pages fail instead of producing false complete totals", async () => {
  await assert.rejects(loadAllLedgerPages(async () => ({ rows: [{ id: "1" }], total: 2 })), /未完整/);
  await assert.rejects(loadAllLedgerPages(async (offset) => ({ rows: [{ id: "1" }], total: offset ? 3 : 2 }), 1), /有變動/);
  await assert.rejects(loadAllLedgerPages(async () => ({ rows: [], total: 50001 })), /範圍/);
});

test("same form retry reuses ID while a new form gets a new ID", () => {
  let calls = 0;
  const create = () => `request-${++calls}`;
  const first = retryRequest(null, { amount: 123, merchant: "午餐" }, create);
  const retry = retryRequest(first, { amount: 123, merchant: "午餐" }, create);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(calls, 1);
  assert.notEqual(retryRequest(first, { amount: 124, merchant: "午餐" }, create).requestId, first.requestId);
});
