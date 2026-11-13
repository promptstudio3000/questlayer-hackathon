// "/?newyork": the Test Layer's demo in another city (docs/TEST-LAYER.md).
// Runs in its own process because the server reads AUTO_CITIES_DIR on import.
import test from "node:test";
import assert from "node:assert/strict";
import { SYNTHETIC_ROW, buildSyntheticRelease } from "./fixtures/auto-city-fixture.mjs";
import { demoCityFromSearch, demoCityUrl } from "../src/demo-city.ts";
import { demoCityKey, findDemoCity } from "../server/spatial/demo-city.mjs";

const { dir } = await buildSyntheticRelease({});
process.env.AUTO_CITIES_DIR = dir;
const { openDatabase } = await import("../server/database.mjs");
const { ensureWorld } = await import("../server/world.mjs");
const cityPack = await import("../server/spatial/city-pack.mjs");
const now = Date.parse("2026-11-02T12:00:00Z");

test("the address names a city: a value-less key or city=", () => {
  assert.equal(demoCityFromSearch("?newyork"), "newyork");
  assert.equal(demoCityFromSearch("?NewYork&lang=cs"), "NewYork");
  assert.equal(demoCityFromSearch("?city=Buenos%20Aires"), "Buenos Aires");
  assert.equal(demoCityFromSearch("?plze%C5%88"), "plzeň");
  // Existing flags are never city names.
  assert.equal(demoCityFromSearch("?tester"), "");
  assert.equal(demoCityFromSearch("?world=1"), "");
  assert.equal(demoCityFromSearch("?lang=cs"), "");
  assert.equal(demoCityFromSearch(""), "");
  assert.equal(demoCityFromSearch("?tester&london"), "london");
  assert.equal(
    demoCityUrl("https://questlayer-test.promptstudio3000.com/", "newyork"),
    "https://questlayer-test.promptstudio3000.com/?city=newyork",
  );
});

test("names match ignoring case, spaces, dashes and diacritics", () => {
  assert.equal(demoCityKey("New York"), "newyork");
  assert.equal(demoCityKey("new-york"), "newyork");
  assert.equal(demoCityKey("Plzeň"), "plzen");
  assert.equal(demoCityKey("Zürich"), "zurich");
  const auto = [
    { id: "new-york", name: "New York", center: { lat: 40.75, lng: -73.98 }, population: 8_300_000 },
    { id: "paris-us", name: "Paris", center: { lat: 33.66, lng: -95.55 }, population: 25_000 },
    { id: "paris", name: "Paris", center: { lat: 48.86, lng: 2.34 }, population: 2_100_000 },
    { id: "zurich", name: "Zürich", center: { lat: 47.37, lng: 8.54 }, population: 420_000 },
  ];
  assert.equal(findDemoCity("newyork", { auto }).id, "new-york");
  assert.equal(findDemoCity("NEW-YORK", { auto }).id, "new-york");
  assert.equal(findDemoCity("paris", { auto }).id, "paris", "the bigger namesake wins");
  assert.equal(findDemoCity("zurich", { auto }).id, "zurich");
  assert.deepEqual(findDemoCity("zurich", { auto }).center, { lat: 47.37, lng: 8.54 });
  assert.equal(findDemoCity("atlantis", { auto }), null);
  assert.equal(findDemoCity("", { auto }), null);
  // A reviewed city wins over an auto city of the same name.
  assert.equal(findDemoCity("plzen", { live: cityPack.LIVE_CITIES, auto }).id, "plzen");
  assert.equal(findDemoCity("brno", { live: cityPack.LIVE_CITIES, auto: cityPack.AUTO_CITIES.entries }).id, "brno");
});

test("an arena world can open in another city; without one it stays the default city", async () => {
  const db = openDatabase(":memory:");
  const brno = { lat: SYNTHETIC_ROW.lat, lng: SYNTHETIC_ROW.lng };
  const arena = await ensureWorld(db, brno, true, now, {
    arenaCity: cityPack.playableCityById("brno"),
  });
  assert.equal(arena.arena, true);
  assert.equal(arena.cityId, "brno");
  assert.match(arena.id, /^demo:arena-city-brno:/);
  assert.ok(arena.zones.length > 0);
  const plzen = await ensureWorld(db, brno, true, now);
  assert.equal(plzen.cityId, "plzen");
  assert.match(plzen.id, /^demo:arena-city-plzen:/);
});
