// Map coins on realized yield only (13 Nov 2026): the day's coin budget is
// the yield drip, a few coins per opened cell, and placement never exceeds
// the budget (server/map-rewards/service.mjs coinRoom, budget.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import {
  mapDayBudget,
  mapYieldCommitted,
  recordMapBudget,
} from "../server/map-rewards/budget.mjs";
import { ensureDayPlan, setPotentialSource } from "../server/map-rewards/day-plan.mjs";
import { coinRoom, worldCoinCount } from "../server/map-rewards/service.mjs";
import { runMapChainWorker } from "../server/map-rewards/chain.mjs";
import { realizedYieldBacking } from "../server/native/allocation.mjs";

const NOW = Date.parse("2026-11-14T08:00:00Z");
const NEAR = 10n ** 24n;
const RATE = 10n ** 18n; // 1 QGOLD = 1 microNEAR

function drop(db, cell, coinsU) {
  db.prepare("INSERT INTO map_cell_drops VALUES(?,?,?,?,?,?,?,?,?)").run(
    `w-${cell}`,
    cell,
    "2026-11-14",
    10,
    coinsU,
    0,
    0,
    0,
    NOW,
  );
}

test("placement stops once the day's coin budget is placed", () => {
  const db = openDatabase(":memory:");
  try {
    setPotentialSource(() => new Map());
    ensureDayPlan(db, NOW);
    const plan = { day: "2026-11-14", summary: { coinValueU: 100, unplacedU: { coins: 2500 } } };
    assert.equal(coinRoom(db, plan, 100), 25);
    assert.equal(worldCoinCount(db, plan), 10);
    drop(db, "a", 1000);
    drop(db, "b", 1000);
    assert.equal(coinRoom(db, plan, 100), 5);
    assert.equal(worldCoinCount(db, plan), 5);
    // A pioneer coin is worth double, so half as many fit.
    assert.equal(coinRoom(db, plan, 200), 2);
    drop(db, "c", 500);
    assert.equal(coinRoom(db, plan, 100), 0);
    assert.equal(worldCoinCount(db, plan), 0);
  } finally {
    db.close();
  }
});

test("a yield-backed budget may be zero; a chain report may not", () => {
  const db = openDatabase(":memory:");
  try {
    assert.equal(recordMapBudget(db, { coinYocto: "0", zoneYocto: "0", rateYocto: String(RATE) }), false);
    assert.equal(
      recordMapBudget(db, { coinYocto: "0", zoneYocto: "0", rateYocto: String(RATE), source: "realized_yield" }),
      true,
    );
    const b = mapDayBudget(db);
    assert.equal(b.coinsU, 0);
    assert.equal(b.source, "realized_yield");
  } finally {
    db.close();
  }
});

test("the map worker records the yield drip below the chain cap", async () => {
  const db = openDatabase(":memory:");
  try {
    const view = async (method) =>
      method === "get_date_totals" ? { cap: String(NEAR / 10n), coins: "0", zones: "0" } : null;
    const drip = { coinYocto: String(5n * 10n ** 20n), zoneYocto: String(5n * 10n ** 20n) };
    const r = await runMapChainWorker(db, {
      call: async () => "tx",
      view,
      signer: { sign: () => "sig" },
      contractId: "rewards.testnet",
      now: NOW,
      qgoldRate: async () => String(RATE),
      budgetOnly: true,
      yieldLimit: async () => drip,
    });
    assert.equal(r.budget, true);
    const b = mapDayBudget(db);
    assert.equal(b.source, "realized_yield");
    assert.equal(b.coinYocto, drip.coinYocto);
    // 0.0005 NEAR at 1 QGOLD = 1 microNEAR: 500 QGOLD for coins.
    assert.equal(b.coinsU, 500_000_000);
    // Without a yield limit the chain cap (half of 0.1 NEAR) applies.
    await runMapChainWorker(db, {
      call: async () => "tx",
      view,
      signer: { sign: () => "sig" },
      contractId: "rewards.testnet",
      now: NOW,
      qgoldRate: async () => String(RATE),
      budgetOnly: true,
    });
    assert.equal(mapDayBudget(db).coinYocto, String(NEAR / 20n));
    assert.equal(mapDayBudget(db).source, "chain");
  } finally {
    db.close();
  }
});

test("city days and map coins share one realized yield", () => {
  const db = openDatabase(":memory:");
  try {
    setPotentialSource(() => new Map());
    assert.equal(mapYieldCommitted(db, NOW), 0n);
    recordMapBudget(db, {
      coinYocto: String(4n * 10n ** 20n),
      zoneYocto: String(6n * 10n ** 20n),
      rateYocto: String(RATE),
      source: "realized_yield",
    });
    ensureDayPlan(db, NOW);
    // Today's whole yield-backed map budget is committed.
    assert.equal(mapYieldCommitted(db, NOW), 10n ** 21n);
    const backing = realizedYieldBacking({
      vaultStates: [
        { accountId: "v.testnet", rewards: "r.testnet", game_paid: String(8n * 10n ** 21n) },
      ],
      yieldDays: [],
      rewardsId: "r.testnet",
      dripDays: 7,
      extraCommitted: mapYieldCommitted(db, NOW),
    });
    assert.equal(backing.free, String(7n * 10n ** 21n));
    assert.equal(backing.daily, String(10n ** 21n));
  } finally {
    db.close();
  }
});
