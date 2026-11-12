import test from "node:test";
import assert from "node:assert/strict";
import { fundsReason, missingNear, nearText, qgoldText, qgoldWorth, YOCTO } from "../src/funds-help.ts";

const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;

test("no account to pay from is said first", () => {
  assert.equal(fundsReason({ account: "", have: null, need: near(1), qgold: null }), "no-account");
});

test("enough NEAR or an unknown balance does not block a purchase", () => {
  assert.equal(fundsReason({ account: "a.testnet", have: near(2), need: near(1.07), qgold: null }), "unknown");
  assert.equal(fundsReason({ account: "a.testnet", have: null, need: near(1.07), qgold: null }), "unknown");
  assert.equal(missingNear({ have: null, need: near(1) }), 0n);
});

test("too little NEAR with no QGOLD asks for NEAR", () => {
  const f = { account: "a.testnet", have: near(0.1), need: near(1.07), qgold: { units: 0n, worth: 0n } };
  assert.equal(fundsReason(f), "no-near");
  assert.equal(missingNear(f), near(0.97));
});

test("QGOLD that covers the missing NEAR leads to a swap, too little says so", () => {
  const base = { account: "a.testnet", have: near(0.5), need: near(1.5) };
  assert.equal(fundsReason({ ...base, qgold: { units: 1n, worth: near(1) } }), "qgold-covers");
  assert.equal(fundsReason({ ...base, qgold: { units: 1n, worth: near(0.4) } }), "qgold-short");
});

test("QGOLD worth mirrors the vault sell quote (R minus 1 %)", () => {
  // 1,000 QGOLD at R = 0.001 NEAR → 1 NEAR gross, 0.99 NEAR after the fee.
  assert.equal(qgoldWorth(1000n * 10n ** 6n, YOCTO / 1000n, 100), near(0.99));
  assert.equal(qgoldWorth(0n, YOCTO, 100), 0n);
});

test("amounts read short and never understate a need", () => {
  assert.equal(nearText(near(1.0205), 4), "1.0205");
  assert.equal(nearText(near(1.0201), 2), "1.03");
  assert.equal(nearText(null), "?");
  assert.equal(qgoldText(1234500000n), "1,234.5");
});
