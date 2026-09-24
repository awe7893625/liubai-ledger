import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAmount,
  normalizedMerchant,
  sha256Hex,
} from "./cloud.js";

test("normalize wallet currency strings to minor units", () => {
  assert.equal(normalizeAmount(120), 12000);
  assert.equal(normalizeAmount("$1,199.00"), 119900);
  assert.equal(normalizeAmount("NT$188"), 18800);
  assert.equal(normalizeAmount("-25"), -2500);
  assert.equal(normalizeAmount(""), null);
  assert.equal(normalizeAmount("12a"), null);
});

test("normalize merchant without inventing a value", () => {
  assert.equal(normalizedMerchant("  7-ELEVEN   信義店 "), "7-ELEVEN 信義店");
  assert.equal(normalizedMerchant("  "), null);
  assert.equal(normalizedMerchant(null), null);
});

test("sha256 helper is deterministic", () => {
  assert.equal(
    sha256Hex("ledger"),
    "fe14010b4fe83303852f0467c919ef9a7ca089b91e96e3aad7d426dd87079297",
  );
});
