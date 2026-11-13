import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { ensureWorld, coinCounts, COIN_COUNT_RADIUS_M } from "../server/world.mjs";

test("coin counts: unclaimed coins within 10 km and in every open world", async () => {
  const db = openDatabase(":memory:");
  const home = { lat: 49.74745, lng: 13.3774 };
  const now = Date.now();
  const w = await ensureWorld(db, home, true, now);
  const all = db.prepare("SELECT COUNT(*) n FROM coins WHERE world_id=? AND claimant IS NULL").get(w.id).n;
  const counts = coinCounts(db, w.id, home, now);
  assert.equal(counts.radiusM, COIN_COUNT_RADIUS_M);
  assert.ok(counts.near > 0 && counts.near <= all, `near ${counts.near} of ${all}`);
  assert.ok(counts.global >= counts.near);
  // Far away from the world: nothing within 10 km.
  assert.equal(coinCounts(db, w.id, { lat: 50.5, lng: 15.5 }, now).near, 0);
  // No position: only the global count.
  assert.equal(coinCounts(db, w.id, null, now).near, null);
});
