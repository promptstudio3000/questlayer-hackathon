import test from "node:test";
import assert from "node:assert/strict";
import {
  contributionBps,
  isVaultV2,
  quoteContribution,
  quotePartialExit,
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

const v2 = (principalNear, bps, extra = {}) =>
  position(principalNear, bps, {
    version: 2,
    contribution_bps: bps,
    partial_exit: "0",
    pending_contribution_bps: null,
    staked: (BigInt(principalNear) * NEAR).toString(),
    unstaked: "0",
    high_water_basis: (BigInt(principalNear) * NEAR).toString(),
    ...extra,
  });

test("partial exit and share changes are offered only on v2 positions", () => {
  assert.equal(isVaultV2(position(10, 5000)), false);
  assert.equal(isVaultV2(v2(10, 5000)), true);
  const summary = summarizeFuel([position(10, 5000)], null);
  assert.equal(quotePartialExit(position(10, 5000), (NEAR).toString(), summary).ok, false);
  assert.equal(quoteContribution(position(10, 5000), 0, summary).ok, false);
});

test("partial exit quote returns principal, settles the city's earned share and keeps 0.001 staked", () => {
  // 10 NEAR principal, 0.2 NEAR gain at 50 %: 0.1 settles to the city.
  const p = v2(10, 5000, {
    staked: (10n * NEAR + NEAR / 5n).toString(),
  });
  const summary = summarizeFuel([p], null);
  const q = quotePartialExit(p, (4n * NEAR).toString(), summary);
  assert.equal(q.ok, true);
  assert.equal(q.receiveNear, 4);
  assert.equal(q.cityFeeNear, 0.1);
  assert.equal(q.remainingNear, 6);
  assert.equal(q.goldAfter, 3000);
  assert.equal(quotePartialExit(p, (10n * NEAR).toString(), summary).ok, false);
  assert.equal(quotePartialExit(p, (10n * NEAR - 10n ** 21n).toString(), summary).ok, true);
  assert.equal(quotePartialExit(p, (10n ** 20n).toString(), summary).ok, false);
  const busy = v2(10, 5000, { stage: "unstaking", partial_exit: "1" });
  assert.equal(quotePartialExit(busy, NEAR.toString(), summary).ok, false);
  assert.equal(fuelStatus(busy).label, "Taking part of your stake out…");
  assert.equal(
    fuelStatus(v2(10, 5000, { stage: "unlocking", partial_exit: "1" })).label,
    "Part of your stake is coming back",
  );
});

test("contribution quote never re-prices earned gain and uses the live share", () => {
  const clean = v2(100, 5000);
  const summary = summarizeFuel([clean], null);
  const now = quoteContribution(clean, 10000, summary);
  assert.equal(now.ok && now.settlesFirst, false);
  assert.equal(now.ok && now.goldAfter, 100000);
  assert.equal(now.ok && now.tierAfter, 3);
  const earned = v2(100, 5000, { staked: (101n * NEAR).toString() });
  const later = quoteContribution(earned, 0, summarizeFuel([earned], null));
  assert.equal(later.ok && later.settlesFirst, true);
  assert.equal(quoteContribution(clean, 5000, summary).ok, false);
  assert.equal(quoteContribution(clean, 10001, summary).ok, false);
  // Waiting change: shown as pending, live share drives fuel.
  const waiting = v2(10, 5000, { pending_contribution_bps: 0 });
  assert.equal(fuelStatus(waiting).tone, "pending");
  assert.equal(quoteContribution(waiting, 0, summarizeFuel([waiting], null)).ok, false);
  const changed = { ...v2(10, 2500), contribution_bps: 5000 };
  assert.equal(contributionBps(changed), 2500);
  assert.equal(weightedGold(changed), 2500);
});
