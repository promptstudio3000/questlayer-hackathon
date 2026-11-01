import test from "node:test";
import assert from "node:assert/strict";
import {
  fuelStatus,
  nextTier,
  previewFuel,
  summarizeFuel,
  tierFor,
  weightedGold,
} from "../src/city-fuel.ts";

const NEAR = 10n ** 24n;
const position = (principalNear, bps, extra = {}) => ({
  id: "p",
  account_id: "v.testnet",
  pool: "aurora.pool.f863973.m0",
  contribution_bps: bps,
  state: "registered",
  position: {
    stage: "idle",
    principal: (BigInt(principalNear) * NEAR).toString(),
    owner_pending: "0",
    game_pending: "0",
    owner_credit: "0",
    exit_requested: false,
    ...extra,
  },
});

test("weighted fuel is principal times the shared yield, in GOLD", () => {
  assert.equal(weightedGold(position(5, 5000)), 2500);
  assert.equal(weightedGold(position(5, 5000, { exit_requested: true })), 0);
});

test("tiers open at 50,000 and 100,000 GOLD of fuel", () => {
  assert.equal(tierFor(49_999), 1);
  assert.equal(tierFor(50_000), 2);
  assert.equal(tierFor(100_000), 3);
  assert.deepEqual(nextTier(20_000), { tier: 2, missingGold: 30_000, gold: 50_000 });
  assert.equal(nextTier(100_000), null);
});

test("share of the city fuel uses the observed city total", () => {
  const s = summarizeFuel([position(5, 5000)], {
    weightedStake: (10n * NEAR).toString(),
    stakers: 2,
  });
  assert.equal(s.myWeightedGold, 2500);
  assert.equal(s.cityWeightedGold, 10_000);
  assert.equal(s.share, 0.25);
  assert.equal(s.myStakeNear, 5);
  assert.equal(summarizeFuel([], null).share, null);
});

test("preview shows the tier a deposit would reach", () => {
  const s = summarizeFuel([position(40, 10000)], null);
  const p = previewFuel(s, 10, 100);
  assert.equal(p.addedGold, 10_000);
  assert.equal(p.tierAfter, 2);
});

test("position states use pending, ready and failed words", () => {
  assert.equal(fuelStatus({ ...position(1, 100), position: null, state: "failed" }).tone, "failed");
  assert.equal(fuelStatus({ ...position(1, 100), position: null, state: "created" }).tone, "pending");
  assert.equal(fuelStatus(position(1, 100, { owner_credit: "5" })).tone, "ready");
  assert.equal(fuelStatus(position(1, 100, { stage: "unlocking" })).tone, "unlocking");
  assert.equal(fuelStatus(position(1, 100)).label, "Fueling the city");
});
