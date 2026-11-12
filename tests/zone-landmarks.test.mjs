import test from "node:test";
import assert from "node:assert/strict";
import {
  zoneCountdown,
  zoneLoot,
  zoneRarity,
  zoneTotemFeatures,
  zoneWallFeatures,
  zoneLandmarkLabel,
  zoneSchedule,
  nextLocalMidnight,
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
  assert.equal(zoneCountdown(z, [], now + 3 * H).text, "Closed · new zones tomorrow");
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

test("walls keep boundary paths open, dim upcoming ones, stay low and dim when spent", () => {
  const open = zoneWallFeatures([zone()], [], now);
  const upcoming = zoneWallFeatures([zone({ opensAt: now + H })], [], now);
  const closed = zoneWallFeatures([zone({ closesAt: now - 1 })], [], now);
  assert.equal(open.length, 1);
  assert.equal(open[0].geometry.type, "LineString", "no filled roof polygon");
  assert.equal(open[0].geometry.coordinates.length, 49, "keeps the published circle boundary");
  assert.equal(upcoming[0].properties.dim, true);
  assert.ok(upcoming[0].properties.height < open[0].properties.height);
  assert.equal(closed.length, 1, "closed zones stay visible");
  assert.equal(closed[0].properties.dim, true);
  assert.ok(closed[0].properties.height < upcoming[0].properties.height);
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

test("a zone label names its finds before it opens", () => {
  const z = zone({ tier: 2, opensAt: now + H });
  assert.match(zoneLandmarkLabel(z, [quest({ tier: 2 })], now), /opens at .* find: /);
});

test("sky beams rise over open zones and dimly over rare zones opening later", async () => {
  const { zoneBeamSpots, beamFeatures, BEAM_HEIGHT } = await import("../src/zone-landmarks.ts");
  const open = zone(),
    later = zone({ id: "w:zone:2", tier: 3, opensAt: now + 2 * H }),
    plainLater = zone({ id: "w:zone:3", tier: 1, opensAt: now + 2 * H });
  const qs = [quest(), quest({ id: "w:quest:2", zone_id: "w:zone:2", opens_at: now + 2 * H }), quest({ id: "w:quest:3", zone_id: "w:zone:3", opens_at: now + 2 * H })];
  const spots = zoneBeamSpots([open, later, plainLater], qs, now);
  assert.deepEqual(spots.map((s) => [s.id, s.kind, !!s.dim]), [["w:zone:1", "zone", false], ["w:zone:2", "event", true]]);
  const f = beamFeatures(spots);
  assert.equal(f.length, 4, "a core and a halo per beam");
  assert.equal(Math.max(...f.map((x) => x.properties.height)), BEAM_HEIGHT.zone);
  assert.ok(f.every((x) => x.properties.base < x.properties.height));
});

test("zone walls carry a taller halo band above them", () => {
  const [w] = zoneWallFeatures([zone()], [quest()], now);
  assert.ok(w.properties.height >= 30);
  assert.ok(w.properties.halo > w.properties.height);
});

test("zone rewards reset at the next local midnight, also across DST", () => {
  // 3 Nov 2026 10:00 UTC = 11:00 in Prague (CET, UTC+1).
  assert.equal(nextLocalMidnight(now, "Europe/Prague"), Date.UTC(2026, 10, 3, 23));
  // 24 Oct 2026 12:00 UTC: the night of the switch back to CET.
  assert.equal(nextLocalMidnight(Date.UTC(2026, 9, 24, 12), "Europe/Prague"), Date.UTC(2026, 9, 24, 22));
  assert.equal(nextLocalMidnight(Date.UTC(2026, 9, 25, 12), "Europe/Prague"), Date.UTC(2026, 9, 25, 23));
  // An unknown zone name falls back to Prague instead of throwing.
  assert.equal(nextLocalMidnight(now, "Nowhere/City"), Date.UTC(2026, 10, 3, 23));
});

test("zone schedule counts progress, what is left and the reset", () => {
  const quests = [
    quest(),
    quest({ id: "w:quest:2", kind: "visit", xp: 50, gold_u: 0 }),
    quest({ id: "w:quest:3", kind: "visit", xp: 30, gold_u: 0, completed: 1 }),
  ];
  const s = zoneSchedule(zone(), quests, now, "Europe/Prague");
  assert.equal(s.phase, "open");
  assert.equal(s.done, 1);
  assert.equal(s.total, 3);
  assert.equal(s.xp, 60);
  assert.equal(s.gold_u, 500);
  assert.ok(s.loot.length > 0 && s.loot.every((l) => l.kind === "aura"));
  assert.equal(s.resetAt, Date.UTC(2026, 10, 3, 23));
});
