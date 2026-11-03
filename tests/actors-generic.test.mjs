// Generic NPCs and monsters for any city or street cell (docs/WORLDS-PLAN.md
// C.6 W7): reviewed city files win, other cities and active cells get the
// generic cast with homes at safe POIs and per-cell density caps.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { latLngToCell } from "h3-js";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { localDateStart } from "../server/spatial/calendar.mjs";
import {
  DENSITY_CAP_PER_CELL,
  loadCityActors,
  loadGenericActors,
  validateActorFile,
} from "../server/actors/definitions.mjs";
import { planSpawns } from "../server/actors/spawns.mjs";
import { actorsAllDay, createActorService, worldSeed } from "../server/actors/service.mjs";
import { personaFor } from "../server/npc/personas.mjs";

const DAY = "2026-11-02",
  dayStart = localDateStart(DAY, "Europe/Prague"),
  noon = dayStart + 12 * 3600_000,
  generic = loadGenericActors();

function addWorld(db, manifest) {
  db.exec("CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, day TEXT, region TEXT, timezone TEXT, manifest TEXT, created_at INTEGER)");
  db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(manifest.id, DAY, manifest.region, "Europe/Prague", JSON.stringify(manifest), 0);
  return manifest;
}

// A street cell in central Plzeň, with the cell's public paths cached the way
// map-data.mjs stores an Overpass snapshot.
const CELL = latLngToCell(49.7474, 13.3774, 7);
function cellWorld(db, { cached = true } = {}) {
  db.exec("CREATE TABLE IF NOT EXISTS geo_cache(region TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  if (cached) {
    const paths = PLZEN.paths
      .filter((p) => p.points.some(([lng, lat]) => latLngToCell(lat, lng, 7) === CELL))
      .slice(0, 150)
      .map((p) => p.points);
    db.prepare("INSERT INTO geo_cache VALUES(?,?,?)").run(CELL, JSON.stringify({ version: 1, paths, observedAt: 1, freshUntil: 2, retryAt: 2, attempts: 0 }), 2);
  }
  return addWorld(db, { id: `demo:${CELL}:${DAY}:v2`, day: DAY, region: CELL, cityId: null, timezone: "Europe/Prague", arena: false, endsAt: dayStart + 86_400_000, zones: [] });
}

test("the generic cast validates, stays inside the cell caps and has persona cards", () => {
  const per = {};
  for (const a of generic.actors) per[a.archetype] = (per[a.archetype] || 0) + (a.count || 1);
  for (const [k, n] of Object.entries(per)) assert.ok(n <= DENSITY_CAP_PER_CELL[k], k);
  assert.equal(per.quest_giver, 1);
  assert.equal(per.roamer, 1);
  assert.equal(per.wandering_rare, 1);
  for (const a of generic.actors.filter((a) => a.kind === "npc"))
    assert.equal(personaFor(a).id, a.persona, `${a.id} has a reviewed card`);
  const file = (actors) => ({ version: 1, cityId: "_generic", hours: ["08:00", "20:00"], actors });
  const npc = { id: "x-trader", kind: "npc", archetype: "trader", name: "T", model: "merchant", homeFrom: "poi", rangeM: 100, speedMps: 1, dwellMin: [1, 2], enabled: true };
  assert.throws(() => validateActorFile(file([npc]), "_generic"), /reviewed city file/);
  const moth = { id: "moth", kind: "monster", archetype: "roamer", name: "M", model: "glitch-moth", rangeM: 100, speedMps: 1, dwellMin: [1, 2], count: 2, enabled: true };
  assert.throws(() => validateActorFile(file([moth]), "_generic"), /too many roamer/);
  assert.throws(() => validateActorFile({ ...file([{ ...npc, archetype: "quest_giver" }]), cityId: "plzen" }, "plzen"), /generic cast/);
});

test("Plzeň keeps its reviewed cast and the same spawns for a fixed day", () => {
  const db = new DatabaseSync(":memory:");
  const service = createActorService(db, { clock: () => noon });
  const manifest = addWorld(db, { id: `demo:arena-city-plzen:${DAY}:v2`, day: DAY, region: "city-plzen", cityId: "plzen", timezone: "Europe/Prague", arena: true, endsAt: dayStart + 86_400_000, zones: [] });
  const plan = service.planFor(manifest);
  const direct = planSpawns(loadCityActors("plzen"), PLZEN, worldSeed(manifest), DAY, { zones: [] });
  assert.deepEqual(plan.instances.map((i) => [i.id, i.home]), direct.map((s) => [s.id, s.home]));
  assert.ok(plan.byId.has("kupec-vojtech"));
  assert.ok(!plan.instances.some((i) => i.def.homeFrom));
});

test("a city without a reviewed file gets one quest giver at a safe POI", () => {
  const db = new DatabaseSync(":memory:");
  const service = createActorService(db, { clock: () => noon, cityById: () => PLZEN, loadCityActors: () => null });
  const manifest = addWorld(db, { id: `demo:city-auto:${DAY}:v2`, day: DAY, region: "city-auto", cityId: "auto", timezone: "Europe/Prague", arena: false, endsAt: dayStart + 86_400_000, zones: [] });
  const plan = service.planFor(manifest);
  const givers = plan.instances.filter((i) => i.def.archetype === "quest_giver");
  assert.equal(givers.length, 1);
  assert.match(givers[0].poi.id, /^park:/, "home resolved from a reviewed park");
  assert.ok(givers[0].segments.length > 0);
  assert.ok(!plan.instances.some((i) => ["trader", "keeper", "guardian", "boss"].includes(i.def.archetype)));
  assert.deepEqual(service.planFor(manifest), plan);
});

test("an active street cell gets at most one roamer and one wandering rare", async () => {
  const db = new DatabaseSync(":memory:");
  const service = createActorService(db, { clock: () => noon });
  const manifest = cellWorld(db);
  const plan = service.planFor(manifest);
  assert.ok(plan, "cell plan exists");
  const count = (a) => plan.instances.filter((i) => i.def.archetype === a).length;
  assert.ok(count("roamer") <= 1 && count("roamer") >= 1);
  assert.ok(count("wandering_rare") <= 1);
  assert.equal(count("quest_giver"), 1);
  for (const [a, cap] of Object.entries(DENSITY_CAP_PER_CELL)) assert.ok(count(a) <= cap, a);
  // Ids are per cell, and stay valid route ids.
  for (const i of plan.instances) assert.match(i.id, /^[a-z0-9-]{3,40}$/);
  assert.ok(plan.instances.every((i) => /-[0-9a-f]{6}$/.test(i.id)));
  // Deterministic: a fresh service plans the same day the same way.
  const again = createActorService(db, { clock: () => noon }).planFor(manifest);
  assert.deepEqual(again.instances.map((i) => [i.id, i.home]), plan.instances.map((i) => [i.id, i.home]));
  const list = await service.list({ player: "p1", worldId: manifest.id, location: { lat: 49.7474, lng: 13.3774 } });
  assert.ok(list.actors.some((a) => a.archetype === "quest_giver"));
  assert.ok(list.actors.some((a) => a.archetype === "roamer"));
});

test("a cell without a cached path snapshot has no actors and makes no map request", async () => {
  const db = new DatabaseSync(":memory:");
  const service = createActorService(db, { clock: () => noon });
  const manifest = cellWorld(db, { cached: false });
  assert.equal(service.planFor(manifest), null);
  const list = await service.list({ player: "p1", worldId: manifest.id });
  assert.deepEqual(list.actors, []);
});

test("the test-only all-day switch keeps a street cast out at night; production keeps opening hours", () => {
  const night = dayStart + 2 * 3600_000; // 02:00 Prague
  const live = (options) => {
    const db = new DatabaseSync(":memory:");
    const service = createActorService(db, { clock: () => night, ...options });
    const plan = service.planFor(cellWorld(db));
    return plan.instances.filter((i) => i.segments.some((s) => s.from <= night && s.to > night));
  };
  assert.equal(live({}).length, 0, "generic hours 08:00-20:00 by default");
  assert.ok(live({ allDay: true }).length > 0, "all-day plan has actors out at 02:00");
  assert.equal(actorsAllDay({ ACTORS_ALL_DAY: "1" }, "testnet"), true);
  assert.equal(actorsAllDay({ ACTORS_ALL_DAY: "1" }, "mainnet"), false, "never on mainnet");
  assert.equal(actorsAllDay({}, "testnet"), false);
});
