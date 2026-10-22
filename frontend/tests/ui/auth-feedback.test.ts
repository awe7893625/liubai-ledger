import assert from "node:assert/strict";
import test from "node:test";
import { cooldownLabel, publicAuthError, retryDeadline, sanitizedCooldowns, routeForAuth } from "../../src/public-site/auth-feedback.ts";
const now = Date.parse("2026-10-23T01:00:00Z");

test("retry deadlines prefer validated server seconds then HTTP Retry-After", () => {
  assert.equal(retryDeadline("40", { retry_after_seconds: 120 }, "signup", now), now + 120000);
  assert.equal(retryDeadline("40", {}, "login", now), now + 40000);
  assert.equal(retryDeadline("Fri, 23 Oct 2026 01:02:00 GMT", null, "recover", now), now + 120000);
  assert.equal(retryDeadline(null, null, "signup", now), now + 86400000);
  assert.equal(retryDeadline("bad", { retry_after_seconds: -1 }, "login", now), now + 900000);
  assert.equal(retryDeadline(null, { retry_after_seconds: 1e12 }, "login", now), now + 604800000);
});

test("session cooldown data contains only finite future timestamps on known routes", () => {
  const clean = sanitizedCooldowns({ signup: now + 90000, login: now - 1, recover: "password", google: now + 1e15, user_id: "private" }, now);
  assert.deepEqual(clean, { signup: now + 90000 });
  assert.deepEqual(sanitizedCooldowns(null, now), {});
  assert.deepEqual(sanitizedCooldowns([], now), {});
});

test("cooldown labels and localized errors do not expose backend internals", () => {
  assert.equal(cooldownLabel(now - 1, now), "可以重試");
  assert.equal(cooldownLabel(now + 40000, now), "約 40 秒後可重試");
  assert.equal(cooldownLabel(now + 120000, now), "約 2 分鐘後可重試");
  assert.match(cooldownLabel(now + 86400000, now), /24 小時/);
  assert.match(publicAuthError(429, { error: "internal bucket id" }, "signup"), /等待/);
  assert.doesNotMatch(publicAuthError(500, { error: "private secret stack" }, "login"), /secret|stack/);
  assert.match(publicAuthError(401, {}, "recover"), /復原碼/);
  assert.match(publicAuthError(409, {}, "signup"), /已被使用/);
  assert.equal(routeForAuth("/api/v2/auth/signup"), "signup");
});
