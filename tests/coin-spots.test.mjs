import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { setPotentialSource } from "../server/map-rewards/day-plan.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const PLZEN = { lat: 49.7477, lng: 13.3776 };

// 11 Nov 2026: two explorers at one street coin, one in the GPS city world and
// one in the city demo arena. Both worlds drop the same cell with the same day
// seed, so each held its own row at the same spot and both were paid.
test("a street coin in two worlds is picked up once", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const first = createPlayer(db, "First", NOW),
      second = createPlayer(db, "Second", NOW);
    const gps = await ensureWorld(db, PLZEN, false, NOW),
      arena = await ensureWorld(db, PLZEN, true, NOW);
    assert.notEqual(gps.id, arena.id);
    const late = gps.endsAt - 120_000;
    const gpsCoins = worldView(db, gps.id, first, { now: late }).coins,
      arenaCoins = worldView(db, arena.id, second, { now: late }).coins;
    const twin = gpsCoins.find((c) =>
      arenaCoins.some((a) => a.lat === c.lat && a.lng === c.lng),
    );
    assert.ok(twin, "the two worlds hold a coin at the same spot");
    const copy = arenaCoins.find((a) => a.lat === twin.lat && a.lng === twin.lng);
    assert.notEqual(copy.id, twin.id);

    const paid = claimCoin(db, first, twin.id, { lat: twin.lat, lng: twin.lng, accuracy: 5, timestamp: late }, late);
    assert.ok(paid.value > 0 && !paid.alreadyClaimed);

    const goldBefore = db.prepare("SELECT gold_u FROM players WHERE id=?").get(second).gold_u;
    assert.throws(
      () => claimCoin(db, second, copy.id, { lat: copy.lat, lng: copy.lng, accuracy: 0, timestamp: late }, late),
      (e) => e.code === "ALREADY_CLAIMED",
    );
    assert.equal(db.prepare("SELECT gold_u FROM players WHERE id=?").get(second).gold_u, goldBefore);
    // The first explorer's own retry is a no-op, not a second payment.
    assert.equal(
      claimCoin(db, first, copy.id, { lat: copy.lat, lng: copy.lng, accuracy: 0, timestamp: late }, late).alreadyClaimed,
      true,
    );
    // And the copy leaves the other world's map.
    const after = worldView(db, arena.id, second, { now: late }).coins;
    assert.ok(!after.some((a) => a.id === copy.id));
    assert.equal(after.length, arenaCoins.length - 1);
  } finally {
    setPotentialSource(null);
    db.close();
  }
});
