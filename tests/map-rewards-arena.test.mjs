import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { distance } from "../server/domain.mjs";
import { setPotentialSource } from "../server/map-rewards/day-plan.mjs";
import { ARENA_REFILL_MS } from "../server/map-rewards/policy.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z"); // 13:00 in Prague
const PLZEN = { lat: 49.7477, lng: 13.3776 };

// 14 Nov 2026: a new Test Layer explorer found the nearest coin 450 m away,
// because the demo spread its 50 coins over the whole ~5 km² cell.
test("the city demo gathers its coins round the start and refills picked-up ones", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Demo walker", NOW);
    const arena = await ensureWorld(db, PLZEN, true, NOW);
    const start = arena.demoZones?.center || arena.center;
    const coins = worldView(db, arena.id, player, { now: NOW }).coins;
    assert.ok(coins.length >= 20, `enough coins (${coins.length})`);
    const away = coins.map((c) => distance(start, c));
    assert.ok(
      away.filter((d) => d <= 400).length >= coins.length * 0.8,
      "most coins lie within 400 m of the start",
    );
    assert.ok(Math.max(...away) < 700, "none far across the cell");
    const nearest = Math.min(...coins.map((c) => distance(start, c)));
    assert.ok(nearest < 150, `a coin close to the start (${Math.round(nearest)} m)`);

    const coin = coins[0];
    const paid = claimCoin(db, player, coin.id, { lat: coin.lat, lng: coin.lng, accuracy: 5, timestamp: NOW }, NOW);
    assert.ok(paid.value > 0);
    const drop = () =>
      db.prepare("SELECT SUM(coins) n,SUM(coins_u) u FROM map_cell_drops WHERE world_id=?").get(arena.id);
    const before = drop();

    // Not yet: the spot stays empty for ARENA_REFILL_MS.
    const soon = worldView(db, arena.id, player, { now: NOW + 5 * 60_000 }).coins;
    assert.equal(soon.length, coins.length - 1);
    const later = NOW + ARENA_REFILL_MS + 60_000;
    const back = worldView(db, arena.id, player, { now: later }).coins;
    assert.equal(back.length, coins.length);
    const fresh = back.find((c) => !coins.some((o) => o.id === c.id));
    assert.ok(fresh && distance(fresh, coin) < 1, "the new coin sits at the same spot");
    assert.equal(fresh.value_u, coin.value_u);
    assert.equal(
      db.prepare("SELECT claimant FROM coins WHERE id=?").get(coin.id).claimant,
      player,
      "the picked-up row keeps its claimant",
    );
    const after = drop();
    assert.equal(after.n, before.n + 1);
    assert.equal(after.u, before.u + coin.value_u, "the drop counts the refill against the day budget");
    // Checked again later: the same pick-up is refilled once.
    worldView(db, arena.id, player, { now: later + 5 * 60_000 });
    assert.equal(drop().n, before.n + 1);
    // The fresh coin can be picked up like any other.
    const again = claimCoin(db, player, fresh.id, { lat: fresh.lat, lng: fresh.lng, accuracy: 5, timestamp: later }, later);
    assert.ok(again.value > 0 && !again.alreadyClaimed);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});
