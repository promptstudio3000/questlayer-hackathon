// Multi-city daily allocation and realized-yield backing.
import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateDailyBudget,
  allocationSettings,
  DAILY_BUCKET_CAP,
  fundedCities,
  manifestCost,
  realizedYieldBacking,
} from "../server/native/allocation.mjs";
import { nativeManifest } from "../server/native/reward-manifest.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN, sampleCityPaths } from "../server/spatial/city-pack.mjs";

const NEAR = 10n ** 24n;
const plan = buildCityPlan(PLZEN, "2026-11-04");
const treasury = (amount) => ({
  coins: { available: amount.toString() },
  zones: { available: amount.toString() },
});

test("one city with the full share gets exactly v1's capped budget", () => {
  const a = allocateDailyBudget({
    available: { coins: (NEAR / 10n).toString(), zones: "5" },
    cities: [{ id: "plzen" }],
  });
  assert.deepEqual(a.budget, {
    coins: DAILY_BUCKET_CAP.toString(),
    zones: "5",
  });
  assert.deepEqual(a.cities, [
    { id: "plzen", weight: 1, coins: DAILY_BUCKET_CAP.toString(), zones: "5" },
  ]);
  // And the manifest built from it is byte-identical to the default path.
  const points = sampleCityPaths(PLZEN);
  const t = treasury(NEAR / 10n);
  assert.equal(
    nativeManifest(plan, t, points, {
      budget: { coins: a.cities[0].coins, zones: a.cities[0].coins },
    }).hash,
    nativeManifest(plan, t, points).hash,
  );
});

test("the daily budget is the smaller of the cap and the share, split by weight", () => {
  const a = allocateDailyBudget({
    available: { coins: "1000000", zones: "999" },
    shareBps: 2500,
    cities: [
      { id: "plzen", weight: 2 },
      { id: "brno", weight: 1 },
      { id: "ostrava", weight: 1, enabled: false },
    ],
  });
  assert.deepEqual(a.budget, { coins: "250000", zones: "249" });
  // Sorted by id, rounded down, the remainder stays unallocated.
  assert.deepEqual(
    a.cities.map((c) => [c.id, c.coins, c.zones]),
    [
      ["brno", "83333", "83"],
      ["plzen", "166666", "166"],
    ],
  );
  assert.deepEqual(a.unallocated, { coins: "1", zones: "0" });
  for (const bucket of ["coins", "zones"])
    assert.ok(
      a.cities.reduce((n, c) => n + BigInt(c[bucket]), 0n) <=
        BigInt(a.budget[bucket]),
    );
});

test("adding cities never raises the day's total commitment", () => {
  const available = { coins: NEAR.toString(), zones: NEAR.toString() };
  const one = allocateDailyBudget({ available, cities: [{ id: "plzen" }] });
  const many = allocateDailyBudget({
    available,
    cities: ["plzen", "brno", "praha", "olomouc", "liberec"].map((id) => ({
      id,
    })),
  });
  const total = (a) =>
    a.cities.reduce((n, c) => n + BigInt(c.coins) + BigInt(c.zones), 0n);
  assert.ok(total(many) <= total(one));
  assert.equal(one.budget.coins, DAILY_BUCKET_CAP.toString());
});

test("a limit (realized yield) caps the budget below the share", () => {
  const a = allocateDailyBudget({
    available: { coins: NEAR.toString(), zones: NEAR.toString() },
    cities: [{ id: "plzen" }],
    limit: { coins: "88158404159160601752", zones: "88158404159160601752" },
  });
  assert.deepEqual(a.budget, {
    coins: "88158404159160601752",
    zones: "88158404159160601752",
  });
});

test("invalid city lists and shares are refused", () => {
  assert.throws(() => fundedCities([]), /one and sixteen/);
  assert.throws(
    () => fundedCities([{ id: "plzen" }, { id: "plzen" }]),
    /unique/,
  );
  assert.throws(() => fundedCities([{ id: "Plzen" }]), /unique native/);
  assert.throws(() => fundedCities([{ id: "plzen", weight: 0 }]), /weights/);
  assert.throws(
    () => fundedCities([{ id: "plzen", enabled: false }]),
    /enabled/,
  );
  assert.throws(
    () =>
      allocateDailyBudget({
        available: { coins: "1", zones: "1" },
        cities: [{ id: "plzen" }],
        shareBps: 0,
      }),
    /basis points/,
  );
  assert.throws(
    () =>
      allocateDailyBudget({
        available: { coins: "-1", zones: "1" },
        cities: [{ id: "plzen" }],
      }),
    /Invalid coins/,
  );
});

test("a budget above the cap or the available funds cannot become a manifest", () => {
  const points = sampleCityPaths(PLZEN);
  assert.throws(
    () =>
      nativeManifest(plan, treasury(NEAR), points, {
        budget: { coins: (DAILY_BUCKET_CAP + 1n).toString(), zones: "0" },
      }),
    /exceeds the cap/,
  );
  assert.throws(
    () =>
      nativeManifest(plan, treasury(1000n), points, {
        budget: { coins: "100000", zones: "0" },
      }),
    /exceeds the cap/,
  );
});

test("realized-yield backing counts vault payouts against yield-backed days", () => {
  const rewardsId = "rewards.testnet";
  const points = sampleCityPaths(PLZEN);
  const day = nativeManifest(plan, treasury(NEAR), points, {
    budget: { coins: "60000000000000000000", zones: "60000000000000000000" },
    funding: {
      source: "realized_yield",
      evidence: { paid: "176316808318321203504" },
    },
  });
  assert.equal(day.funding, "realized_yield");
  const cost = manifestCost(day);
  assert.ok(cost.total <= 120000000000000000000n);
  const backing = realizedYieldBacking({
    vaultStates: [{ rewards: rewardsId, game_paid: "176316808318321203504" }],
    yieldDays: [day],
    rewardsId,
  });
  assert.equal(backing.covered, true);
  assert.equal(backing.committed, cost.total.toString());
  assert.equal(BigInt(backing.free), 176316808318321203504n - cost.total);
  assert.equal(
    BigInt(backing.limit.coins) + BigInt(backing.limit.zones),
    BigInt(backing.free),
  );
  // Without any harvest there is nothing to back a day.
  const none = realizedYieldBacking({
    vaultStates: [{ rewards: rewardsId, game_paid: "0" }],
    yieldDays: [day],
    rewardsId,
  });
  assert.equal(none.covered, false);
  assert.deepEqual(none.limit, { coins: "0", zones: "0" });
  assert.throws(
    () =>
      realizedYieldBacking({
        vaultStates: [{ rewards: "other.testnet", game_paid: "1" }],
        yieldDays: [],
        rewardsId,
      }),
    /pay this rewards contract/,
  );
  // Sponsor-funded manifests carry no funding field and keep v1 hashes.
  assert.equal(nativeManifest(plan, treasury(NEAR), points).funding, undefined);
});

test("allocation settings come from the environment", () => {
  assert.deepEqual(allocationSettings({}), {
    budgetSplit: "demand",
    yieldBackedDays: false,
  });
  assert.deepEqual(
    allocationSettings({
      NATIVE_FUNDED_CITIES: "plzen:3, brno",
      NATIVE_DAILY_SHARE_BPS: "500",
      NATIVE_YIELD_BACKED_DAYS: "1",
    }),
    {
      fundedCities: [
        { id: "brno", weight: 1 },
        { id: "plzen", weight: 3 },
      ],
      budgetSplit: "demand",
      dailyShareBps: 500,
      yieldBackedDays: true,
    },
  );
  assert.throws(
    () => allocationSettings({ NATIVE_DAILY_SHARE_BPS: "20000" }),
    /1 to 10000/,
  );
});

// Global treasury (docs/GLOBAL-TREASURY.md): one budget, placed by demand.
import { DatabaseSync } from "node:sqlite";
import {
  demandWeights,
  recentCityPlayers,
} from "../server/native/allocation.mjs";

test("demand weights are 1 + recent players, capped, and ignore operator weights", () => {
  assert.deepEqual(
    demandWeights([{ id: "plzen", weight: 9 }, { id: "brno" }], { plzen: 4 }),
    [
      { id: "brno", weight: 1 },
      { id: "plzen", weight: 5 },
    ],
  );
  assert.equal(demandWeights([{ id: "plzen" }], { plzen: 5000 })[0].weight, 1000);
  assert.equal(demandWeights([{ id: "plzen" }], { plzen: -3 })[0].weight, 1);
});

test("the global budget follows players and never exceeds the one treasury budget", () => {
  const a = allocateDailyBudget({
    available: { coins: "1000", zones: "1000" },
    cities: demandWeights([{ id: "plzen" }, { id: "brno" }], { plzen: 8 }),
  });
  assert.equal(a.cities.find((c) => c.id === "plzen").coins, "900");
  assert.equal(a.cities.find((c) => c.id === "brno").coins, "100");
  const spent = a.cities.reduce((n, c) => n + BigInt(c.coins), 0n);
  assert.equal(spent + BigInt(a.unallocated.coins), BigInt(a.budget.coins));
});

test("recent players count distinct accounts in the seven dates before the day", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE native_reward_claims(day_id TEXT, account_id TEXT, kind TEXT, item_index INTEGER)",
  );
  const add = db.prepare("INSERT INTO native_reward_claims VALUES(?,?,'coin',0)");
  add.run("plzen-2026-11-03-v2", "a.testnet");
  add.run("plzen-2026-11-03-v2", "a.testnet");
  add.run("plzen-2026-10-28-v1", "b.testnet");
  add.run("plzen-2026-10-27-v1", "old.testnet"); // eight days before: out
  add.run("plzen-2026-11-04-v2", "today.testnet"); // the day itself: out
  add.run("brno-2026-11-01-v2", "a.testnet");
  assert.deepEqual(recentCityPlayers(db, "2026-11-04"), { plzen: 2, brno: 1 });
  assert.deepEqual(recentCityPlayers(new DatabaseSync(":memory:"), "2026-11-04"), {});
});

test("NATIVE_BUDGET_SPLIT defaults to demand and rejects unknown values", () => {
  assert.equal(allocationSettings({}).budgetSplit, "demand");
  assert.equal(allocationSettings({ NATIVE_BUDGET_SPLIT: "weights" }).budgetSplit, "weights");
  assert.throws(() => allocationSettings({ NATIVE_BUDGET_SPLIT: "city" }));
});
