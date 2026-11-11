// Backed coins outside the Czech day plan (server/map-rewards/service.mjs,
// worldCoinCount): street cells elsewhere draw from the day's unplaced budget.
import test from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { openDatabase } from "../server/database.mjs";
import { setPotentialSource, ensureDayPlan } from "../server/map-rewards/day-plan.mjs";
import { worldCoinCount, worldCoinsEnabled } from "../server/map-rewards/service.mjs";
import { ensureWorld } from "../server/world.mjs";
import { NETWORK } from "../server/native/network.mjs";

// Payouts (and so world coins) are testnet-only.
const testnetOnly = { skip: NETWORK === "mainnet" && "payouts are testnet-only" };

const NOW = Date.parse("2026-11-05T12:00:00Z");
const MUNICH = { lat: 48.1374, lng: 11.5755 };
// Footways every ~80 m across the spot, as Overpass would return them.
function streets(center) {
  const elements = [];
  let id = 1;
  for (let i = -6; i <= 6; i++) {
    const d = i * 0.0008;
    elements.push({ type: "way", id: id++, tags: { highway: "footway" }, geometry: [{ lat: center.lat + d, lon: center.lng - 0.006 }, { lat: center.lat + d, lon: center.lng + 0.006 }] });
    elements.push({ type: "way", id: id++, tags: { highway: "footway" }, geometry: [{ lat: center.lat - 0.005, lon: center.lng + d }, { lat: center.lat + 0.005, lon: center.lng + d }] });
  }
  return { elements };
}
const mapData = {
  fetcher: async () =>
    new Response(JSON.stringify(streets(MUNICH)), { headers: { "content-type": "application/json" } }),
};

test("world coins need payouts and can be turned off", testnetOnly, () => {
  assert.equal(worldCoinsEnabled({}), false);
  assert.equal(worldCoinsEnabled({ MAP_PAYOUTS: "1" }), true);
  assert.equal(worldCoinsEnabled({ MAP_PAYOUTS: "1", MAP_WORLD_COINS: "off" }), false);
});

test("a street cell outside Czechia gets backed coins from the unplaced budget", testnetOnly, async (t) => {
  setPotentialSource(() => new Map());
  const before = process.env.MAP_PAYOUTS;
  process.env.MAP_PAYOUTS = "1";
  const db = openDatabase(":memory:");
  t.after(() => {
    db.close();
    if (before === undefined) delete process.env.MAP_PAYOUTS;
    else process.env.MAP_PAYOUTS = before;
  });
  const w = await ensureWorld(db, MUNICH, false, NOW, { mapData, poiSource: null });
  const cell = latLngToCell(MUNICH.lat, MUNICH.lng, 7);
  assert.equal(w.region, cell);
  const plan = ensureDayPlan(db, NOW);
  const coins = db
    .prepare("SELECT c.value_u v FROM coins c JOIN map_coin_meta m ON m.coin_id=c.id WHERE c.world_id=? AND m.cell=?")
    .all(w.id, cell);
  assert.ok(coins.length > 0, "coins placed on the streets");
  assert.ok(coins.every((c) => c.v === plan.summary.coinValueU), "same backed value as Czech coins");
  const drop = db.prepare("SELECT * FROM map_cell_drops WHERE world_id=? AND cell=?").get(w.id, cell);
  assert.equal(drop.day, plan.day);
  assert.equal(drop.pioneer, 0);
  assert.equal(drop.coins_u, coins.length * plan.summary.coinValueU);
  // The drop is taken from the unplaced reserve.
  const left = Math.floor((plan.summary.unplacedU.coins - drop.coins_u) / plan.summary.coinValueU);
  assert.equal(worldCoinCount(db, plan), Math.min(400, left));
});

test("the unplaced reserve caps world coins", () => {
  const db = openDatabase(":memory:");
  try {
    ensureDayPlan(db, NOW);
    const plan = { day: "2026-11-05", summary: { coinValueU: 3, unplacedU: { coins: 30 } } };
    assert.equal(worldCoinCount(db, plan), 10);
    assert.equal(worldCoinCount(db, { ...plan, summary: { coinValueU: 3, unplacedU: { coins: 0 } } }), 0);
  } finally {
    db.close();
  }
});
