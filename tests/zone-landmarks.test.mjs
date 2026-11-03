import test from "node:test";
import assert from "node:assert/strict";
import {
  zoneCountdown,
  zoneLoot,
  zoneLootFeatures,
  zoneRarity,
  zoneTotemFeatures,
  zoneWallFeatures,
  zoneLandmarkLabel,
} from "../src/zone-landmarks.ts";

const H = 3600000,
  now = Date.UTC(2026, 10, 3, 10);
const zone = (over = {}) => ({
  id: "w:zone:1",
  name: "Square",
  tier: 1,
  lat: 49.19,
  lng: 16.61,
  radius: 60,
  kind: "cache",
  opensAt: now - 2 * H,
  closesAt: now + 14 * H,
  color: "#258b73",
  ...over,
});
const quest = (over = {}) => ({
  id: "w:quest:1",
  zone_id: "w:zone:1",
  title: "Chest",
  description: "",
  tier: 1,
  gold_u: 500,
  xp: 10,
  kind: "chest",
  completed: 0,
  itemAvailable: true,
  lat: 49.19,
  lng: 16.61,
  opens_at: now - 2 * H,
  closes_at: now + 14 * H,
  claimant: null,
  ...over,
});

test("rarer zones map to rarer chest editions", () => {
  assert.equal(zoneRarity(1), "rare");
  assert.equal(zoneRarity(2), "epic");
  assert.equal(zoneRarity(3), "legendary");
});

test("countdown shows when a zone opens even if the player cannot play it", () => {
  const z = zone({ tier: 3, opensAt: now + 90 * 60000, closesAt: now + 150 * 60000 });
  const c = zoneCountdown(z, [], now);
  assert.equal(c.phase, "upcoming");
  assert.equal(c.text, "Opens in 1:30:00");
  assert.match(c.window, /Legendary · open 1 h/);
  const open = zoneCountdown(z, [], now + 2 * H);
  assert.equal(open.text, "Closes in 30:00");
  assert.equal(zoneCountdown(z, [], now + 3 * H).text, "Closed");
});

test("all-day zones say open now until their last hours", () => {
  const z = zone({ opensAt: now - 2 * H, closesAt: now + 22 * H });
  assert.equal(zoneCountdown(z, [], now).text, "Open now");
  assert.match(zoneCountdown(z, [], now + 20 * H).text, /^Closes in 2:00:00$/);
  assert.equal(zoneCountdown(z, [quest({ completed: 1 })], now).text, "Cleared");
});

test("loot lists only what loaded data backs, rarest first", () => {
  const loot = zoneLoot(zone({ tier: 3 }), [quest({ tier: 3 })]);
  assert.equal(loot.length, 3);
  assert.equal(loot[0].rarity, "legendary");
  assert.equal(loot.at(-1).kind, "gold");
  assert.deepEqual(zoneLoot(zone(), []), []);
  assert.deepEqual(
    zoneLoot(zone(), [quest({ itemAvailable: false })]).map((l) => l.kind),
    ["gold"],
  );
  // A tier 1 chest never shows an epic or legendary Aura.
  assert.ok(
    zoneLoot(zone(), [quest()]).every((l) => !["epic", "legendary"].includes(l.rarity)),
  );
});

test("walls rise for open zones, stay low for upcoming ones, vanish when spent", () => {
  const open = zoneWallFeatures([zone()], [], now);
  const upcoming = zoneWallFeatures([zone({ opensAt: now + H })], [], now);
  const closed = zoneWallFeatures([zone({ closesAt: now - 1 })], [], now);
  assert.equal(open.length, 1);
  assert.equal(open[0].geometry.coordinates.length, 2, "wall is a ring band");
  assert.ok(upcoming[0].properties.height < open[0].properties.height);
  assert.equal(closed.length, 0);
});

test("every zone gets a totem; taller for rarer tiers; crown names the type", () => {
  const ctx = { now };
  const top = (z, q) =>
    Math.max(...zoneTotemFeatures([z], q, ctx).map((f) => f.properties.height));
  assert.ok(top(zone({ tier: 3 }), []) > top(zone({ tier: 1 }), []));
  const chest = zoneTotemFeatures([zone()], [quest()], ctx);
  const route = zoneTotemFeatures([zone()], [quest({ kind: "route" })], ctx);
  const sides = (fs) => fs.map((f) => f.geometry.coordinates[0].length).join();
  assert.notEqual(sides(chest), sides(route));
  for (const f of chest) assert.ok(f.properties.base < f.properties.height);
});

test("loot points sit inside the zone and dim before it opens", () => {
  const z = zone({ tier: 2, opensAt: now + H });
  const pts = zoneLootFeatures([z], [quest({ tier: 2 })], now);
  assert.ok(pts.length >= 2);
  for (const p of pts) {
    const [lng, lat] = p.geometry.coordinates;
    const d = Math.hypot((lng - z.lng) * Math.cos((z.lat * Math.PI) / 180), lat - z.lat) * 111320;
    assert.ok(d < z.radius, `item ${d.toFixed(1)} m from centre`);
    assert.equal(p.properties.dim, true);
  }
  assert.match(zoneLandmarkLabel(z, [quest({ tier: 2 })], now), /opens at .* find: /);
});
