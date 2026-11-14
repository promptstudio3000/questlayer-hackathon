import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { setPotentialSource } from "../server/map-rewards/day-plan.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import * as server from "../server/domain.mjs";
import * as client from "../src/coin-pickup.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const PLZEN = { lat: 49.7477, lng: 13.3776 };
const north = (p, m) => ({ lat: p.lat + m / 111_320, lng: p.lng });

test("client and server use the same GPS coin reach", () => {
  for (const k of ["COIN_GPS_RADIUS_M", "COIN_GPS_SLACK_M", "COIN_GPS_MAX_RADIUS_M", "COIN_GPS_MAX_ACCURACY_M", "COIN_GPS_MAX_AGE_MS"])
    assert.equal(client[k], server[k], k);
  for (const a of [undefined, NaN, -1, 0, 5, 10, 20, 30, 35, 40, 50, 65, 100])
    assert.equal(client.coinPickupRadius(a), server.coinPickupRadius(a), String(a));
  assert.equal(server.coinPickupRadius(5), 35);
  assert.equal(server.coinPickupRadius(25), 50);
  assert.equal(server.coinPickupRadius(50), 60);
  assert.equal(client.clientCoinReach(true, 18, null, NOW), 17);
  assert.equal(client.clientCoinReach(false, 35, { accuracy: 30, timestamp: NOW }, NOW), 54);
  assert.equal(client.clientCoinReach(false, 35, { accuracy: 80, timestamp: NOW }, NOW), null);
  assert.equal(client.clientCoinReach(false, 35, { accuracy: 10, timestamp: NOW - 31_000 }, NOW), null);
});

// 14 Nov 2026: a coin on the edge of the pavement could not be picked up with
// a real phone fix (±30–50 m between houses). The reach now follows accuracy.
test("a poor GPS fix still reaches a coin at the path edge, within the cap", async () => {
  setPotentialSource(() => new Map());
  const db = openDatabase(":memory:");
  try {
    const gps = await ensureWorld(db, PLZEN, false, NOW);
    const at = gps.endsAt - 120_000;
    const [a, b, c] = worldView(db, gps.id, createPlayer(db, "Viewer", NOW), { now: at }).coins;
    const fix = (coin, m, accuracy, age = 0) => ({ ...north(coin, m), accuracy, timestamp: at - age });

    // ±40 m fix, 50 m off: was refused twice (accuracy and range), now paid.
    const one = createPlayer(db, "One", NOW);
    assert.ok(claimCoin(db, one, a.id, fix(a, 50, 40), at).value > 0);

    // A sharp fix keeps the base 35 m reach.
    const two = createPlayer(db, "Two", NOW);
    assert.throws(() => claimCoin(db, two, b.id, fix(b, 45, 5), at), (e) => e.code === "OUT_OF_RANGE");
    // Never beyond the 60 m cap, however poor the fix.
    assert.throws(() => claimCoin(db, two, b.id, fix(b, 64, 60), at), (e) => e.code === "OUT_OF_RANGE");
    // A fix worse than ±65 m is still refused.
    assert.throws(() => claimCoin(db, two, b.id, fix(b, 5, 80), at), (e) => e.code === "GPS_ACCURACY");
    // A 25 s old fix (phone standing still) is fine; 40 s is stale.
    assert.ok(claimCoin(db, two, b.id, fix(b, 10, 10, 25_000), at).value > 0);
    const three = createPlayer(db, "Three", NOW);
    assert.throws(() => claimCoin(db, three, c.id, fix(c, 5, 10, 40_000), at), (e) => e.code === "GPS_STALE");
  } finally {
    db.close();
  }
});
