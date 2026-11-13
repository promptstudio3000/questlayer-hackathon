import test from "node:test";
import assert from "node:assert/strict";
import { cellToLatLng, latLngToCell, cellToParent } from "h3-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { distance, dayKey } from "../server/domain.mjs";
import { verifyProof } from "../server/chain-ledger/merkle.mjs";
import { czechiaCells, isInCzechia } from "../server/map-rewards/czechia.mjs";
import {
  placeCellCoins,
  spaceCoins,
  waveTimes,
} from "../server/map-rewards/placement.mjs";
import {
  buildDayPlan,
  cellProof,
  coinValue,
  ensureDayPlan,
  mapDaySeed,
  readCell,
  setPotentialSource,
  zonesForPotential,
} from "../server/map-rewards/day-plan.mjs";
import { mapRewardsView } from "../server/map-rewards/service.mjs";
import {
  AREA_CAP_BPS,
  CELL_CAP_BPS,
  CELL_COINS,
  COIN_TARGET,
  COIN_SPACING_NEAR_ZONE_M,
} from "../server/map-rewards/policy.mjs";
import { mapDayBudget, recordMapBudget } from "../server/map-rewards/budget.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z"); // 13:00 in Prague
const PLZEN = { lat: 49.7477, lng: 13.3776 };

// A dense street grid: points every ~16 m on lines ~80 m apart.
function grid(center, size = 1200, step = 16, gap = 80) {
  const out = [],
    dLat = 1 / 110540,
    dLng = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let y = -size / 2; y <= size / 2; y += gap)
    for (let x = -size / 2; x <= size / 2; x += step) {
      out.push({ lat: center.lat + y * dLat, lng: center.lng + x * dLng });
      out.push({ lat: center.lat + x * dLat, lng: center.lng + y * dLng });
    }
  return out;
}

test("Czechia is about 16 thousand res-7 cells and excludes its neighbours", () => {
  const cells = czechiaCells();
  assert.ok(cells.length > 15000 && cells.length < 17500, `${cells.length}`);
  assert.ok(isInCzechia(49.7477, 13.3776)); // Plzeň
  assert.ok(isInCzechia(50.087, 14.421)); // Praha
  assert.ok(isInCzechia(49.195, 16.608)); // Brno
  assert.ok(!isInCzechia(48.208, 16.373)); // Vienna
  assert.ok(!isInCzechia(51.05, 13.74)); // Dresden
});

test("coins keep 60-120 m apart, gather near zones and never cluster", () => {
  const samples = grid(PLZEN);
  const zone = { lat: PLZEN.lat + 0.004, lng: PLZEN.lng };
  const spots = spaceCoins(samples, [zone], { seed: "s", max: 400 });
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++)
      assert.ok(
        distance(spots[i], spots[j]) >= COIN_SPACING_NEAR_ZONE_M - 0.5,
        "no two coins closer than 60 m",
      );
  const near = spots.filter((s) => distance(s, zone) <= 300).length,
    far = spots.filter((s) => distance(s, PLZEN) <= 300).length;
  assert.ok(near >= 2 * far, `near zone ${near}, elsewhere ${far}`);
  // Deterministic.
  assert.deepEqual(spaceCoins(samples, [zone], { seed: "s", max: 400 }), spots);
});

test("every coin in a cell is worth the same, up to the planned count, in six waves", () => {
  const samples = grid(PLZEN);
  const { coins, spentU } = placeCellCoins({
    samples,
    zones: [PLZEN],
    seed: "x",
    count: 400,
    valueU: 7,
  });
  assert.ok(coins.length > 50 && coins.length <= 400);
  assert.ok(coins.every((c) => c.valueU === 7 && c.tier === "small"));
  assert.equal(spentU, coins.length * 7);
  assert.deepEqual(
    [...new Set(coins.map((c) => c.wave))].sort(),
    [0, 1, 2, 3, 4, 5],
  );
  // The count caps the spots; value 0 = XP-only coins (the demo arena).
  assert.equal(
    placeCellCoins({ samples, seed: "x", count: 10, valueU: 7 }).coins.length,
    10,
  );
  const xp = placeCellCoins({ samples, seed: "x", count: 5, valueU: 0 });
  assert.equal(xp.coins.length, 5);
  assert.equal(xp.spentU, 0);
  assert.equal(placeCellCoins({ samples, seed: "x", count: 0, valueU: 7 }).coins.length, 0);
});

test("six waves open between 06:30 and 22:00 local time in order", () => {
  const times = waveTimes("2026-11-05", "Europe/Prague", "seed");
  assert.equal(times.length, 6);
  const local = (t) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      hour: "2-digit",
      minute: "2-digit",
    }).format(t);
  assert.ok(
    local(times[0]) >= "07:00" && local(times[0]) <= "07:30",
    local(times[0]),
  );
  assert.ok(local(times[5]) < "22:00", local(times[5]));
  for (let i = 1; i < 6; i++) assert.ok(times[i] > times[i - 1]);
  assert.notDeepEqual(
    waveTimes("2026-11-06", "Europe/Prague", "other").map(local),
    times.map(local),
  );
});

test("the day plan backs every coin equally and spreads zone prizes with caps", () => {
  const cells = czechiaCells();
  const plzen = latLngToCell(PLZEN.lat, PLZEN.lng, 7);
  const demand = new Map([[plzen, 40]]),
    potential = new Map(cells.slice(0, 3000).map((c, i) => [c, i % 200])),
    pioneers = new Set(cells.slice(0, 1000));
  const coinsU = 50_000_000_000,
    zonesU = 1_000_000_000,
    args = {
      day: "2026-11-05",
      seed: mapDaySeed("2026-11-05"),
      coinsU,
      zonesU,
      demand,
      potential,
      pioneers,
    },
    plan = buildDayPlan(args);
  // One coin = the coin budget over the day's coin target; every opened cell
  // may place CELL_COINS of them and the whole budget is the commitment
  // (placement stops when it is placed: service.mjs coinRoom).
  const value = Math.floor(coinsU / COIN_TARGET);
  assert.equal(plan.summary.coinValueU, value);
  assert.equal(coinValue(coinsU), value);
  assert.equal(coinValue(coinsU, 50), Math.floor(coinsU / 50));
  assert.ok(value > 0);
  assert.equal(plan.rows.length, cells.length, "every cell has backed coins");
  assert.ok(plan.rows.every((r) => r.coinsU === CELL_COINS * value && r.coins === CELL_COINS));
  assert.equal(plan.rows.filter((r) => r.pioneer).length, pioneers.size);
  assert.equal(plan.pioneerU, 0);
  assert.equal(plan.coinsU, coinsU);
  assert.equal(plan.summary.unplacedU.coins, coinsU);
  assert.equal(plan.summary.coinTarget, COIN_TARGET);
  // Zone prizes keep the formula and its caps.
  assert.ok(plan.rows.every((r) => r.zonesU <= (zonesU * CELL_CAP_BPS) / 10000));
  const areas = new Map();
  for (const r of plan.rows)
    areas.set(
      cellToParent(r.cell, 5),
      (areas.get(cellToParent(r.cell, 5)) || 0) + r.zonesU,
    );
  assert.ok(
    [...areas.values()].every((v) => v <= (zonesU * AREA_CAP_BPS) / 10000),
  );
  assert.equal(plan.summary.components.votes, 0);
  const rank = [...plan.rows]
    .sort((a, b) => b.zonesU - a.zonesU)
    .findIndex((r) => r.cell === plzen);
  assert.ok(rank < 50, `rank ${rank}`);
  // Same inputs, same root; a budget too small for one unit per share gives no coins.
  assert.equal(buildDayPlan(args).root, plan.root);
  const poor = buildDayPlan({ ...args, coinsU: COIN_TARGET - 1 });
  assert.equal(poor.summary.coinValueU, 0);
  assert.ok(poor.rows.every((r) => r.coinsU === 0 && r.coins === 0));
  assert.equal(zonesForPotential(0), 1);
  assert.equal(zonesForPotential(40), 2);
  assert.equal(zonesForPotential(500), 3);
});

test("the day budget comes from the chain report, priced in micro-QGOLD at R", () => {
  const db = openDatabase(":memory:");
  try {
    // Defaults: 0.05 NEAR for coins at R = 0.001 NEAR per QGOLD = 50 QGOLD.
    const first = mapDayBudget(db, {});
    assert.equal(first.coinsU, 50_000_000);
    assert.equal(first.source, "default");
    assert.ok(
      recordMapBudget(db, {
        coinYocto: (25n * 10n ** 24n).toString(),
        zoneYocto: (10n ** 24n).toString(),
        rateYocto: (2n * 10n ** 21n).toString(),
      }),
    );
    const b = mapDayBudget(db, {});
    assert.equal(b.coinsU, 12_500_000_000); // 25 NEAR / 0.002 = 12,500 QGOLD
    assert.equal(b.zonesU, 500_000_000);
    assert.equal(b.source, "chain");
    assert.equal(recordMapBudget(db, { coinYocto: "0", zoneYocto: "1", rateYocto: "1" }), false);
  } finally {
    db.close();
  }
});

test("a cell drop follows the stored plan, proves its leaf and opens coins in waves", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Wave walker", NOW);
    const w = await ensureWorld(db, PLZEN, false, NOW);
    const day = dayKey(NOW, "Europe/Prague"),
      cell = latLngToCell(PLZEN.lat, PLZEN.lng, 7);
    const leaf = readCell(db, day, cell);
    assert.ok(
      leaf && leaf.pioneer,
      "nobody visited for 30 days: a pioneer cell",
    );
    const proof = cellProof(db, day, cell);
    assert.ok(verifyProof(proof.leaf, proof.proof, proof.root));
    const drop = db
      .prepare("SELECT * FROM map_cell_drops WHERE world_id=? AND cell=?")
      .get(w.id, cell);
    assert.equal(drop.pioneer, 1);
    assert.ok(drop.pioneer_u > 0, "pioneer coins count twice on the first drop");
    assert.ok(
      w.zones.some((z) => z.source === "pioneer"),
      "a pioneer chest",
    );
    // Backed by the day's chain budget: the game treasury is not touched and
    // the first (pioneer) drop pays two shares per coin.
    const plan = ensureDayPlan(db, NOW);
    const mapCoins = db
      .prepare(
        "SELECT c.value_u v FROM coins c JOIN map_coin_meta m ON m.coin_id=c.id WHERE c.world_id=? AND m.cell=?",
      )
      .all(w.id, cell);
    assert.ok(mapCoins.length > 0);
    assert.ok(mapCoins.every((c) => c.v === 2 * plan.summary.coinValueU));
    assert.equal(
      db.prepare("SELECT reserved_u FROM treasury WHERE bucket='coins'").get()
        .reserved_u,
      0,
    );
    // At 13:00 some waves are still closed.
    const early = worldView(db, w.id, player, { now: NOW });
    const late = worldView(db, w.id, player, { now: w.endsAt - 60_000 });
    assert.ok(
      early.mapRewards.hiddenCoins > 0 && early.mapRewards.nextWaveAt > NOW,
    );
    assert.ok(late.coins.length > early.coins.length);
    const hidden = late.coins.find(
      (c) => !early.coins.some((e) => e.id === c.id),
    );
    assert.throws(
      () =>
        claimCoin(
          db,
          player,
          hidden.id,
          { ...hidden, accuracy: 5, timestamp: NOW },
          NOW,
        ),
      /later wave/,
    );
    // The next pioneer visit that day is an ordinary one.
    const view = mapRewardsView(db, {
      bounds: [13.2, 49.6, 13.5, 49.85],
      now: NOW,
    });
    const mine = view.cells.find((c) => c.cell === cell);
    assert.equal(mine.opened, true);
    assert.equal(mine.pioneer, false, "visited today: no more gold fog");
    assert.ok(
      view.cells.some((c) => c.pioneer),
      "the rest of the area is still unexplored",
    );
    const coarse = mapRewardsView(db, {
      bounds: [12, 48.5, 19, 51.1],
      res: 5,
      now: NOW,
    });
    assert.ok(
      coarse.cells.length > 100 && coarse.cells.every((c) => c.cells >= 1),
    );
    assert.equal(ensureDayPlan(db, NOW).root, view.root);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});
