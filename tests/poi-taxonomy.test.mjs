import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POI_CATEGORIES,
  POI_CATEGORY_IDS,
  OSM_CATEGORY_RULES,
  OVERTURE_CATEGORY_MAP,
  categorizeOsm,
  categorizeOverture,
} from "../server/poi/taxonomy.mjs";

test("taxonomy v1 has the 30 categories from WORLDS-PLAN C.2.4", () => {
  assert.equal(POI_CATEGORIES.length, 30);
  assert.equal(new Set(POI_CATEGORY_IDS).size, 30);
  for (const id of POI_CATEGORY_IDS) assert.match(id, /^[a-z_]+$/);
});

test("every category is reachable from OSM tags and rules point at known categories", () => {
  const reached = new Set(OSM_CATEGORY_RULES.map((r) => r.category));
  for (const id of POI_CATEGORY_IDS) assert.ok(reached.has(id), id);
  assert.equal(
    new Set(OSM_CATEGORY_RULES.map((r) => r.id)).size,
    OSM_CATEGORY_RULES.length,
  );
  for (const c of Object.values(OVERTURE_CATEGORY_MAP))
    assert.ok(POI_CATEGORY_IDS.includes(c), c);
});

test("OSM tags map to the expected categories, most specific first", () => {
  const cases = [
    [{ leisure: "park" }, "park"],
    [{ tourism: "artwork", artwork_type: "mural" }, "street_art"],
    [{ tourism: "artwork", artwork_type: "statue" }, "sculpture"],
    [{ tourism: "artwork" }, "artwork"],
    [{ man_made: "tower", "tower:type": "observation" }, "landmark_tower"],
    [{ man_made: "tower", "tower:type": "communication" }, null],
    [{ historic: "castle" }, "castle"],
    [{ leisure: "pitch", sport: "skateboard" }, "skate_park"],
    [{ leisure: "pitch", sport: "soccer" }, "sports_ground"],
    [{ tourism: "information", information: "board" }, "information_board"],
    [{ tourism: "information", information: "guidepost" }, "trailhead"],
    [{ amenity: "bench", view: "river" }, "bench_with_view"],
    [{ amenity: "bench" }, null],
    [{ tourism: "attraction", name: "Velký Bílý" }, "other_named"],
    [{ tourism: "attraction" }, null],
    [{ natural: "water", water: "pond" }, "lake_walk"],
    [{ man_made: "bridge" }, "bridge"],
    [{ man_made: "bridge", highway: "primary" }, null],
    [{ shop: "supermarket" }, null],
  ];
  for (const [tags, expected] of cases)
    assert.equal(
      categorizeOsm(tags)?.category ?? null,
      expected,
      JSON.stringify(tags),
    );
  assert.equal(categorizeOsm({ leisure: "park" }).rule, "osm:park");
});

test("Overture uses the first known category among primary and alternates", () => {
  assert.equal(
    categorizeOverture({ primary: "coffee_shop", alternate: ["public_plaza"] })
      .category,
    "plaza",
  );
  assert.equal(categorizeOverture({ primary: "dentist" }), null);
  assert.equal(categorizeOverture(undefined), null);
});

test("badge POI fixtures use taxonomy categories", () => {
  const pois = JSON.parse(
    readFileSync(new URL("./fixtures/poi/badge-pois.json", import.meta.url)),
  );
  for (const p of pois)
    assert.ok(POI_CATEGORY_IDS.includes(p.category), p.category);
});
