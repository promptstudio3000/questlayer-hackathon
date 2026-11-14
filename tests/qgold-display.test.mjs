import test from "node:test";
import assert from "node:assert/strict";
import { nearTextInQgold, parseQgoldPrice, qgoldOfNear } from "../src/qgold-display.ts";

test("NEAR amounts read in QGOLD in the game unit (1 NEAR = 1B)", () => {
  assert.equal(qgoldOfNear(2), "2B");
  assert.equal(qgoldOfNear("0.05"), "50M");
  assert.equal(qgoldOfNear(0.0005), "500K");
  assert.equal(nearTextInQgold("Stake 10 NEAR to enter"), "Stake 10B QGOLD to enter");
});

test("a QGOLD price becomes NEAR yocto", () => {
  assert.equal(parseQgoldPrice("50M"), (5n * 10n ** 22n).toString());
  assert.equal(parseQgoldPrice("50 000 000"), parseQgoldPrice("50 000K"));
  assert.equal(parseQgoldPrice("1.5B"), (15n * 10n ** 23n).toString());
  for (const bad of ["", "abc", "999", "0.05", "2000000000000", "-5"]) assert.throws(() => parseQgoldPrice(bad), bad);
});

test("creator prices and gifts: yocto reads as QGOLD and typed QGOLD stays in the contract's bounds", async () => {
  const { qgoldOfYocto, qgoldOfNear, parseQgoldAmount } = await import("../src/qgold-display.ts");
  assert.equal(qgoldOfYocto("500000000000000000000000"), "500M");
  assert.equal(qgoldOfYocto(10n ** 25n), "10B");
  assert.equal(qgoldOfYocto(undefined), "0");
  // Unlock price: 10M to 10B QGOLD (0.01 to 10 NEAR), empty is free.
  assert.equal(parseQgoldAmount("500M", 1e7, 1e10, true), (5n * 10n ** 23n).toString());
  assert.equal(parseQgoldAmount("", 1e7, 1e10, true), "0");
  assert.throws(() => parseQgoldAmount("5M", 1e7, 1e10, true));
  assert.throws(() => parseQgoldAmount("11B", 1e7, 1e10, true));
  // A gift chip of 0.05 NEAR round-trips through its QGOLD label.
  assert.equal(parseQgoldAmount(qgoldOfNear("0.05"), 1e7, 1e11), (5n * 10n ** 22n).toString());
});
