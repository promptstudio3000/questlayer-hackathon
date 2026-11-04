import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CITY_REGISTRY,
  DEFAULT_CITY,
  LIVE_CITIES,
  PLZEN,
  cityById,
  cityFor,
  loadCityRegistry,
} from "../server/spatial/city-pack.mjs";
import { planDescriptor } from "../server/world-planner.mjs";

const plzenFile = readFileSync(
  new URL("../server/data/plzen-v1.json", import.meta.url),
  "utf8",
);
const pack = (id, coverage, center) => ({
  id,
  name: id,
  timezone: "Europe/Prague",
  center,
  coverage,
  candidates: [],
  paths: [],
});
const brno = pack("brno", [16.55, 49.16, 16.66, 49.24], {
  lat: 49.1951,
  lng: 16.6068,
});

test("the shipped registry keeps Plzeň as the only live, default city", () => {
  assert.equal(DEFAULT_CITY, PLZEN);
  assert.deepEqual(
    LIVE_CITIES.map((c) => c.id),
    ["plzen"],
  );
  assert.equal(CITY_REGISTRY.statusOf("plzen"), "live");
  assert.equal(cityById("plzen"), PLZEN);
  assert.equal(cityById("nowhere"), null);
  // Registry loading must not touch the pack: same object as the raw file.
  assert.deepEqual(PLZEN, JSON.parse(plzenFile));
  assert.equal(
    planDescriptor(PLZEN, "2026-11-02").sourceHash,
    planDescriptor(JSON.parse(plzenFile), "2026-11-02").sourceHash,
  );
  assert.equal(cityFor(PLZEN.center), PLZEN);
  assert.equal(cityFor({ lat: 50.08, lng: 14.43 }), null);
});

test("a second city is config plus data: live packs are matched by GPS", () => {
  const r = loadCityRegistry(
    {
      version: 1,
      cities: [
        { id: "plzen", pack: "plzen-v1.json", status: "live", default: true },
        { id: "brno", pack: "brno-v1.json", status: "live" },
      ],
    },
    (file) => (file === "brno-v1.json" ? brno : JSON.parse(plzenFile)),
  );
  assert.equal(r.defaultCity.id, "plzen");
  assert.deepEqual(
    r.liveCities.map((c) => c.id),
    ["plzen", "brno"],
  );
  assert.equal(r.statusOf("brno"), "live");
});

test("preview cities load but are not live", () => {
  const r = loadCityRegistry(
    {
      version: 1,
      cities: [
        { id: "plzen", pack: "plzen-v1.json", status: "live", default: true },
        { id: "brno", pack: "brno-v1.json", status: "preview" },
      ],
    },
    (file) => (file === "brno-v1.json" ? brno : JSON.parse(plzenFile)),
  );
  assert.deepEqual(
    r.liveCities.map((c) => c.id),
    ["plzen"],
  );
  assert.equal(r.allCities.length, 2);
});

test("the registry rejects unsafe configurations", () => {
  const read = (file) =>
    file === "brno-v1.json"
      ? brno
      : file === "overlap.json"
        ? pack("overlap", [13.3, 49.7, 13.4, 49.8], { lat: 49.75, lng: 13.35 })
        : JSON.parse(plzenFile);
  const bad = (cities, msg) =>
    assert.throws(() => loadCityRegistry({ version: 1, cities }, read), msg);
  const plzen = { id: "plzen", pack: "plzen-v1.json", status: "live" };
  bad([plzen], /default/);
  bad(
    [
      { ...plzen, default: true },
      { id: "brno", pack: "brno-v1.json", status: "live", default: true },
    ],
    /default/,
  );
  bad([{ ...plzen, status: "preview", default: true }], /default/);
  bad([{ ...plzen, default: true }, { ...plzen }], /Duplicate/);
  bad([{ ...plzen, default: true, pack: "../secret.json" }], /pack file/);
  bad([{ ...plzen, default: true, status: "funded" }], /status/);
  bad(
    [{ id: "brno", pack: "plzen-v1.json", status: "live", default: true }],
    /expected brno/,
  );
  bad(
    [
      { ...plzen, default: true },
      { id: "overlap", pack: "overlap.json", status: "live" },
    ],
    /overlap/,
  );
  assert.throws(() => loadCityRegistry({ cities: [] }, read), /version/);
});

test("the Plzeň pack file is unchanged", () => {
  assert.equal(
    createHash("sha256").update(plzenFile).digest("hex"),
    "e37f2a0566e3f589b1ce781f19aee36673805d5638b3a3dbc9e37bdbf30581d0",
  );
});
