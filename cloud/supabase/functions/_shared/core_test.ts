import { assertEquals } from "jsr:@std/assert@1";
import { normalizeAmount, normalizedMerchant, sha256Hex } from "./core.ts";

Deno.test("normalize wallet currency strings to minor units", () => {
  assertEquals(normalizeAmount(120), 12000);
  assertEquals(normalizeAmount("$1,199.00"), 119900);
  assertEquals(normalizeAmount("NT$188"), 18800);
  assertEquals(normalizeAmount("-25"), -2500);
  assertEquals(normalizeAmount(""), null);
  assertEquals(normalizeAmount("12a"), null);
});

Deno.test("normalize merchant without inventing a value", () => {
  assertEquals(normalizedMerchant("  7-ELEVEN   信義店 "), "7-ELEVEN 信義店");
  assertEquals(normalizedMerchant("  "), null);
  assertEquals(normalizedMerchant(null), null);
});

Deno.test("sha256 helper is deterministic", async () => {
  assertEquals(
    await sha256Hex("ledger"),
    "fe14010b4fe83303852f0467c919ef9a7ca089b91e96e3aad7d426dd87079297",
  );
});
