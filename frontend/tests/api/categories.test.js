import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import handler, { categoryName } from "../../api/_shared/category-handler.js";
const original = globalThis.fetch;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SECRET_KEY = "service-test";
process.env.SUPABASE_PUBLISHABLE_KEY = "public-test";
afterEach(() => { globalThis.fetch = original; });
const initial = () => [{ id: "food-a", user_id: "a", name: "餐飲", slug: "food" }, { id: "food-b", user_id: "b", name: "別人的分類", slug: "food" }];
function boundary(rows) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return response(200, { id: new Headers(init.headers).get("Authorization")?.endsWith("token-b") ? "b" : "a" });
    assert.ok(url.pathname.endsWith("/ledger_categories"));
    const match = (row) => [...url.searchParams].every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3));
    if (!init.method || init.method === "GET") return response(200, rows.filter(match));
    const body = JSON.parse(init.body);
    if (init.method === "POST") {
      if (rows.some((row) => row.user_id === body.user_id && row.slug === body.slug)) return response(409, { code: "23505" });
      const row = { ...body, id: `created-${rows.length}` }; rows.push(row); return response(201, [row]);
    }
    if (init.method === "PATCH") {
      const selected = rows.filter(match);
      if (selected.some((row) => rows.some((other) => other.id !== row.id && other.user_id === row.user_id && other.slug === body.slug))) return response(409, { code: "23505" });
      selected.forEach((row) => Object.assign(row, body)); return response(200, selected);
    }
    throw new Error("Unexpected write");
  };
}
async function call(rows, method, body = {}, owner = "a", authenticated = true) {
  boundary(rows); let status; let result;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; return value; } };
  await handler({ method, headers: authenticated ? { authorization: `Bearer token-${owner}` } : {}, body }, res);
  return { status, body: result };
}
test("category labels normalize text but reject controls and excessive length", () => {
  assert.equal(categoryName("  ＡＢＣ  Travel  "), "ABC Travel");
  for (const value of ["", " ", "bad\nname", "x".repeat(33), 42, null]) assert.throws(() => categoryName(value));
});
test("category create/list is tenant-owned and ignores spoofed owner and ID", async () => {
  const rows = initial();
  const added = await call(rows, "POST", { name: "旅行", user_id: "b", id: "food-b" });
  assert.equal(added.status, 201); assert.equal(rows[2].user_id, "a");
  assert.equal((await call(rows, "GET", {}, "b")).body.categories.length, 1);
  assert.equal((await call(rows, "GET", {}, "a", false)).status, 401);
  assert.equal((await call(rows, "POST", { name: "餐飲", id: "food-a" })).status, 409);
});
test("category rename preserves identity/default slug and rejects stale/foreign writes", async () => {
  const rows = initial();
  const renamed = await call(rows, "PATCH", { id: "food-a", expected_name: "餐飲", name: "飲食" });
  assert.equal(renamed.status, 200); assert.equal(renamed.body.category.id, "food-a"); assert.equal(renamed.body.category.slug, "food");
  assert.equal((await call(rows, "PATCH", { id: "food-a", expected_name: "餐飲", name: "舊畫面覆蓋" })).status, 409);
  assert.equal((await call(rows, "PATCH", { id: "food-a", expected_name: "飲食", name: "跨帳號" }, "b")).status, 404);
  assert.equal(rows[0].name, "飲食"); assert.equal(rows[1].name, "別人的分類");
});
test("custom labels are idempotent by normalized name; renamed old label can be recreated", async () => {
  const rows = initial();
  const one = await call(rows, "POST", { name: "Travel" });
  assert.equal((await call(rows, "POST", { name: "ＴＲＡＶＥＬ" })).status, 409);
  const id = one.body.category.id;
  assert.equal((await call(rows, "PATCH", { id, expected_name: "Travel", name: "Holidays" })).status, 200);
  assert.equal((await call(rows, "POST", { name: "Travel" })).status, 201);
});
test("deletion and excessive category creation remain unavailable", async () => {
  const rows = initial();
  assert.equal((await call(rows, "DELETE", { id: "food-a" })).status, 405);
  const many = Array.from({ length: 100 }, (_, index) => ({ id: String(index), user_id: "a", name: `c${index}`, slug: `c${index}` }));
  assert.equal((await call(many, "POST", { name: "another" })).status, 400);
});
