import assert from "node:assert/strict";
import test, { after } from "node:test";

import handler from "./ingest.js";
import { sha256Hex } from "../../_shared/cloud.js";

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

async function invoke(state, body = requestBody(), token = DEVICE_TOKEN) {
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
    method: "POST",
    headers: { "x-ledger-device-token": token },
    body,
  }, response);
  return { status: statusCode, body: responseBody };
}

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
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
