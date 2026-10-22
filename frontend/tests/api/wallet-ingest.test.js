import assert from "node:assert/strict";
import test, { after } from "node:test";

import handler from "../../api/v2/wallet/ingest.js";
import { sha256Hex } from "../../api/_shared/cloud.js";

const USER_ID = "user-1";
const DEVICE_ID = "device-1";
const DEVICE_TOKEN = `ldb_dev_${"t".repeat(40)}`;
const ORIGINAL_FETCH = globalThis.fetch;

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SECRET_KEY = "service-role-test-key";

function createState() {
  return {
    devices: [{
      id: DEVICE_ID,
      user_id: USER_ID,
      token_hash: sha256Hex(DEVICE_TOKEN),
      revoked_at: null,
    }],
    accounts: [
      { id: "card-1", user_id: USER_ID, name: "日常 Visa", currency: "TWD", type: "card", card_aliases: ["Visa 1234"] },
      { id: "other-card", user_id: "user-2", name: "別人的卡", currency: "TWD", type: "card", card_aliases: ["Visa 1234"] },
    ],
    categories: [{ id: "cat-food", user_id: USER_ID, name: "餐飲", slug: "food" }, { id: "other-category", user_id: "user-2", name: "私有分類" }],
    events: [],
    transactions: [],
    nextEventId: 1,
    nextTransactionId: 1,
    failTransactionInsertOnce: false,
    failLinkUpdateOnce: false,
  };
}

function rowsFor(state, table) {
  if (table === "ledger_devices") return state.devices;
  if (table === "ledger_wallet_events") return state.events;
  if (table === "ledger_transactions") return state.transactions;
  if (table === "ledger_accounts") return state.accounts;
  if (table === "ledger_categories") return state.categories;
  throw new Error(`Unexpected table ${table}`);
}

function matches(row, url) {
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "limit", "order"].includes(key)) continue;
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    } else if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else {
      throw new Error(`Unsupported filter ${key}=${value}`);
    }
  }
  return true;
}

function project(row, url) {
  const selected = url.searchParams.get("select");
  if (!selected || selected === "*") return { ...row };
  return Object.fromEntries(selected.split(",").map((key) => [key, row[key]]));
}

function installSupabaseBoundary(state) {
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const table = url.pathname.split("/").at(-1);
    const method = init.method || (typeof input === "object" ? input.method : "GET");
    const body = init.body ? JSON.parse(init.body) : null;
    const respond = (status, payload) => new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
    const rows = rowsFor(state, table);

    if (method === "GET") {
      return respond(200, rows.filter((row) => matches(row, url)).map((row) => project(row, url)));
    }

    if (method === "POST") {
      const values = Array.isArray(body) ? body[0] : body;
      if (table === "ledger_wallet_events" && state.events.some(
        (row) => row.user_id === values.user_id && row.request_id === values.request_id,
      )) {
        return respond(409, { code: "23505", message: "duplicate wallet event" });
      }
      if (table === "ledger_transactions" && state.transactions.some(
        (row) => row.user_id === values.user_id && row.request_id === values.request_id,
      )) {
        return respond(409, { code: "23505", message: "duplicate transaction" });
      }
      if (table === "ledger_transactions" && state.failTransactionInsertOnce) {
        state.failTransactionInsertOnce = false;
        return respond(503, { code: "TRANSIENT", message: "temporary transaction failure" });
      }
      const row = {
        ...values,
        ...(table === "ledger_wallet_events" && { transaction_id: values.transaction_id ?? null }),
        id: table === "ledger_wallet_events"
          ? `event-${state.nextEventId++}`
          : `tx-${state.nextTransactionId++}`,
      };
      rows.push(row);
      return respond(201, [project(row, url)]);
    }

    if (method === "PATCH") {
      if (table === "ledger_wallet_events" && state.failLinkUpdateOnce) {
        state.failLinkUpdateOnce = false;
        return respond(503, { code: "TRANSIENT", message: "temporary link failure" });
      }
      const changed = rows.filter((row) => matches(row, url));
      for (const row of changed) Object.assign(row, body);
      return respond(200, changed.map((row) => project(row, url)));
    }

    if (method === "DELETE") {
      const kept = rows.filter((row) => !matches(row, url));
      rows.splice(0, rows.length, ...kept);
      return respond(204, null);
    }

    throw new Error(`Unsupported Supabase method ${method}`);
  };
}

function requestBody(overrides = {}) {
  return {
    request_id: "request-1",
    amount: "12.34",
    currency: "twd",
    merchant: "Original Merchant",
    card: "Visa 1234",
    occurred_at: "2026-09-28T10:11:12.000Z",
    ...overrides,
  };
}

async function invoke(state, body = requestBody(), token = DEVICE_TOKEN, method = "POST") {
  installSupabaseBoundary(state);
  let statusCode;
  let responseBody;
  const response = {
    setHeader() {},
    status(status) {
      statusCode = status;
      return this;
    },
    json(bodyValue) {
      responseBody = bodyValue;
      return bodyValue;
    },
  };
  await handler({
    method,
    headers: { "x-ledger-device-token": token },
    body,
  }, response);
  return { status: statusCode, body: responseBody };
}

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test("device config includes only its owner's choices and no ledger history", async () => {
  const state = createState();
  const a = await invoke(state, {}, DEVICE_TOKEN, "GET");
  const b = await invoke(state, {}, DEVICE_TOKEN, "GET");
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.accounts, { "日常 Visa": "card-1" });
  assert.deepEqual(a.body.categories, { "餐飲": "cat-food" });
  assert.notEqual(a.body.request_id, b.body.request_id);
  assert.equal(a.body.transactions, undefined);
  assert.equal(state.transactions.length, 0);
});

test("manual expense/income are correctly signed, tenant-scoped, and safely replayed", async () => {
  const state = createState();
  const body = requestBody({ source: "manual", direction: "expense", account_id: "card-1", category_id: "cat-food", note: "午餐", amount: "120", user_id: "user-2" });
  const expense = await invoke(state, body);
  const replay = await invoke(state, { ...body, amount: "999" });
  assert.equal(expense.status, 201);
  assert.equal(replay.body.tx_id, expense.body.tx_id);
  assert.equal(state.transactions[0].amount_minor, -12000);
  assert.equal(state.transactions[0].source, "manual");
  assert.equal(state.transactions[0].user_id, USER_ID);
  assert.equal(state.transactions[0].account_id, "card-1");
  assert.equal(state.transactions[0].category_id, "cat-food");
  assert.equal(state.transactions[0].note, "午餐");
  const income = await invoke(state, { ...body, direction: "income", request_id: "income-2", amount: "3000" });
  assert.equal(income.body.amount_minor, 300000);
  assert.equal(state.transactions[1].amount_minor, 300000);
});

test("foreign account/category, invalid manual amount and missing request ID cannot create rows", async () => {
  const state = createState();
  const body = requestBody({ source: "manual", account_id: "card-1" });
  for (const fields of [{ account_id: "other-card" }, { category_id: "other-category" }, { amount: -1 }, { amount: "" }, { request_id: "" }]) {
    assert.equal((await invoke(state, { ...body, ...fields })).status, 400);
  }
  assert.equal(state.transactions.length, 0);
  assert.equal(state.events.length, 0);
});

test("unknown cards are retained without guessing; known aliases map only within tenant", async () => {
  const state = createState();
  const known = await invoke(state);
  assert.equal(known.body.account_match, "matched");
  assert.equal(state.transactions[0].account_id, "card-1");
  assert.equal(known.body.needs_review, false);
  const unknown = await invoke(state, requestBody({ card: "New Bank Card", request_id: "unknown-2" }));
  assert.equal(unknown.body.ok, true);
  assert.equal(unknown.body.needs_review, true);
  assert.equal(unknown.body.result, "review");
  assert.equal(state.transactions[1].card_label, "New Bank Card");
  assert.equal(state.transactions[1].account_id, null);
});

test("connectivity probe creates no bookkeeping event and revoked devices fail", async () => {
  const state = createState();
  assert.equal((await invoke(state, { dry_run: true })).body.dry_run, true);
  assert.equal(state.events.length, 0);
  assert.equal(state.transactions.length, 0);
  state.devices[0].revoked_at = new Date().toISOString();
  assert.equal((await invoke(state, {}, DEVICE_TOKEN, "GET")).status, 401);
  assert.equal((await invoke(state)).status, 401);
});

test("wallet ingest accepts, deduplicates, and recovers safely", async () => {
  {
    const state = createState();
    const first = await invoke(state);
    const replay = await invoke(state);

    assert.equal(first.status, 201);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.duplicate, false);
    assert.ok(first.body.tx_id);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.tx_id, first.body.tx_id);
    assert.equal(state.transactions.length, 1);
  }

  {
    const state = createState();
    state.failTransactionInsertOnce = true;
    const failed = await invoke(state);

    assert.equal(failed.status, 503);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].transaction_id, null);

    const recovered = await invoke(state);

    assert.equal(recovered.status, 200);
    assert.ok(recovered.body.tx_id);
    assert.equal(state.events[0].transaction_id, recovered.body.tx_id);
  }

  {
    const state = createState();
    state.events.push({
      id: "event-orphan",
      user_id: USER_ID,
      device_id: DEVICE_ID,
      request_id: "request-1",
      amount_minor: 1234,
      currency: "TWD",
      merchant_raw: "Original Merchant",
      card_raw: "Visa 1234",
      occurred_at: "2026-09-28T10:11:12.000Z",
      status: "received",
      transaction_id: null,
      payload: {},
    });

    const result = await invoke(state);

    assert.equal(result.status, 200);
    assert.equal(result.body.duplicate, true);
    assert.equal(state.transactions.length, 1);
    assert.equal(state.events[0].transaction_id, result.body.tx_id);
  }

  {
    const state = createState();
    const results = await Promise.all([invoke(state), invoke(state)]);

    assert.equal(state.transactions.length, 1);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
    assert.ok(results.every((result) => result.body.ok && result.body.tx_id));
    assert.equal(results[0].body.tx_id, results[1].body.tx_id);
  }

  {
    const state = createState();
    state.failLinkUpdateOnce = true;
    const failed = await invoke(state);

    assert.equal(failed.status, 503);
    assert.equal(state.transactions.length, 1);
    assert.equal(state.events[0].transaction_id, null);

    const retried = await invoke(state);

    assert.equal(retried.status, 200);
    assert.equal(state.events[0].transaction_id, retried.body.tx_id);
  }

  {
    const state = createState();
    const first = await invoke(state);
    const replay = await invoke(state, requestBody({
      amount: "99.99",
      merchant: "Changed Merchant",
      card: "Mastercard 9999",
      occurred_at: "2026-09-29T22:22:22.000Z",
    }));

    assert.equal(replay.status, 200);
    assert.equal(replay.body.tx_id, first.body.tx_id);
    assert.equal(state.events[0].amount_minor, 1234);
    assert.equal(state.events[0].merchant_raw, "Original Merchant");
    assert.equal(state.transactions[0].amount_minor, -1234);
    assert.equal(state.transactions[0].merchant, "Original Merchant");
  }

  {
    const state = createState();
    const missing = await invoke(state, requestBody(), "");
    const invalid = await invoke(state, requestBody(), "ldb_dev_short");

    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 401);
    assert.equal(state.events.length, 0);
  }
});
