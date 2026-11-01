import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { distance } from "../server/domain.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import {
  pickStreetFinds,
  STREET_FIND_SPACING_M,
  STREET_FIND_XP,
  STREET_COIN_XP,
} from "../server/street-finds.mjs";
import { nearestDiscovery } from "../src/nearest-discovery.ts";

const now = Date.parse("2026-11-02T12:00:00Z");

test("street finds are spaced along a dense line of coin seeds", () => {
  const coins = Array.from({ length: 100 }, (_, i) => ({
    id: `w:coin:${i}`,
    lat: 49.74 + i * 0.0002, // ~22 m apart
    lng: 13.37,
  }));
  const ids = pickStreetFinds(coins);
  const picked = coins.filter((c) => ids.has(c.id));
  assert.ok(picked.length >= 8);
  for (let i = 1; i < picked.length; i++) {
    const gap = distance(picked[i - 1], picked[i]);
    assert.ok(gap >= STREET_FIND_SPACING_M && gap <= 250, `gap ${gap}`);
  }
  // Deterministic regardless of input order.
  assert.deepEqual([...pickStreetFinds([...coins].reverse())].sort(), [...ids].sort());
});

test("world exposes street finds and claiming one pays extra XP once", async () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const w = await ensureWorld(db, HOME, true, now);
  const view = worldView(db, w.id);
  const find = view.coins.find((c) => c.find);
  const plain = view.coins.find((c) => !c.find);
  assert.ok(find, "a street find exists");
  assert.equal(view.streetFindXp, STREET_FIND_XP);
  const xp0 = db.prepare("SELECT xp FROM players WHERE id=?").get(a).xp;
  const r = claimCoin(db, a, find.id, find, now);
  assert.equal(r.xp, STREET_FIND_XP);
  assert.equal(r.find, true);
  assert.equal(claimCoin(db, a, find.id, find, now).alreadyClaimed, true);
  if (plain) assert.equal(claimCoin(db, a, plain.id, plain, now).xp, STREET_COIN_XP);
  const xp1 = db.prepare("SELECT xp FROM players WHERE id=?").get(a).xp;
  assert.equal(xp1 - xp0, STREET_FIND_XP + (plain ? STREET_COIN_XP : 0));
  // A newcomer at the world centre has a reward within 300 m.
  const fresh = worldView(db, w.id);
  const pick = nearestDiscovery({
    position: HOME,
    quests: fresh.quests,
    zones: fresh.zones,
    coins: fresh.coins,
    tier: 1,
    now,
  });
  assert.ok(pick && pick.distance <= 300, `nearest ${pick?.distance}`);
  db.close();
});

test("nearest discovery picks the closest eligible item, not the first chest", () => {
  const p = { lat: 49.74, lng: 13.37 };
  const zone = { id: "z", closesAt: now + 1e6, placeStatus: "open" };
  const quest = (id, dLat, extra = {}) => ({
    id,
    zone_id: "z",
    lat: p.lat + dLat,
    lng: p.lng,
    tier: 1,
    completed: 0,
    opens_at: now - 1,
    closes_at: now + 1e6,
    kind: "visit",
    ...extra,
  });
  const chest = quest("chest", 0.01, { kind: "chest", itemAvailable: true });
  const near = quest("near", 0.002);
  const locked = quest("locked", 0.0001, { tier: 3 });
  const done = quest("done", 0.0001, { completed: 1 });
  const base = { position: p, zones: [zone], tier: 1, now };
  assert.equal(
    nearestDiscovery({ ...base, quests: [chest, near, locked, done], coins: [] })
      .quest.id,
    "near",
  );
  const find = { id: "w:coin:1", lat: p.lat + 0.001, lng: p.lng, find: true, claimant: null };
  const coin = { id: "w:coin:2", lat: p.lat + 0.0001, lng: p.lng, claimant: null };
  const r = nearestDiscovery({ ...base, quests: [chest, near], coins: [coin, find] });
  assert.equal(r.kind, "find");
  assert.equal(r.coin.id, "w:coin:1");
  assert.equal(
    nearestDiscovery({ ...base, quests: [], coins: [coin] }),
    null,
  );
});
