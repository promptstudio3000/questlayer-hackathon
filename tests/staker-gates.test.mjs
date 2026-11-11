// Staker gates (owner decision 1 Nov 2026, 23:47 UTC): staker content opens
// by step AND level; the Staker step needs STAKER_MIN_NEAR (2) matured.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  allGates,
  checkGate,
  formatEur,
  nearToYocto,
  playerStakerAccess,
  recordStakerStatus,
  stakerAccess,
  stakerGateSettings,
} from "../server/staker-gates.mjs";
import { createNearPrice } from "../server/near-price.mjs";
import { stakerGatesView } from "../server/npc/trader-routes.mjs";

const N = 10n ** 24n;
const settings = stakerGateSettings({});

test("the table holds the owner's ladder: Staker+L2, Staker+L4, Tier 2+L6, Tier 3+L8", () => {
  const g = settings.gates;
  const pick = (k) => [g[k].step, g[k].level];
  for (const k of ["keeper_inner", "stake_today", "patron_chapter_1"]) assert.deepEqual(pick(k), ["staker", 2], k);
  for (const k of ["patron_line", "patron_aura", "patron_trader_rates"]) assert.deepEqual(pick(k), ["staker", 4], k);
  for (const k of ["t2_lines", "boss_arena_seat"]) assert.deepEqual(pick(k), ["tier2", 6], k);
  assert.deepEqual(pick("wandering_rare_patron"), ["tier3", 8]);
  assert.equal(settings.minNear, "2");
  assert.equal(settings.minYocto, 2n * N);
  // Lures only: nothing in the table speaks of odds, damage or payouts.
  assert.doesNotMatch(readFileSync(new URL("../server/data/staker-gates.json", import.meta.url), "utf8").replace(/never odds, damage or payouts/, ""), /odds|damage|payout|multiplier|chance/i);
});

test("steps: 2 NEAR matured is a Staker, tiers include the lower steps", () => {
  assert.equal(stakerAccess({ matured: 2n * N - 1n }, settings).stepName, "none");
  assert.equal(stakerAccess({ matured: 2n * N }, settings).stepName, "staker");
  assert.equal(stakerAccess({ tier: 2 }, settings).stepName, "tier2");
  assert.equal(stakerAccess({ tier: 3 }, settings).staker, true);
  assert.equal(stakerAccess({ tier: 9 }, settings).tier, 3);
});

test("missing parts are exact, with € only when a price exists", () => {
  const fresh = stakerAccess({ level: 1 }, settings);
  assert.deepEqual(
    checkGate("patron_line", fresh, { settings }).missing.map((m) => m.label),
    ["Stake 2 NEAR", "Reach level 4"],
  );
  assert.deepEqual(
    checkGate("keeper_inner", fresh, { settings, priceEur: 2.4 }).missing.map((m) => m.label),
    ["Stake 2 NEAR (~5 €)", "Reach level 2"],
  );
  const staker = stakerAccess({ matured: 2n * N, level: 4 }, settings);
  assert.equal(checkGate("patron_aura", staker, { settings }).open, true);
  const rare = checkGate("wandering_rare_patron", staker, { settings });
  assert.deepEqual(rare.missing.map((m) => m.label), ["Reach Tier 3 (50 NEAR matured)", "Reach level 8"]);
  const maturing = stakerAccess({ pending: 2n * N, level: 2 }, settings);
  assert.deepEqual(checkGate("keeper_inner", maturing, { settings }).missing.map((m) => m.kind), ["maturing"]);
  // The chip always prefills the stake sheet with the Staker minimum.
  assert.equal(checkGate("keeper_inner", fresh, { settings }).stakeNear, "2");
  const unknown = checkGate("no_such_gate", staker, { settings });
  assert.equal(unknown.open, false, "a typo never opens content");
  assert.equal(Object.keys(allGates(staker, { settings })).length, Object.keys(settings.gates).length);
});

test("overrides: STAKER_MIN_NEAR and STAKER_GATES_JSON, broken values ignored", () => {
  const s = stakerGateSettings({
    STAKER_MIN_NEAR: "3.5",
    STAKER_GATES_JSON: JSON.stringify({ patron_line: { level: 3 }, keeper_inner: { step: "bogus" }, boss_arena_seat: { step: "staker", level: 5 } }),
  });
  assert.equal(s.minNear, "3.5");
  assert.equal(s.minYocto, 35n * N / 10n);
  assert.deepEqual([s.gates.patron_line.step, s.gates.patron_line.level], ["staker", 3]);
  assert.deepEqual([s.gates.keeper_inner.step, s.gates.keeper_inner.level], ["staker", 2], "an invalid override keeps the default");
  assert.deepEqual([s.gates.boss_arena_seat.step, s.gates.boss_arena_seat.level], ["staker", 5]);
  assert.equal(stakerGateSettings({ STAKER_MIN_NEAR: "-1" }).minNear, "2");
  assert.equal(stakerGateSettings({ STAKER_GATES_JSON: "{nope" }).gates.patron_line.level, 4);
  assert.equal(nearToYocto("0"), null);
  assert.equal(nearToYocto("2.0001"), null);
});

test("€ rounding stays honest: half euros under 10 €, whole euros above", () => {
  assert.equal(formatEur("2", 2.4), "5");
  assert.equal(formatEur("2", 1.6), "3");
  assert.equal(formatEur("2", 1.4), "3");
  assert.equal(formatEur("2", 1.1), "2");
  assert.equal(formatEur("2", 0.8), "1.5");
  assert.equal(formatEur("2", 7), "14");
  assert.equal(formatEur("2", null), null);
});

test("the staker status cache feeds NPC access and GET /api/staker/gates", () => {
  const db = openDatabase(":memory:");
  const player = createPlayer(db, "Small");
  assert.equal(playerStakerAccess(db, player, { level: 3 }).stepName, "none", "no table yet is fine");
  recordStakerStatus(db, player, { tier: 1, matured: 2n * N, pending: 0n, weighted: N }, 1);
  const a = playerStakerAccess(db, player, { level: 3 });
  assert.equal(a.stepName, "staker");
  assert.equal(playerStakerAccess(db, player, { worldTier: 2, level: 3 }).stepName, "tier2", "the demo tier still counts");
  const view = stakerGatesView({ db, player, level: 3, priceEur: 2.5 });
  assert.equal(view.suggestNear, "2");
  assert.equal(view.priceEur, 2.5);
  assert.equal(view.access.step, "staker");
  assert.equal(view.gates.keeper_inner.open, true);
  assert.deepEqual(view.gates.patron_line.missing.map((m) => m.label), ["Reach level 4"]);
  assert.equal(stakerGatesView({ db, player, level: 3 }).priceEur, null);
});

test("NEAR price: fixed env value, off switch, cached feed with failures tolerated", async () => {
  assert.equal(createNearPrice({ env: { NEAR_PRICE_EUR: "2.3" } }).eur(), 2.3);
  assert.equal(createNearPrice({ env: { NEAR_PRICE_FEED: "off" } }).eur(), null);
  let calls = 0,
    now = 0;
  const feed = createNearPrice({
    env: {},
    clock: () => now,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ near: { eur: 2.5 } }) };
    },
  });
  assert.equal(feed.eur(), null, "no value before the first answer");
  await feed.refresh();
  assert.equal(feed.eur(), 2.5);
  const before = calls;
  feed.eur();
  assert.equal(calls, before, "cached within the hour");
  const broken = createNearPrice({ env: {}, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(await broken.refresh(), null);
});
