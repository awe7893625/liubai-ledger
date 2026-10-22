import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import handler from "../../api/v2/transactions.js";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const ORIGINAL_FETCH = globalThis.fetch;

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SECRET_KEY = "service-role-test-key";
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";

function createState() {
  return {
    accounts: [
      { id: "account-1", user_id: USER_ID, name: "玉山卡", currency: "TWD" },
      { id: "account-usd", user_id: USER_ID, name: "USD", currency: "USD" },
      { id: "account-2", user_id: OTHER_USER_ID, name: "別人的卡" },
    ],
    categories: [
      { id: "category-1", user_id: USER_ID, name: "餐飲" },
    ],
    transactions: [],
    nextTx: 1,
  };
}

function tableRows(state, table) {
  if (table === "ledger_accounts") return state.accounts;
  if (table === "ledger_categories") return state.categories;
  if (table === "ledger_transactions") return state.transactions;
  throw new Error(`Unexpected table ${table}`);
}

function decodeFilter(value) {
  if (value.startsWith("eq.")) return { type: "eq", value: value.slice(3) };
  if (value === "is.null") return { type: "null" };
  return null;
}

function matches(row, url) {
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
    const filter = decodeFilter(value);
    if (!filter) continue;
    if (filter.type === "eq" && String(row[key]) !== filter.value) return false;
    if (filter.type === "null" && row[key] != null) return false;
  }
  return true;
}

function project(row, url) {
  const selected = url.searchParams.get("select");
  if (!selected || selected === "*") return { ...row };
  return Object.fromEntries(selected.split(",").map((key) => [key, row[key]]));
}

function installBoundary(state) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method || (typeof input === "object" ? input.method : "GET");
    const respond = (status, payload) => new Response(
      payload === null ? "" : JSON.stringify(payload),
      { status, headers: { "content-type": "application/json" } },
    );

    if (url.pathname === "/auth/v1/user") {
      return respond(200, {
        id: USER_ID,
        email: "user@example.test",
        aud: "authenticated",
        role: "authenticated",
      });
    }

    const table = url.pathname.split("/").at(-1);
    const rows = tableRows(state, table);
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET") {
      return respond(200, rows.filter((row) => matches(row, url)).map((row) => project(row, url)));
    }

    if (method === "POST") {
      const values = Array.isArray(body) ? body[0] : body;
      if (
        table === "ledger_transactions" &&
        rows.some((row) => row.user_id === values.user_id && row.request_id === values.request_id)
      ) {
        return respond(409, { code: "23505", message: "duplicate transaction" });
      }
      const row = {
        id: table === "ledger_transactions" ? `tx-${state.nextTx++}` : values.id,
        created_at: new Date().toISOString(),
        ...values,
      };
      rows.push(row);
      return respond(201, [project(row, url)]);
    }

    if (method === "PATCH") {
      if (state.beforeMutation) { const hook = state.beforeMutation; state.beforeMutation = null; hook(rows, method); }
      const changed = rows.filter((row) => matches(row, url));
      for (const row of changed) Object.assign(row, body);
      return respond(200, changed.map((row) => project(row, url)));
    }

    if (method === "DELETE") {
      if (state.beforeMutation) { const hook = state.beforeMutation; state.beforeMutation = null; hook(rows, method); }
      const removed = rows.filter((row) => matches(row, url));
      const kept = rows.filter((row) => !matches(row, url));
      rows.splice(0, rows.length, ...kept);
      return respond(200, removed.map((row) => project(row, url)));
    }

    throw new Error(`Unsupported method ${method}`);
  };
}

async function invoke(state, method, body) {
  installBoundary(state);
  let statusCode = 0;
  let responseBody;
  const response = {
    setHeader() {},
    status(status) {
      statusCode = status;
      return this;
    },
    json(value) {
      responseBody = value;
      return value;
    },
  };
  await handler({
    method,
    headers: { authorization: "Bearer session-token" },
    body,
  }, response);
  return { status: statusCode, body: responseBody };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test("manual transaction is tenant-owned, normalized, and idempotent", async () => {
  const state = createState();
  const payload = {
    request_id: "manual-request-1",
    amount: "123.40",
    merchant: "  午餐  ",
    account_id: "account-1",
    category_id: "category-1",
    occurred_at: "2026-10-21T12:30:00+08:00",
    note: "測試",
  };

  const first = await invoke(state, "POST", payload);
  const replay = await invoke(state, "POST", payload);

  assert.equal(first.status, 201);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.transaction.amount_minor, -12340);
  assert.equal(first.body.transaction.merchant, "午餐");
  assert.equal(first.body.transaction.card_label, "玉山卡");
  assert.equal(first.body.transaction.source, "manual");
  assert.equal(state.transactions[0].user_id, USER_ID);

  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.transaction.id, first.body.transaction.id);
  assert.equal(state.transactions.length, 1);
});

test("manual transaction cannot attach another user's account", async () => {
  const state = createState();
  const result = await invoke(state, "POST", {
    amount: 50,
    merchant: "跨租戶測試",
    account_id: "account-2",
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /Unknown account/);
  assert.equal(state.transactions.length, 0);
});

test("editing preserves ownership, historical purchase date and transfer classification", async () => {
  const state = createState();
  state.transactions.push({ id: "legacy", user_id: USER_ID, request_id: "legacy", currency: "TWD", amount_minor: -50000,
    merchant: "Transfer", source: "statement", status: "confirmed", legacy_kind: "transfer", legacy_date: "2026-07-01",
    updated_at: "2026-01-01T00:00:00Z", occurred_at: "2026-07-01T04:00:00Z" });
  const changed = await invoke(state, "PATCH", { id: "legacy", amount: "400.25", date: "2026-07-02", expected_updated_at: "2026-01-01T00:00:00Z" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.transaction.amount_minor, -40025);
  assert.equal(changed.body.transaction.legacy_date, "2026-07-02");
  assert.equal(changed.body.transaction.legacy_kind, "transfer");
  assert.equal(changed.body.transaction.source, "statement");
  assert.equal((await invoke(state, "PATCH", { id: "legacy", amount: 1, expected_updated_at: "2026-01-01T00:00:00Z" })).status, 409);
  assert.equal((await invoke(state, "PATCH", { id: "legacy", date: "2026-02-30" })).status, 400);
  assert.equal((await invoke(state, "PATCH", { id: "legacy", account_id: "account-usd" })).status, 400);
});

test("pending amount defaults to expense and cannot be confirmed without complete fields", async () => {
  const state = createState();
  state.transactions.push({ id: "pending", user_id: USER_ID, currency: "TWD", amount_minor: null, merchant: null, status: "pending" });
  assert.equal((await invoke(state, "PATCH", { id: "pending", status: "confirmed" })).status, 400);
  const fixed = await invoke(state, "PATCH", { id: "pending", amount: "80", merchant: "Coffee", status: "confirmed" });
  assert.equal(fixed.status, 200); assert.equal(fixed.body.transaction.amount_minor, -8000);
  assert.equal(fixed.body.transaction.status, "confirmed");
  assert.equal((await invoke(state, "POST", { amount: 1, merchant: "x", account_id: "account-usd", currency: "TWD" })).status, 400);
});

test("delete is scoped to the authenticated user", async () => {
  const state = createState();
  state.transactions.push({
    id: "other-tx",
    user_id: OTHER_USER_ID,
    request_id: "other",
    amount_minor: -100,
    merchant: "Other",
  });

  const result = await invoke(state, "DELETE", { id: "other-tx" });

  assert.equal(result.status, 404);
  assert.equal(state.transactions.length, 1);
});

test("manual refunds are positive but remain refunds; transfer requires an explicit flow", async () => {
  const state = createState();
  const refund = await invoke(state, "POST", { amount: "20", merchant: "退貨", kind: "refund", request_id: "refund" });
  assert.equal(refund.status, 201); assert.equal(refund.body.transaction.legacy_kind, "refund");
  assert.equal(refund.body.transaction.amount_minor, 2000);
  assert.equal((await invoke(state, "POST", { amount: 20, merchant: "移帳", kind: "transfer" })).status, 400);
  const outgoing = await invoke(state, "POST", { amount: 100, merchant: "移帳", kind: "transfer", direction: "expense" });
  assert.equal(outgoing.body.transaction.amount_minor, -10000); assert.equal(outgoing.body.transaction.legacy_kind, "transfer");
  assert.equal(state.transactions.length, 2); // No hidden other-account entry created.
});

test("same request ID with different durable content returns conflict, never fake success", async () => {
  const state = createState();
  const body = { amount: "120", merchant: "午餐", request_id: "content-collision", occurred_at: "2026-10-23T04:00:00Z" };
  const first = await invoke(state, "POST", body); assert.equal(first.status, 201);
  for (const changed of [{ amount: 121 }, { merchant: "晚餐" }, { kind: "refund" }, { note: "changed" }, { currency: "USD" }, { occurred_at: "2026-10-24T04:00:00Z" }]) {
    const replay = await invoke(state, "POST", { ...body, ...changed });
    assert.equal(replay.status, 409); assert.equal(replay.body.ok, false);
  }
  const exact = await invoke(state, "POST", { ...body, occurred_at: "2026-10-23T12:00:00+08:00" });
  assert.equal(exact.status, 200); assert.equal(exact.body.transaction.id, first.body.transaction.id);
  assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].amount_minor, -12000);
});

test("marking duplicate preserves the row; restoring confirmed validates missing fields", async () => {
  const state = createState();
  state.transactions.push({ id: "missing", user_id: USER_ID, amount_minor: null, merchant: null, currency: "TWD", status: "pending", source: "apple_pay" });
  assert.equal((await invoke(state, "PATCH", { id: "missing", status: "duplicate" })).status, 200);
  assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].status, "duplicate");
  assert.equal((await invoke(state, "PATCH", { id: "missing", status: "confirmed" })).status, 400);
  const restored = await invoke(state, "PATCH", { id: "missing", amount: "100", merchant: "補齊", kind: "expense", status: "confirmed" });
  assert.equal(restored.status, 200); assert.equal(state.transactions[0].source, "apple_pay");
  assert.equal(state.transactions[0].amount_minor, -10000);
});

test("an editor may explicitly reclassify an imported row without changing provenance fields", async () => {
  const state = createState();
  state.transactions.push({ id: "imported", user_id: USER_ID, amount_minor: -3000, currency: "TWD", merchant: "原始紀錄", source: "email", status: "confirmed", legacy_kind: "expense", legacy_date: "2026-07-03", updated_at: "2026-10-23T01:00:00Z" });
  const refund = await invoke(state, "PATCH", { id: "imported", kind: "refund", expected_updated_at: "2026-10-23T01:00:00Z" });
  assert.equal(refund.status, 200); assert.equal(refund.body.transaction.amount_minor, 3000);
  assert.equal(refund.body.transaction.legacy_date, "2026-07-03"); assert.equal(refund.body.transaction.source, "email");
  assert.equal(refund.body.transaction.legacy_kind, "refund");
  const transfer = await invoke(state, "PATCH", { id: "imported", kind: "transfer", direction: "expense" });
  assert.equal(transfer.body.transaction.legacy_kind, "transfer"); assert.equal(transfer.body.transaction.amount_minor, -3000);
});

test("stale delete fails and same-revision delete succeeds", async () => {
  const state = createState();
  const created = await invoke(state, "POST", { amount: 1, merchant: "One" });
  const tx = created.body.transaction;
  assert.equal((await invoke(state, "DELETE", { id: tx.id, expected_updated_at: "2020-01-01T00:00:00Z" })).status, 409);
  assert.equal(state.transactions.length, 1);
  assert.equal((await invoke(state, "DELETE", { id: tx.id, expected_updated_at: tx.updated_at })).status, 200);
  assert.equal(state.transactions.length, 0);
});

test("read/compare/write and delete guards detect an intervening change even for older clients", async () => {
  for (const method of ["PATCH", "DELETE"]) {
    const state = createState();
    const result = await invoke(state, "POST", { amount: 10, merchant: "Concurrent" });
    state.beforeMutation = (rows) => { rows[0].updated_at = "2099-01-01T00:00:00Z"; rows[0].merchant = "Newer edit"; };
    const changed = await invoke(state, method, { id: result.body.transaction.id, merchant: "Stale edit" });
    assert.equal(changed.status, 409); assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].merchant, "Newer edit");
  }
});

test("unknown classifications and fractional cents are rejected without writes", async () => {
  const state = createState();
  assert.equal((await invoke(state, "POST", { amount: 1.001, merchant: "x" })).status, 400);
  assert.equal((await invoke(state, "POST", { amount: 10, merchant: "x", kind: "arbitrary" })).status, 400);
  assert.equal(state.transactions.length, 0);
});
