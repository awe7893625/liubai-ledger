import assert from "node:assert/strict";
import test from "node:test";
import { consumeAuthRateLimit, handleError } from "../../api/_shared/cloud.js";
process.env.SUPABASE_SECRET_KEY = "fixture-only-rate-key";

function fixture(ages, boundaryFailure = false) {
  const rows = ages.map((seconds) => ({ created_at: new Date(Date.now() - seconds * 1000).toISOString() }));
  const events = [];
  return { rows, events, db: { from(name) {
    assert.equal(name, "ledger_auth_attempts");
    const state = { action: "", head: false, range: null };
    const query = {
      async insert(row) { events.push("insert"); rows.push(row); return { error: null }; },
      select(_fields, options) { state.action = "read"; state.head = Boolean(options?.head); return query; },
      eq() { return query; }, gte() { return query; },
      order(_column, options) { assert.equal(options.ascending, false); return query; },
      range(start, end) { state.range = [start, end]; events.push(["boundary", start, end]); return query; },
      async maybeSingle() {
        if (boundaryFailure) return { data: null, error: { message: "fixture read failed" } };
        const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
        return { data: sorted[state.range[0]] || null, error: null };
      },
      delete() { state.action = "cleanup"; return query; },
      lt(_field, cutoff) { events.push(["cleanup-before", cutoff]); return query; },
      then(resolve) { return Promise.resolve(state.action === "cleanup" ? { error: null } : { count: rows.length, error: null }).then(resolve); },
    };
    return query;
  } } };
}
const req = { headers: { "x-vercel-forwarded-for": "192.0.2.50" } };

test("429 returns next available slot without lowering quotas or removing attempts", async () => {
  const f = fixture([50, 40, 30, 20, 10]);
  let rejected;
  try { await consumeAuthRateLimit(f.db, req, "signup", 5, 60); } catch (error) { rejected = error; }
  assert.equal(rejected.status, 429);
  assert.equal(rejected.code, "AUTH_RATE_LIMITED");
  assert.ok(rejected.retryAfterSeconds >= 19 && rejected.retryAfterSeconds <= 22);
  assert.deepEqual(f.events.find((event) => Array.isArray(event) && event[0] === "boundary"), ["boundary", 4, 4]);
  assert.equal(f.rows.length, 6);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === "cleanup-before"), false);
});

test("failed boundary lookup stays blocked for full window rather than failing open", async () => {
  const f = fixture([1, 2, 3, 4, 5], true);
  await assert.rejects(consumeAuthRateLimit(f.db, req, "signup", 5, 86400), (error) => error.status === 429 && error.retryAfterSeconds === 86400);
  assert.equal(f.rows.length, 6);
});

test("allowed attempts retain existing accounting and retention behavior", async () => {
  const f = fixture([10]);
  await consumeAuthRateLimit(f.db, req, "login", 20, 900);
  assert.equal(f.rows.length, 2);
  assert.ok(f.events.some((event) => Array.isArray(event) && event[0] === "cleanup-before"));
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === "boundary"), false);
});

test("public rate-limit response has safe Retry-After and no internal identifiers", () => {
  const headers = {}; let status; let body;
  const res = { setHeader(key, value) { headers[key] = value; }, status(value) { status = value; return this; }, json(value) { body = value; return value; } };
  handleError(res, { status: 429, message: "Too many attempts. Try again later.", retryAfterSeconds: 120 });
  assert.equal(status, 429); assert.equal(headers["Retry-After"], "120");
  assert.equal(headers["Cache-Control"], "no-store");
  assert.deepEqual(body, { ok: false, error: "Too many attempts. Try again later.", code: "AUTH_RATE_LIMITED", retry_after_seconds: 120 });
  handleError(res, { status: 401, message: "Invalid session", retryAfterSeconds: 120 });
  assert.equal(body.retry_after_seconds, undefined);
});
