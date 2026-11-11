import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { localDateStart } from "../server/spatial/calendar.mjs";
import { distance } from "../server/domain.mjs";
import { loadCityActors } from "../server/actors/definitions.mjs";
import { pathGraph, planDay, positionAt } from "../server/actors/schedule.mjs";
import { planSpawns, GUARDIAN_CHEST_RADIUS_M } from "../server/actors/spawns.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { registerMenuBuilder } from "../server/actors/menu.mjs";

const DAY = "2026-11-02",
  dayStart = localDateStart(DAY, "Europe/Prague"),
  noon = dayStart + 12 * 3600_000,
  city = loadCityActors("plzen");

function onGraph(g, [lng, lat]) {
  return g.nodes.some((i) => g.lng[i] === lng && g.lat[i] === lat);
}

test("Plzeň NPCs walk around the clock (owner decision 11 Nov 2026)", () => {
  assert.deepEqual(city.hours, ["00:00", "23:59"]);
});

// The schedule mechanics below are checked against a shorter opening window.
const SHORT_HOURS = ["07:00", "22:00"];

test("day plans are deterministic, contiguous and stay on mapped paths", () => {
  const g = pathGraph(PLZEN);
  for (const def of city.actors.filter((a) => a.home && a.enabled)) {
    const a = planDay(def, PLZEN, "seed", DAY, { dayStart, hours: SHORT_HOURS });
    const b = planDay(def, PLZEN, "seed", DAY, { dayStart, hours: SHORT_HOURS });
    assert.deepEqual(a, b, def.id);
    assert.ok(a.length >= 1, def.id);
    assert.equal(a[0].from, dayStart + 7 * 3600_000);
    assert.equal(a.at(-1).to, dayStart + 22 * 3600_000);
    for (let i = 1; i < a.length; i++) assert.equal(a[i].from, a[i - 1].to);
    for (const s of a) for (const p of s.path) assert.ok(onGraph(g, p), `${def.id} off path`);
    // Walking speed matches the definition (no teleporting NPC).
    for (const s of a.filter((s) => !s.dwell)) {
      let m = 0;
      for (let i = 1; i < s.path.length; i++)
        m += distance({ lng: s.path[i - 1][0], lat: s.path[i - 1][1] }, { lng: s.path[i][0], lat: s.path[i][1] });
      assert.ok(m / ((s.to - s.from) / 1000) <= def.speedMps + 0.01, def.id);
    }
  }
  const other = planDay(city.actors[1], PLZEN, "seed", "2026-11-03", { dayStart, hours: SHORT_HOURS });
  assert.notDeepEqual(other.map((s) => s.path), planDay(city.actors[1], PLZEN, "seed", DAY, { dayStart, hours: SHORT_HOURS }).map((s) => s.path));
});

test("positions interpolate inside segments and are null outside hours", () => {
  const def = city.actors.find((a) => a.id === "kupec-vojtech");
  const segs = planDay(def, PLZEN, "seed", DAY, { dayStart, hours: SHORT_HOURS });
  assert.equal(positionAt(segs, dayStart + 3600_000), null);
  const walk = segs.find((s) => !s.dwell);
  const start = positionAt(segs, walk.from), mid = positionAt(segs, (walk.from + walk.to) / 2);
  assert.deepEqual([start.lng, start.lat], walk.path[0]);
  assert.equal(mid.dwell, false);
  const practice = planDay(def, PLZEN, "seed", DAY, { dayStart, hours: SHORT_HOURS, allDay: true });
  assert.ok(positionAt(practice, dayStart + 3600_000));
});

test("monster spawns respect spacing, closures and open zones", () => {
  const zones = [
    { id: "z1", slot: 0, lat: 49.74799, lng: 13.3819, sourceId: "a", chest: { questId: "q1", lat: 49.74799, lng: 13.3819 } },
    { id: "z2", slot: 1, lat: 49.74499, lng: 13.37484, sourceId: "b", placeStatus: "closed", chest: { questId: "q2", lat: 49.74499, lng: 13.37484 } },
    { id: "z3", slot: 2, lat: 49.7412, lng: 13.3702, sourceId: "c" },
  ];
  const a = planSpawns(city, PLZEN, "seed", DAY, { zones });
  assert.deepEqual(a, planSpawns(city, PLZEN, "seed", DAY, { zones }));
  const guardians = a.filter((s) => s.def.archetype === "guardian");
  assert.deepEqual(guardians.map((s) => s.guards), [{ zoneId: "z1", questId: "q1" }], "only open zones with a chest get a guardian");
  assert.ok(distance(guardians[0].home, zones[0].chest) <= GUARDIAN_CHEST_RADIUS_M, "the guardian stands on its chest");
  const monsters = a.filter((s) => s.def.kind === "monster");
  for (let i = 0; i < monsters.length; i++)
    for (let j = i + 1; j < monsters.length; j++)
      assert.ok(distance(monsters[i].home, monsters[j].home) >= 150);
  assert.equal(a.filter((s) => s.def.archetype === "roamer").length, 6);
  assert.equal(a.filter((s) => s.def.id === "lick-boss").length, 1, "one weekly boss at its square");
});

function world(db, { arena = true } = {}) {
  const manifest = { id: `demo:test:${DAY}:${arena}`, day: DAY, cityId: "plzen", timezone: "Europe/Prague", arena, endsAt: dayStart + 86_400_000, zones: [] };
  db.exec("CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, day TEXT, region TEXT, timezone TEXT, manifest TEXT, created_at INTEGER)");
  db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(manifest.id, DAY, "city-plzen", "Europe/Prague", JSON.stringify(manifest), 0);
  return manifest;
}

test("encounters need range, a fresh precise fix and plausible speed", async () => {
  const db = new DatabaseSync(":memory:");
  let now = noon;
  const service = createActorService(db, { clock: () => now });
  const gps = world(db, { arena: false });
  const list = await service.list({ player: "p1", worldId: gps.id, location: { lat: 49.7474, lng: 13.3774 } });
  assert.ok(list.actors.some((a) => a.id === "kupec-vojtech"));
  assert.ok(!list.actors.some((a) => a.archetype === "lurker" && a.revealRadiusM === undefined));
  const trader = list.actors.find((a) => a.id === "strazce-brany");
  const at = trader.segments[0].path[0], spot = { lng: at[0], lat: at[1] };
  const fix = (p, extra = {}) => ({ ...p, accuracy: 10, timestamp: now, ...extra });
  await assert.rejects(service.encounter({ player: "p1", actorId: trader.id, worldId: gps.id, location: fix(spot, { accuracy: 80 }) }), (e) => e.code === "GPS_ACCURACY");
  await assert.rejects(service.encounter({ player: "p1", actorId: trader.id, worldId: gps.id, location: fix(spot, { timestamp: now - 60_000 }) }), (e) => e.code === "GPS_STALE");
  await assert.rejects(service.encounter({ player: "p1", actorId: trader.id, worldId: gps.id, location: fix({ lat: spot.lat + 0.001, lng: spot.lng }) }), (e) => e.code === "OUT_OF_RANGE");
  now += 2000;
  // 5 km in 2 seconds: teleport.
  await assert.rejects(service.encounter({ player: "p1", actorId: trader.id, worldId: gps.id, location: fix({ lat: spot.lat + 0.045, lng: spot.lng }) }), (e) => e.code === "IMPLAUSIBLE_MOVE");
  now += 600_000;
  const ok = await service.encounter({ player: "p1", actorId: trader.id, worldId: gps.id, location: fix(spot) });
  assert.match(ok.encounter, /^enc_/);
  assert.equal(ok.actor.id, trader.id);
  const held = service.requireEncounter({ token: ok.encounter, player: "p1", actorId: trader.id });
  assert.equal(held.dayId, DAY);
  assert.equal(held.menuHash.length, 64);
  assert.throws(() => service.requireEncounter({ token: ok.encounter, player: "p2", actorId: trader.id }), (e) => e.code === "ENCOUNTER_REQUIRED");
  now += 5 * 60_000 + 1;
  assert.throws(() => service.requireEncounter({ token: ok.encounter, player: "p1" }), (e) => e.code === "ENCOUNTER_EXPIRED");
});

test("practice worlds skip GPS checks and monsters offer a challenge", async () => {
  const db = new DatabaseSync(":memory:");
  const now = dayStart + 2 * 3600_000; // outside city hours: practice runs all day
  const service = createActorService(db, { clock: () => now });
  const arena = world(db, { arena: true });
  const list = await service.list({ player: "p1", worldId: arena.id });
  const moth = list.actors.find((a) => a.archetype === "roamer");
  assert.ok(moth);
  const pos = positionAt(moth.segments, now);
  const result = await service.encounter({ player: "p1", actorId: moth.id, worldId: arena.id, location: { lat: pos.lat, lng: pos.lng } });
  assert.equal(result.menu[0].kind, "challenge");
  await assert.rejects(service.encounter({ player: "p1", actorId: "nobody-here", worldId: arena.id, location: pos }), (e) => e.code === "ACTOR_NOT_FOUND");
});

// Keep last: it registers a roamer menu override for the rest of this file.
test("a monster with nothing on offer says when to come back", async () => {
  const db = new DatabaseSync(":memory:");
  const now = noon;
  const service = createActorService(db, { clock: () => now });
  const gps = world(db, { arena: false });
  registerMenuBuilder("roamer", ({ actor }) => (actor.state === "defeated" ? [] : [{ id: "c", kind: "challenge", label: "Fight", terms: {}, expiresAt: now + 60_000 }]));
  const list = await service.list({ player: "p1", worldId: gps.id, location: { lat: 49.7474, lng: 13.3774 } });
  const roamer = list.actors.find((a) => a.archetype === "roamer" && positionAt(a.segments, now));
  const pos = positionAt(roamer.segments, now);
  const fix = { lat: pos.lat, lng: pos.lng, accuracy: 5, timestamp: now };
  const open = await service.encounter({ player: "p1", actorId: roamer.id, worldId: gps.id, location: fix });
  assert.equal(open.comeBack, undefined, "a full menu needs no come-back time");
  db.prepare("INSERT INTO actor_progress(player_id,actor_id,day_id,defeats,updated_at) VALUES('p2',?,?,1,?)").run(roamer.id, DAY, now);
  const beaten = await service.encounter({ player: "p2", actorId: roamer.id, worldId: gps.id, location: fix });
  assert.deepEqual(beaten.menu, []);
  assert.equal(beaten.comeBack.reason, "beaten");
  // Tomorrow, inside the city's 07:00-22:00 hours (a day creature waits for sunrise).
  const tomorrow = localDateStart("2026-11-03", "Europe/Prague");
  assert.ok(beaten.comeBack.at >= tomorrow + 7 * 3600_000 && beaten.comeBack.at < tomorrow + 22 * 3600_000, String(beaten.comeBack.at));
});
