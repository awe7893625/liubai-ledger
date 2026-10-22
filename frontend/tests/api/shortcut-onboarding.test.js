import test from "node:test";
import assert from "node:assert/strict";
import { deviceReadiness, shortcutReadiness } from "../../api/_shared/shortcut-onboarding.js";
import devicesHandler from "../../api/v2/devices.js";

const user = "user-a";
const phone = { id: "phone-a", name: "iPhone", revoked_at: null };
function event(source = "manual", patch = {}) {
  return { user_id: user, device_id: phone.id, status: "processed", transaction_id: "tx-1",
    payload: { source, account_id: "owned-card" }, received_at: "2026-10-22T06:00:00Z", ...patch };
}

test("pairing or probe alone does not unlock Wallet setup", () => {
  const result = deviceReadiness(user, phone, null, null);
  assert.equal(result.stage, "manual_required");
  assert.equal(result.can_configure_wallet, false);
  assert.equal(result.ios_trigger_attested, false);
});

test("only a processed manual receipt for this owner and this phone unlocks", () => {
  for (const invalid of [event("apple_pay"), event("manual", { status: "received" }),
    event("manual", { status: "needs_review" }), event("manual", { user_id: "user-b" }),
    event("manual", { device_id: "phone-b" }), event("manual", { payload: {} })]) {
    assert.equal(deviceReadiness(user, phone, invalid, null).can_configure_wallet, false);
  }
  const valid = deviceReadiness(user, phone, event(), null);
  assert.equal(valid.stage, "wallet_setup_ready");
  assert.equal(valid.can_configure_wallet, true);
});

test("deleting the test transaction keeps the processed historical receipt", () => {
  const result = deviceReadiness(user, phone, event("manual", { transaction_id: null }), null);
  assert.equal(result.can_configure_wallet, true);
  assert.equal(result.manual_receipt.transaction_id, null);
});

test("revoked device cannot lend its success to another phone", () => {
  assert.equal(deviceReadiness(user, { ...phone, revoked_at: "2026-10-22" }, event(), null), null);
  assert.equal(deviceReadiness(user, { ...phone, id: "phone-new" }, event(), null).can_configure_wallet, false);
});

test("Wallet receipt is reported accurately without claiming native iOS attestation", () => {
  const confirmed = deviceReadiness(user, phone, event(), event("apple_pay"));
  assert.equal(confirmed.stage, "wallet_receipt_received");
  assert.equal(confirmed.ios_trigger_attested, false);
  const unmapped = deviceReadiness(user, phone, event(), event("apple_pay", { payload: { source: "apple_pay", account_id: null } }));
  assert.equal(unmapped.stage, "wallet_received_review");
  const uncommitted = deviceReadiness(user, phone, event(), event("apple_pay", { status: "needs_review", transaction_id: null }));
  assert.equal(uncommitted.wallet_receipt, null);
});

function boundary(rows, seen) {
  return { from(table) {
    assert.equal(table, "ledger_wallet_events");
    const filters = [];
    const query = {
      select(columns) { seen.push({ columns, filters }); return query; },
      eq(key, value) { filters.push([key, [value]]); return query; },
      in(key, values) { filters.push([key, values]); return query; },
      order(key) { assert.equal(key, "received_at"); return query; },
      limit(n) { assert.equal(n, 1); return query; },
      async maybeSingle() {
        const match = rows.filter((row) => filters.every(([key, values]) => values.includes(key === "payload->>source" ? row.payload.source : row[key])))
          .sort((a, b) => b.received_at.localeCompare(a.received_at));
        return { data: match[0] || null, error: null };
      },
    };
    return query;
  } };
}

test("read queries are owner/device-scoped and response contains no financial payload", async () => {
  const seen = [];
  const db = boundary([event(), event("manual", { user_id: "user-b" }), event("manual", { device_id: "revoked-phone" })], seen);
  const result = await shortcutReadiness(db, user, [phone, { id: "revoked-phone", revoked_at: "2026-10-22" }]);
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.deepEqual(call.filters.slice(0, 2), [["user_id", [user]], ["device_id", [phone.id]]]);
  }
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].can_configure_wallet, true);
  for (const forbidden of ["token_hash", "amount_minor", "merchant_raw", "account_id", '"payload"']) {
    assert.equal(JSON.stringify(result).includes(forbidden), false);
  }
});

test("devices API enforces session ownership and serves optional receipt progress", async () => {
  const previous = globalThis.fetch;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SECRET_KEY = "server-test-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "public-test-key";
  let authenticated = user;
  const deviceRows = [{ ...phone, user_id: user, created_at: "2026-10-22T00:00:00Z" }];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: authenticated, aud: "authenticated" }), { status: 200, headers: { "content-type": "application/json" } });
    const table = url.pathname.split("/").at(-1);
    assert.ok(["ledger_devices", "ledger_wallet_events"].includes(table));
    const sourceRows = table === "ledger_devices" ? deviceRows : [event()];
    let rows = sourceRows.filter((row) => [...url.searchParams.entries()].every(([key, value]) => {
      if (["select", "limit", "order"].includes(key)) return true;
      const actual = key === "payload->>source" ? row.payload?.source : row[key];
      if (value.startsWith("eq.")) return String(actual) === value.slice(3);
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(actual);
      throw new Error(`Unexpected filter ${key}`);
    }));
    if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
    const columns = url.searchParams.get("select")?.split(",");
    if (columns) rows = rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key]])));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  };
  const invoke = async (headers, query = { onboarding: "1" }) => {
    let status, body;
    const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; return value; } };
    await devicesHandler({ method: "GET", headers, query }, res);
    return { status, body };
  };
  try {
    assert.equal((await invoke({})).status, 401);
    const own = await invoke({ authorization: "Bearer test-session" });
    assert.equal(own.status, 200);
    assert.equal(own.body.onboarding.devices[0].stage, "wallet_setup_ready");
    const normal = await invoke({ authorization: "Bearer test-session" }, {});
    assert.equal(normal.body.onboarding, undefined);
    authenticated = "user-b";
    const other = await invoke({ authorization: "Bearer other-session" }, { onboarding: "1", user_id: user });
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.devices, []);
    assert.deepEqual(other.body.onboarding.devices, []);
  } finally { globalThis.fetch = previous; }
});
