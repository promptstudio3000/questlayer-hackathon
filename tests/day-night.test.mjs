// Day and night from the real sun (server/sun.mjs, src/sun.ts): sunrise and
// sunset, the day/night actor casts, and the map palette.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as server from "../server/sun.mjs";
import * as client from "../src/sun.ts";
import { MAP_PALETTES, skyFor, skyLabel } from "../src/map-sky.ts";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { localDateStart } from "../server/spatial/calendar.mjs";
import { activeWindows, planDay } from "../server/actors/schedule.mjs";
import { loadCityActors, loadGenericActors, validateActorDefinition } from "../server/actors/definitions.mjs";
import { createActorService } from "../server/actors/service.mjs";

const H = 3600_000, M = 60_000;
const PLZ = { lat: 49.7475, lng: 13.3776 };
const DAY = "2026-11-03", dayStart = localDateStart(DAY, "Europe/Prague");

test("sunrise and sunset match published times within two minutes", () => {
  const cases = [
    // place, UTC noon, sunrise and sunset (UTC) from NOAA's calculator
    [PLZ, "2026-11-03T12:00:00Z", "2026-11-03T05:58Z", "2026-11-03T15:41Z"],
    [PLZ, "2026-06-21T12:00:00Z", "2026-06-21T02:58Z", "2026-06-21T19:18Z"],
    [{ lat: 40.7128, lng: -74.006 }, "2026-11-03T17:00:00Z", "2026-11-03T11:28Z", "2026-11-03T21:49Z"],
    [{ lat: -33.8688, lng: 151.2093 }, "2026-11-03T02:00:00Z", "2026-11-02T18:53Z", "2026-11-03T08:25Z"],
  ];
  for (const [p, at, rise, set] of cases) {
    const s = server.sunTimes(Date.parse(at), p.lat, p.lng);
    assert.ok(Math.abs(s.sunrise - Date.parse(rise)) < 2 * M, `${at} sunrise ${new Date(s.sunrise).toISOString()}`);
    assert.ok(Math.abs(s.sunset - Date.parse(set)) < 2 * M, `${at} sunset ${new Date(s.sunset).toISOString()}`);
  }
  assert.equal(server.sunTimes(Date.parse("2026-06-21T12:00:00Z"), 78.2, 15.6).polar, "day");
  assert.equal(server.sunTimes(Date.parse("2026-12-21T12:00:00Z"), 78.2, 15.6).polar, "night");
});

test("phases follow the sun and the browser copy agrees with the server", () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(server.skyPhase(at("2026-11-03T11:00:00Z"), PLZ.lat, PLZ.lng), "day");
  assert.equal(server.skyPhase(at("2026-11-03T15:55:00Z"), PLZ.lat, PLZ.lng), "dusk");
  assert.equal(server.skyPhase(at("2026-11-03T05:45:00Z"), PLZ.lat, PLZ.lng), "dawn");
  assert.equal(server.skyPhase(at("2026-11-03T00:57:00Z"), PLZ.lat, PLZ.lng), "night");
  for (const [lat, lng] of [[49.75, 13.38], [40.7, -74], [-33.9, 151.2], [64.1, -21.9], [78.2, 15.6]])
    for (let t = at("2026-01-01T00:00:00Z"); t < at("2027-01-01T00:00:00Z"); t += 7.3 * 86_400_000) {
      assert.deepEqual(client.sunTimes(t, lat, lng), server.sunTimes(t, lat, lng));
      assert.equal(client.skyPhase(t, lat, lng), server.skyPhase(t, lat, lng));
    }
});

test("day and night spans split the opening hours at sunrise and sunset", () => {
  const open = dayStart + 7 * H, close = dayStart + 22 * H;
  const day = server.daylightSpans(open, close, PLZ.lat, PLZ.lng),
    night = server.nightSpans(open, close, PLZ.lat, PLZ.lng);
  const total = [...day, ...night].reduce((n, [a, b]) => n + b - a, 0);
  assert.equal(total, close - open);
  const { sunset } = server.sunTimes(dayStart + 12 * H, PLZ.lat, PLZ.lng);
  assert.equal(day.at(-1)[1], sunset);
  assert.deepEqual(night.at(-1), [sunset, close]);
});

test("night actors walk only after sunset, day actors only before it", () => {
  const sky = PLZEN.center, hours = ["07:00", "22:00"];
  const { sunrise, sunset } = server.sunTimes(dayStart + 12 * H, sky.lat, sky.lng);
  const base = { kind: "monster", archetype: "roamer", name: "X", model: "glitch-moth", rangeM: 600, speedMps: 1.2, dwellMin: [3, 8], enabled: true };
  const night = validateActorDefinition({ ...base, id: "night-x", phase: "night" });
  const day = validateActorDefinition({ ...base, id: "day-x", phase: "day" });
  const home = { lat: 49.7474, lng: 13.3774 };
  const n = planDay(night, PLZEN, "seed", DAY, { dayStart, hours, home, sky });
  const d = planDay(day, PLZEN, "seed", DAY, { dayStart, hours, home, sky });
  assert.ok(n.length && d.length);
  assert.ok(n.every((s) => s.from >= sunset - 1 || s.to <= sunrise + 1), "night actor out by day");
  assert.ok(d.every((s) => s.from >= Math.max(sunrise, dayStart + 7 * H) && s.to <= sunset), "day actor out at night");
  // Practice worlds (allDay) and plans without a place keep every actor.
  assert.equal(planDay(night, PLZEN, "seed", DAY, { dayStart, hours, home, sky, allDay: true })[0].from, dayStart);
  assert.equal(planDay(night, PLZEN, "seed", DAY, { dayStart, hours, home })[0].from, dayStart + 7 * H);
  // Short appearances (wandering rare) stay inside the night spans.
  const rare = validateActorDefinition({ ...base, id: "rare-x", kind: "npc", archetype: "wandering_rare", windows: 3, phase: "night" });
  const w = activeWindows(rare, { dayStart, hours, rng: () => 0.5, sky });
  assert.equal(w.length, 3);
  for (const [a, b] of w) assert.ok(a >= sunset && b <= dayStart + 22 * H && b - a === 20 * M);
  assert.throws(() => validateActorDefinition({ ...base, id: "bad-x", phase: "dusk" }), /phase/);
});

test("the generic cast and Plzeň have a day and a night cast", () => {
  for (const cast of [loadGenericActors(), loadCityActors("plzen")]) {
    const phases = new Set(cast.actors.map((a) => a.phase || "any"));
    assert.ok(phases.has("day") && phases.has("night"), cast.cityId);
    assert.ok(cast.actors.some((a) => a.phase === "night" && a.kind === "monster"), `${cast.cityId} night monster`);
    assert.ok(cast.actors.some((a) => a.phase === "day" && a.kind === "monster"), `${cast.cityId} day monster`);
  }
});

test("the actor list shows the night cast at night and reports the sky", async () => {
  const db = new DatabaseSync(":memory:");
  let now = 0;
  const service = createActorService(db, { clock: () => now });
  db.exec("CREATE TABLE IF NOT EXISTS worlds(id TEXT PRIMARY KEY, day TEXT, region TEXT, timezone TEXT, manifest TEXT, created_at INTEGER)");
  const manifest = { id: `city-plzen:${DAY}:v2`, day: DAY, region: "city-plzen", cityId: "plzen", timezone: "Europe/Prague", arena: false, endsAt: dayStart + 24 * H, zones: [] };
  db.prepare("INSERT INTO worlds VALUES(?,?,?,?,?,?)").run(manifest.id, DAY, manifest.region, "Europe/Prague", JSON.stringify(manifest), 0);
  const names = async (t) => {
    now = t;
    const list = await service.list({ player: "p", worldId: manifest.id, location: null });
    return { list, ids: list.actors.map((a) => a.id) };
  };
  const noon = await names(dayStart + 12 * H), evening = await names(dayStart + 19 * H);
  assert.equal(noon.list.sky.phase, "day");
  assert.equal(evening.list.sky.phase, "night");
  assert.ok(noon.ids.includes("lickquidator-1") && !noon.ids.some((id) => id.startsWith("dire-tire")), noon.ids.join());
  assert.ok(evening.ids.some((id) => id.startsWith("dire-tire")) && !evening.ids.includes("lickquidator-1"), evening.ids.join());
  assert.ok(evening.ids.includes("kronikarka-bela"), "NPCs stay around the clock, whatever their phase");
  assert.ok(evening.ids.includes("kupec-vojtech"), "any-phase actors stay");
  assert.equal(evening.list.actors.find((a) => a.id.startsWith("dire-tire")).phase, "night");
});

test("the map palette and chip follow the player's sky", () => {
  for (const p of Object.values(MAP_PALETTES)) for (const v of Object.values(p)) if (typeof v === "string") assert.match(v, /^#[0-9a-f]{6}$/);
  assert.equal(skyFor(null).phase, "day");
  const night = skyFor(PLZ, Date.parse("2026-11-03T00:57:00Z"));
  assert.equal(night.phase, "night");
  assert.match(skyLabel(night, Date.parse("2026-11-03T00:57:00Z")).long, /until sunrise/);
  const day = skyFor(PLZ, Date.parse("2026-11-03T11:00:00Z"));
  assert.match(skyLabel(day, Date.parse("2026-11-03T11:00:00Z")).short, /^Sunset /);
  assert.equal(skyLabel({ phase: "day", polar: "day" }).short, "Midnight sun");
});
