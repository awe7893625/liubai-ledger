import assert from "node:assert/strict";
import test from "node:test";

import {
  internalAuthEmail,
  normalizeAmount,
  normalizedMerchant,
  normalizeUsername,
  requestClientIp,
  sha256Hex,
  validPassword,
} from "../../api/_shared/cloud.js";

test("normalize wallet currency strings to minor units", () => {
  assert.equal(normalizeAmount(120), 12000);
  assert.equal(normalizeAmount("$1,199.00"), 119900);
  assert.equal(normalizeAmount("NT$188"), 18800);
  assert.equal(normalizeAmount("-25"), -2500);
  assert.equal(normalizeAmount(""), null);
  assert.equal(normalizeAmount("12a"), null);
  assert.equal(normalizeAmount(Number.MAX_VALUE), null);
  assert.equal(normalizeAmount("99999999999999999999999"), null);
  assert.equal(normalizeAmount(Number.POSITIVE_INFINITY), null);
});

test("normalize merchant without inventing a value", () => {
  assert.equal(normalizedMerchant("  7-ELEVEN   信義店 "), "7-ELEVEN 信義店");
  assert.equal(normalizedMerchant("  "), null);
  assert.equal(normalizedMerchant(null), null);
  assert.equal(normalizedMerchant("x".repeat(300))?.length, 240);
});

test("sha256 helper is deterministic", () => {
  assert.equal(
    sha256Hex("ledger"),
    "fe14010b4fe83303852f0467c919ef9a7ca089b91e96e3aad7d426dd87079297",
  );
});

test("public beta usernames are normalized and reserved names rejected", () => {
  assert.equal(normalizeUsername("  Rain_2026 "), "rain_2026");
  assert.equal(normalizeUsername("ab"), null);
  assert.equal(normalizeUsername("a b c"), null);
  assert.equal(normalizeUsername("admin"), null);
  assert.equal(normalizeUsername("中文帳號"), null);
});

test("internal auth email is stable and non-routable", () => {
  const email = internalAuthEmail("rain_2026");
  assert.match(email, /^u-[a-f0-9]{32}@users\.liubai\.invalid$/);
  assert.equal(email, internalAuthEmail("rain_2026"));
  assert.notEqual(email, internalAuthEmail("rain_2027"));
});

test("beta passwords require 12-128 characters", () => {
  assert.equal(validPassword("12345678901"), false);
  assert.equal(validPassword("correct horse battery staple"), true);
  assert.equal(validPassword("x".repeat(129)), false);
});

test("Cloudflare client IP is trusted only behind an actual Cloudflare peer", () => {
  assert.equal(requestClientIp({ headers: {
    "cf-connecting-ip": "203.0.113.7",
    "x-vercel-forwarded-for": "104.16.12.34",
  } }), "203.0.113.7");
  assert.equal(requestClientIp({ headers: {
    "cf-connecting-ip": "203.0.113.7",
    "x-vercel-forwarded-for": "198.51.100.10",
  } }), "198.51.100.10");
  assert.equal(requestClientIp({ headers: {
    "cf-connecting-ip": "2001:db8::7",
    "x-vercel-forwarded-for": "2606:4700::1234",
  } }), "2001:db8::7");
});
