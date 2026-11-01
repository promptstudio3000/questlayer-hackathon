import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCityPack,
  sectorFor,
} from "../server/spatial/city-pack-builder.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import {
  SYNTHETIC_CENTER,
  SYNTHETIC_COVERAGE,
  syntheticOverpass,
} from "./fixtures/synthetic-city.mjs";

const build = () =>
  buildCityPack({
    id: "dryrun",
    name: "Dry run city",
    version: "2026-11-01.1",
    timezone: "Europe/Prague",
    center: SYNTHETIC_CENTER,
    coverage: SYNTHETIC_COVERAGE,
    importedAt: "2026-11-01T00:00:00.000Z",
    ...syntheticOverpass(),
  });

test("builder gives a pack in the Plzeň pack shape", () => {
  const { pack } = build();
  assert.deepEqual(Object.keys(pack).sort(), Object.keys(PLZEN).sort());
  assert.deepEqual(
    Object.keys(pack.candidates[0]).sort(),
    Object.keys(PLZEN.candidates[0]).sort(),
  );
  assert.deepEqual(Object.keys(pack.candidates[0].targets[0]).sort(), [
    "pathId",
    "point",
  ]);
});

test("builder fills every sector and skips closed, broken and outside parks", () => {
  const { report } = build();
  assert.equal(report.candidates, 6);
  assert.deepEqual(report.emptySectors, []);
  assert.deepEqual(report.skipped.map((s) => s.reason).sort(), [
    "closed-access",
    "open-ring",
    "outside-coverage",
  ]);
  assert.equal(report.paths, 30, "private path is left out");
});

test("builder is deterministic", () => {
  assert.deepEqual(build(), build());
});

test("a built second-city pack plans six zones for a day", () => {
  const plan = buildCityPlan(build().pack, "2026-11-02");
  assert.equal(plan.cityId, "dryrun");
  assert.equal(plan.zones.length, 6);
  assert.deepEqual(plan.zones.map((z) => z.sector).sort(), [
    "central",
    "east",
    "north",
    "southeast",
    "southwest",
    "west",
  ]);
});

test("sectors follow bearing from the centre", () => {
  const c = { lat: 50, lng: 14 };
  assert.equal(sectorFor(c, { lat: 50.001, lng: 14 }), "central");
  assert.equal(sectorFor(c, { lat: 50.05, lng: 14 }), "north");
  assert.equal(sectorFor(c, { lat: 50, lng: 14.08 }), "east");
  assert.equal(sectorFor(c, { lat: 49.96, lng: 14.03 }), "southeast");
  assert.equal(sectorFor(c, { lat: 49.96, lng: 13.97 }), "southwest");
  assert.equal(sectorFor(c, { lat: 50, lng: 13.92 }), "west");
});

test("builder refuses a centre outside coverage", () => {
  assert.throws(() =>
    buildCityPack({
      id: "x1",
      name: "X",
      version: "1",
      timezone: "Europe/Prague",
      center: { lat: 0, lng: 0 },
      coverage: SYNTHETIC_COVERAGE,
      parks: {},
      paths: {},
    }),
  );
});
