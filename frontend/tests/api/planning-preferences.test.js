import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import preferencesHandler from "../../api/_shared/preferences-handler.js";
import planningHandler, { planApplies, planDueDate, validPayment, projectPlan } from "../../api/_shared/planning-handler.js";

const originalFetch = globalThis.fetch;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SECRET_KEY = "service-role-test-key";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
afterEach(() => { globalThis.fetch = originalFetch; });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function state() {
  return { ledger_preferences: [], ledger_scheduled_expenses: [], ledger_scheduled_receipts: [],
    ledger_accounts: [{ id: id(1), user_id: "a", currency: "TWD" }, { id: id(2), user_id: "b", currency: "TWD" }, { id: id(3), user_id: "a", currency: "USD" }],
    ledger_categories: [{ id: id(4), user_id: "a" }, { id: id(5), user_id: "b" }],
    ledger_transactions: [{ id: id(6), user_id: "a", currency: "TWD", amount_minor: -120000, occurred_at: "2026-10-22T00:00:00Z", status: "confirmed" },
      { id: id(7), user_id: "b", currency: "TWD", amount_minor: -120000, occurred_at: "2026-10-22T00:00:00Z", status: "confirmed" }],
  };
}
function install(db) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url); const method = init.method || "GET";
    const respond = (status, body, count) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(count !== undefined ? { "content-range": `0-${Math.max(0,count-1)}/${count}` } : {}) } });
    if (url.pathname === "/auth/v1/user") return respond(200, { id: new Headers(init.headers).get("authorization")?.endsWith("user-b") ? "b" : "a", role: "authenticated" });
    const table = url.pathname.split("/").at(-1); const rows = db[table];
    if (!rows) throw new Error(`Unexpected table ${table}`);
    const match = (row) => [...url.searchParams].every(([key, value]) => value.startsWith("eq.") ? String(row[key]) === value.slice(3) : value.startsWith("in.(") ? value.slice(4,-1).split(",").map((v)=>v.replaceAll('"','')).includes(String(row[key])) : true);
    const chosen = rows.filter(match);
    if (method === "HEAD") return respond(200, null, chosen.length);
    if (method === "GET") return respond(200, chosen, chosen.length);
    const body = init.body ? JSON.parse(init.body) : {};
    const duplicate = (candidate, except) => rows.some((row) => row !== except && (
      table === "ledger_preferences" ? row.user_id === candidate.user_id :
      table === "ledger_scheduled_expenses" ? row.id === candidate.id :
      (row.user_id === candidate.user_id && row.plan_id === candidate.plan_id && row.period_month === candidate.period_month) ||
      (candidate.transaction_id && row.user_id === candidate.user_id && row.transaction_id === candidate.transaction_id)
    ));
    if (method === "POST") {
      if (duplicate(body)) return respond(409, { code: "23505" });
      rows.push({ ...body }); return respond(201, [{ ...body }]);
    }
    if (method === "PATCH") {
      if (chosen.some((row) => duplicate({ ...row, ...body }, row))) return respond(409, { code: "23505" });
      chosen.forEach((row) => Object.assign(row, body)); return respond(200, chosen);
    }
    throw new Error(`Unexpected method ${method}`);
  };
}
async function call(handler, db, method, body = {}, owner = "a", query = {}) {
  install(db); let status; let response;
  await handler({ method, headers: { authorization: `Bearer user-${owner}` }, body, query: { month: "2026-10", currency: "TWD", ...query } }, {
    setHeader() {}, status(code) { status = code; return this; }, json(value) { response = value; return value; },
  });
  return { status, body: response };
}
const prefs = (patch = {}) => ({ display_name: "雨的帳本", theme: "dark", home_currency: "TWD", default_account_id: id(1), default_category_id: id(4), version: 0, ...patch });
const plan = (patch = {}) => ({ id: id(10), name: "每月房租", amount: "1200", currency: "TWD", recurrence: "monthly", start_month: "2026-10", end_month: null, due_day: 31, account_id: id(1), category_id: id(4), active: true, ...patch });

test("preferences are owned by server identity and first read never writes", async () => {
  const db = state();
  assert.equal((await call(preferencesHandler, db, "GET")).body.preferences.version, 0);
  assert.equal(db.ledger_preferences.length, 0);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ user_id: "b" }))).status, 201);
  assert.equal(db.ledger_preferences[0].user_id, "a");
  assert.equal((await call(preferencesHandler, db, "GET", {}, "b")).body.preferences.display_name, "");
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ default_account_id: id(2) }))).status, 400);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ default_category_id: id(5) }))).status, 400);
});
test("preferences reject stale versions and invalid themes", async () => {
  const db = state(); await call(preferencesHandler, db, "PUT", prefs());
  assert.equal((await call(preferencesHandler, db, "PUT", prefs())).status, 409);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ version: 1, theme: "light" }))).status, 200);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ version: 1 }))).status, 409);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ version: 2, theme: "fake" }))).status, 400);
  assert.equal((await call(preferencesHandler, db, "PUT", prefs({ display_name: "a\nb" }))).status, 400);
  assert.equal(db.ledger_preferences[0].theme, "light");
});
test("monthly projection clamps month-end and honors effective range", () => {
  assert.equal(planDueDate("2027-02", 31), "2027-02-28");
  assert.equal(planDueDate("2028-02", 31), "2028-02-29");
  assert.equal(planDueDate("2026-04", 31), "2026-04-30");
  assert.equal(planApplies(plan(), "2026-09"), false);
  assert.equal(planApplies(plan(), "2026-11"), true);
  assert.equal(planApplies(plan({ recurrence: "once" }), "2026-11"), false);
  assert.equal(planApplies(plan({ end_month: "2026-11" }), "2026-12"), false);
});
test("payment validation excludes foreign month, currency, pending, refund and transfers", () => {
  const tx = state().ledger_transactions[0]; assert.equal(validPayment(tx, "2026-10", "TWD"), true);
  for (const patch of [{ status: "pending" }, { currency: "USD" }, { amount_minor: 1 }, { legacy_kind: "transfer" }, { legacy_kind: "refund" }, { legacy_date: "2026-09-01" }]) assert.equal(validPayment({ ...tx, ...patch }, "2026-10", "TWD"), false);
});
test("new scheduled plans are idempotent and cannot use another user's references", async () => {
  const db = state(); const created = await call(planningHandler, db, "POST", plan({ user_id: "b" }));
  assert.equal(created.status, 201); assert.equal(db.ledger_scheduled_expenses[0].user_id, "a");
  assert.equal((await call(planningHandler, db, "POST", plan())).body.duplicate, true);
  assert.equal(db.ledger_scheduled_expenses.length, 1);
  assert.equal((await call(planningHandler, db, "POST", plan({ id: id(11), account_id: id(2) }))).status, 400);
  assert.equal((await call(planningHandler, db, "POST", plan({ id: id(11), account_id: id(3) }))).status, 400);
  assert.equal((await call(planningHandler, db, "GET", {}, "b")).body.items.length, 0);
  assert.equal((await call(planningHandler, db, "GET")).body.outstanding_minor, 120000);
  assert.equal(db.ledger_transactions.length, 2, "creating a plan does not book a transaction");
});
test("linking only the owner's expense releases reserve without booking twice", async () => {
  const db = state(); await call(planningHandler, db, "POST", plan());
  const payload = { plan_id: id(10), month: "2026-10", version: 0, status: "linked", transaction_id: id(7) };
  assert.equal((await call(planningHandler, db, "PATCH", payload)).status, 400);
  assert.equal((await call(planningHandler, db, "PATCH", { ...payload, transaction_id: id(6) }, "b")).status, 404);
  assert.equal((await call(planningHandler, db, "PATCH", { ...payload, transaction_id: id(6) })).status, 200);
  assert.equal((await call(planningHandler, db, "GET")).body.outstanding_minor, 0);
  assert.equal(db.ledger_transactions.length, 2);
  assert.equal((await call(planningHandler, db, "PATCH", { ...payload, transaction_id: id(6) })).status, 409);
  assert.equal((await call(planningHandler, db, "GET", {}, "a", { month: "2026-11" })).body.outstanding_minor, 120000);
});
test("one payment cannot satisfy two plans and deletion/invalidated payment restores reserve", async () => {
  const db = state(); await call(planningHandler, db, "POST", plan()); await call(planningHandler, db, "POST", plan({ id: id(11), name: "訂閱" }));
  const payload = { plan_id: id(10), month: "2026-10", version: 0, status: "linked", transaction_id: id(6) };
  await call(planningHandler, db, "PATCH", payload);
  assert.equal((await call(planningHandler, db, "PATCH", { ...payload, plan_id: id(11) })).status, 409);
  db.ledger_transactions[0].status = "pending";
  const list = await call(planningHandler, db, "GET");
  assert.equal(list.body.outstanding_minor, 240000);
  assert.equal(list.body.items.find((p) => p.id === id(10)).payment_needs_review, true);
});
test("skip is scoped to one period; plan edits use optimistic concurrency", async () => {
  const db = state(); await call(planningHandler, db, "POST", plan());
  await call(planningHandler, db, "PATCH", { plan_id: id(10), month: "2026-10", version: 0, status: "skipped" });
  assert.equal((await call(planningHandler, db, "GET")).body.outstanding_minor, 0);
  assert.equal((await call(planningHandler, db, "GET", {}, "a", { month: "2026-11" })).body.outstanding_minor, 120000);
  assert.equal((await call(planningHandler, db, "PUT", plan({ version: 1, active: false }))).status, 200);
  assert.equal((await call(planningHandler, db, "PUT", plan({ version: 1 }))).status, 409);
  assert.equal((await call(planningHandler, db, "GET", {}, "a", { month: "2026-11" })).body.items[0].state, "paused");
  assert.equal(projectPlan({ ...plan(), amount_minor: 120000 }, "2026-10", null, null).outstanding_minor, 120000);
});
