import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import handler, { budgetMoney, budgetPeriod, budgetCurrency } from "../../api/_shared/budget-handler.js";

const originalFetch = globalThis.fetch;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SECRET_KEY = "service-role-test-key";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
afterEach(() => { globalThis.fetch = originalFetch; });
function state() { return { plans: [], categories: [{ id: "cat-a", user_id: "a" }, { id: "cat-b", user_id: "b" }] }; }
function install(db) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    const respond = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init.headers).get("authorization");
      return respond(200, { id: token?.endsWith("user-b") ? "b" : "a", role: "authenticated" });
    }
    const table = url.pathname.split("/").at(-1);
    const rows = table === "ledger_categories" ? db.categories : table === "ledger_budgets" ? db.plans : null;
    if (!rows) throw new Error("Unexpected table");
    const matches = (row) => [...url.searchParams].every(([key, value]) => key === "select" || !value.startsWith("eq.") || String(row[key]) === value.slice(3));
    if (method === "GET") return respond(200, rows.filter(matches));
    const body = init.body ? JSON.parse(init.body) : {};
    if (method === "POST") {
      if (rows.some((row) => row.user_id === body.user_id && row.period_month === body.period_month && row.currency === body.currency)) return respond(409, { code: "23505" });
      rows.push({ ...body }); return respond(201, [{ ...body }]);
    }
    const found = rows.filter(matches);
    if (method === "PATCH") { found.forEach((row) => Object.assign(row, body)); return respond(200, found); }
    if (method === "DELETE") { rows.splice(0, rows.length, ...rows.filter((row) => !matches(row))); return respond(200, found); }
    throw new Error("Unexpected method");
  };
}
async function call(db, method, body = {}, owner = "a") {
  install(db); let status; let result;
  const req = { method, headers: { authorization: `Bearer user-${owner}` }, query: { month: "2026-10", currency: "TWD" }, body };
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; return value; } };
  await handler(req, res); return { status, body: result };
}
const plan = (changes = {}) => ({ month: "2026-10", currency: "TWD", version: 0, total_limit: "30000", safety_buffer: "3000", category_limits: { "cat-a": "10000" }, ...changes });

test("budget values reject malformed dates, unsafe precision and negative amounts", () => {
  assert.equal(budgetMoney("0.29"), 29); assert.equal(budgetMoney("100.01"), 10001);
  for (const value of ["-1", "1e6", "2.001", "NaN", true, 1e100]) assert.throws(() => budgetMoney(value));
  assert.equal(budgetPeriod("2026-10"), "2026-10");
  for (const value of ["2026-13", "2026-00", "26-10", "../"]) assert.throws(() => budgetPeriod(value));
  assert.throws(() => budgetCurrency("twd"));
});

test("tenant ownership comes from the validated session, never the payload", async () => {
  const db = state();
  const saved = await call(db, "PUT", plan({ user_id: "b" }));
  assert.equal(saved.status, 201); assert.equal(db.plans[0].user_id, "a");
  assert.equal(saved.body.budget.total_limit_minor, 3000000);
  assert.equal((await call(db, "GET", {}, "b")).body.budget, null);
  assert.equal((await call(db, "GET")).body.budget.version, 1);
  assert.equal((await call(db, "PUT", plan({ category_limits: { "cat-b": "100" } }))).status, 400);
});

test("two devices cannot silently overwrite a newer monthly budget", async () => {
  const db = state(); await call(db, "PUT", plan());
  assert.equal((await call(db, "PUT", plan())).status, 409);
  const updated = await call(db, "PUT", plan({ version: 1, total_limit: "35000" }));
  assert.equal(updated.body.budget.version, 2);
  assert.equal((await call(db, "PUT", plan({ version: 1, total_limit: "99999" }))).status, 409);
  assert.equal(db.plans[0].total_limit_minor, 3500000);
  assert.equal((await call(db, "DELETE", plan({ version: 1 }))).status, 409);
  assert.equal((await call(db, "DELETE", plan({ version: 2 }), "b")).status, 409);
  assert.equal(db.plans.length, 1);
  assert.equal((await call(db, "DELETE", plan({ version: 2 }))).status, 200);
  assert.equal(db.plans.length, 0);
});

test("buffer and category totals are bounded, while zero budget is legitimate", async () => {
  const db = state();
  assert.equal((await call(db, "PUT", plan({ safety_buffer: "30001" }))).status, 400);
  assert.equal((await call(db, "PUT", plan({ category_limits: { "cat-a": "30001" } }))).status, 400);
  assert.equal((await call(db, "PUT", plan({ category_limits: [] }))).status, 400);
  assert.equal((await call(db, "PUT", plan({ total_limit: "0", safety_buffer: "0", category_limits: {} }))).status, 201);
  assert.equal(db.plans[0].total_limit_minor, 0);
});
