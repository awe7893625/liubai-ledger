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
      { id: "account-1", user_id: USER_ID, name: "玉山卡" },
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
      const changed = rows.filter((row) => matches(row, url));
      for (const row of changed) Object.assign(row, body);
      return respond(200, changed.map((row) => project(row, url)));
    }

    if (method === "DELETE") {
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
