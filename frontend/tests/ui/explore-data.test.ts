import assert from "node:assert/strict";
import test from "node:test";
import { answerLedger, locatedExpenses, parseLedgerGeo, parseQuickDraft, queryPeriod, validDay } from "../../src/public-site/explore-data.ts";
import type { LedgerRow } from "../../src/public-site/ledger-data.ts";
const NOW = new Date("2026-10-22T09:00:00Z");
const categories = [{ id: "food", name: "餐飲" }, { id: "travel", name: "交通" }];
const accounts = [{ id: "a", name: "玉山日常卡", currency: "TWD" }, { id: "b", name: "玉山", currency: "TWD" }, { id: "c", name: "美金卡", currency: "USD" }];
const row = (patch: Partial<LedgerRow> = {}): LedgerRow => ({ id: "1", amount_minor: -12000, currency: "TWD", occurred_at: "2026-10-22T00:00:00Z", status: "confirmed", merchant: "咖啡", category_id: "food", account_id: "a", ...patch });
const answer = (q: string, rows = [row()]) => answerLedger(q, rows, "2026-09", "TWD", categories, accounts, NOW);

test("Taipei calendar handles this/last week and year transition", () => {
  assert.equal(queryPeriod("本月多少", "2026-07", NOW).start, "2026-10-01");
  assert.equal(queryPeriod("目前月份多少", "2026-07", NOW).start, "2026-07-01");
  assert.deepEqual(queryPeriod("上週多少", "2026-07", NOW), { start: "2026-10-12", end: "2026-10-18", label: "上週（週一至週日）" });
  assert.equal(queryPeriod("今天多少", "2026-10", new Date("2026-10-21T16:01:00Z")).start, "2026-10-22");
  assert.equal(queryPeriod("上月多少", "2026-10", new Date("2027-01-01T04:00:00Z")).start, "2026-12-01");
  assert.equal(validDay("2026-02-29"), false); assert.equal(validDay("2028-02-29"), true);
});
test("ambiguous ranges and invalid explicit dates are rejected", () => {
  assert.throws(() => queryPeriod("今天和本月", "2026-10", NOW), /一個/);
  assert.throws(() => queryPeriod("2026-10和2026-09", "2026-10", NOW), /一個/);
  assert.throws(() => queryPeriod("2026-02-31", "2026-10", NOW), /不存在/);
});
test("summary separates transfers, refunds, income, currencies and unconfirmed rows", () => {
  const rows = [row(), row({ id: "2", amount_minor: 3000, legacy_kind: "refund" }), row({ id: "3", amount_minor: 50000 }), row({ id: "4", amount_minor: -800000, legacy_kind: "transfer" }), row({ id: "5", status: "pending", amount_minor: -100 }), row({ id: "6", currency: "USD", amount_minor: -999999 })];
  const result = answer("本月花多少？", rows);
  assert.equal(result.expense, 12000); assert.equal(result.refunds, 3000); assert.equal(result.netExpense, 9000); assert.equal(result.income, 50000);
  assert.deepEqual(result.rows.map((r) => r.id), ["1", "2", "3"]); assert.equal(result.ignored, 2);
});
test("category/account lookup uses exact names and no fuzzy bank match", () => {
  const rows = [row(), row({ id: "2", category_id: "travel" }), row({ id: "3", account_id: "b", amount_minor: -1000 })];
  assert.equal(answer("本月玉山日常卡餐飲多少？", rows).expense, 12000);
  assert.equal(answer("本月玉山多少？", rows).expense, 1000);
  assert.throws(() => answer("本月台新多少？", rows), /不會猜測/);
  assert.throws(() => answer("本月餐飲交通多少？", rows), /一個分類/);
});
test("unsupported advice or malformed prompts never return a guessed summary", () => {
  for (const q of ["明年投資報酬多少", "幫我刪除交易", "<script>本月花多少</script>", "上個月比這個月多多少", "本月2026-09-01花多少"]) assert.throws(() => answer(q));
});
test("rankings cite only actual expense evidence and old dates stay old", () => {
  const result = answer("本月商家排行", [row(), row({ id: "2", merchant: "餐廳", amount_minor: -20000 }), row({ id: "3", legacy_date: "2026-07-02", amount_minor: -999999 })]);
  assert.equal(result.kind, "merchants"); assert.equal(result.merchants[0].name, "餐廳"); assert.equal(result.rows.length, 2);
  assert.equal(answer("本月花多少", [row({ legacy_date: "2026-07-01" })]).rows.length, 0);
});
test("simple draft is explicit and does not infer an account or category", () => {
  const draft = parseQuickDraft("午餐 120", categories, accounts, NOW);
  assert.equal(draft.amount, "120.00"); assert.equal(draft.direction, "expense"); assert.equal(draft.merchant, "午餐");
  assert.equal(draft.accountId, null); assert.equal(draft.categoryId, null);
  const precise = parseQuickDraft("2026-10-21 午餐 1,234.56 玉山日常卡 餐飲", categories, accounts, NOW);
  assert.equal(precise.day, "2026-10-21"); assert.equal(precise.accountId, "a"); assert.equal(precise.categoryId, "food"); assert.equal(precise.amount, "1234.56");
  assert.equal(parseQuickDraft("收入 薪資 50000", categories, accounts, NOW).direction, "income");
});
test("draft rejects questions, transfers, negative/ambiguous amounts and non-TWD cards", () => {
  for (const text of ["午餐多少120？", "轉帳 120", "退款 120", "午餐 -120", "午餐 1.234", "午餐 12,34", "午餐 120 50", "7-11 120", "午餐 10 美金卡", "咖啡 USD 120", "午餐 9999999999999999999", "2026-02-31 午餐 50"]) assert.throws(() => parseQuickDraft(text, categories, accounts, NOW), text);
});
test("parses only explicitly marked legacy or JSON coordinates; bounds and nulls are checked", () => {
  assert.deepEqual(parseLedgerGeo("apple_pay · 🗺️25.033,121.565 · 📍市區店 · 測試"), { lat: 25.033, lng: 121.565, label: "市區店" });
  assert.deepEqual(parseLedgerGeo('{"latitude":25,"longitude":121,"location_name":"店家"}'), { lat: 25, lng: 121, label: "店家" });
  for (const note of ["25.1,121.2", "🗺️91,180", "🗺️25,181", '{"latitude":null,"longitude":121}', '{"latitude":" ","longitude":121}', '{"latitude":true,"longitude":121}', "{broken}"]) assert.equal(parseLedgerGeo(note), null, note);
});
test("location view excludes pending/foreign currency/refund/transfer and never guesses missing points", () => {
  const note = "🗺️25.033,121.565";
  const rows = [row({ note }), row({ id: "2", note: null }), row({ id: "3", note, status: "pending" }), row({ id: "4", note, currency: "USD" }), row({ id: "5", note, legacy_kind: "transfer" }), row({ id: "6", note, legacy_kind: "refund" })];
  assert.deepEqual(locatedExpenses(rows, "2026-10", "TWD").map((item) => item.row.id), ["1"]);
  assert.equal(locatedExpenses(rows, "2026-09", "TWD").length, 0);
});
