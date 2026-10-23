import assert from "node:assert/strict";
import test from "node:test";
import { accountInput, cardKey, checkAccountCollision, matchAccount } from "../../api/_shared/account-config.js";

const accounts = [
  { id: "a", name: "日常信用卡", card_aliases: ["My Bank Visa 1234"] },
  { id: "b", name: "旅行信用卡", card_aliases: ["My Bank Visa 5678"] },
];

test("any issuer; exact aliases only, two cards from one bank never fuzzy-match", () => {
  assert.equal(matchAccount(" my bank visa 1234 ", accounts).account.id, "a");
  assert.equal(matchAccount("MY BANK VISA 5678", accounts).account.id, "b");
  assert.equal(matchAccount("My Bank", accounts).account, null);
  assert.equal(matchAccount("unrecognised card", accounts).reason, "unmatched");
  assert.equal(matchAccount("", accounts).reason, "missing");
  assert.equal(cardKey("ＡＢＣ　1234"), "abc 1234");
});
test("ambiguous aliases are never assigned arbitrarily", () => {
  const ambiguous = [...accounts, { id: "c", name: "另一張", card_aliases: ["My Bank Visa 1234"] }];
  assert.equal(matchAccount("My Bank Visa 1234", ambiguous).account, null);
  assert.equal(matchAccount("My Bank Visa 1234", ambiguous).reason, "ambiguous");
});
test("per-tenant account names and aliases cannot overlap", () => {
  assert.throws(() => checkAccountCollision({ name: "新卡", card_aliases: ["MY BANK VISA 1234"] }, accounts), /已屬於/);
  assert.doesNotThrow(() => checkAccountCollision({ name: "日常信用卡", card_aliases: ["My Bank Visa 1234"] }, accounts, "a"));
});
test("reject full card numbers; allow nicknames and last-four only", () => {
  assert.throws(() => accountInput({ name: "4111 1111 1111 1111" }), /完整卡號/);
  assert.throws(() => accountInput({ name: "信用卡", card_aliases: ["4111111111111111"] }), /完整卡號/);
  assert.equal(accountInput({ name: "我的信用卡 1234", type: "card" }).currency, "TWD");
  assert.equal(accountInput({ name: "現金", type: "cash" }).type, "cash");
  assert.throws(() => accountInput({ name: "日圓卡", currency: "JPY" }), /TWD/);
});
