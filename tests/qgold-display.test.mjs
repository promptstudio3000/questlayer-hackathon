import test from "node:test";
import assert from "node:assert/strict";
import { nearTextInQgold, parseQgoldPrice, qgoldOfNear } from "../src/qgold-display.ts";

test("NEAR amounts read in QGOLD at 1 QGOLD = 1 microNEAR", () => {
  assert.equal(qgoldOfNear(2), "2M");
  assert.equal(qgoldOfNear("0.05"), "50K");
  assert.equal(qgoldOfNear(0.0005), "500");
  assert.equal(nearTextInQgold("Stake 10 NEAR to enter"), "Stake 10M QGOLD to enter");
});

test("a QGOLD price becomes NEAR yocto", () => {
  assert.equal(parseQgoldPrice("50000"), (5n * 10n ** 22n).toString());
  assert.equal(parseQgoldPrice("50 000"), parseQgoldPrice("50K"));
  assert.equal(parseQgoldPrice("1.5M"), (15n * 10n ** 23n).toString());
  for (const bad of ["", "abc", "999", "0.05", "2000000000", "-5"]) assert.throws(() => parseQgoldPrice(bad), bad);
});
