import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database.mjs";
import {
  classifyPois,
  osmToInputs,
  overtureToInputs,
  questReady,
  loadPoiClosures,
  changePoiPlace,
  isPublicPath,
  SAFETY_REASONS,
  POI_POLICY,
} from "../server/poi/index.mjs";
import {
  TAG_RULES,
  tagReasons,
  levelOf,
  assessPoi,
  SAFETY_VERSION,
} from "../server/poi/safety.mjs";
import {
  classifyOsm,
  classifyOverture,
  TAXONOMY_VERSION,
} from "../server/poi/taxonomy.mjs";
import {
  at,
  node,
  rect,
  footway,
  way,
  mainPath,
  farPath,
  schoolNextToPark,
} from "./fixtures/poi/safety-world.mjs";

const classify = (elements, extra = {}) =>
  classifyPois({ ...osmToInputs(elements), ...extra });
const byId = (records) => Object.fromEntries(records.map((r) => [r.id, r]));

test("school next to a park: park kept, school excluded, target outside school grounds", () => {
  const { records } = classify(schoolNextToPark());
  const { "osm:w100": park, "osm:w101": school } = byId(records);
  assert.equal(park.category, "park");
  assert.equal(park.safety, "ok");
  assert.deepEqual(park.reasons, []);
  // The path inside the park is within 25 m of the school and the yard path is
  // inside the school, so the target lands on the clean path west of the park.
  assert.equal(park.target.pathId, "osm:w3");
  assert.ok(park.target.distanceM <= 40);
  const west = at(-20, 100);
  assert.ok(Math.abs(park.target.lng - west.lon) < 1e-5);
  assert.equal(school.category, null);
  assert.equal(school.safety, "excluded");
  assert.ok(school.reasons.includes("school"));
  assert.deepEqual(
    questReady(records).map((r) => r.id),
    ["osm:w100"],
  );
});

test("a park whose only paths lie in school grounds is excluded with a reason", () => {
  const elements = schoolNextToPark().filter((e) => e.id !== 3);
  const park = byId(classify(elements).records)["osm:w100"];
  assert.equal(park.safety, "excluded");
  assert.deepEqual(park.reasons, ["target-excluded"]);
  assert.equal(park.target, null);
});

test("a POI with no public path within 40 m is excluded", () => {
  const { records } = classify([
    node(1, 0, 0, { amenity: "fountain" }),
    node(2, 0, 45, { tourism: "viewpoint" }),
    node(3, 0, 39, { tourism: "viewpoint" }),
    mainPath(),
  ]);
  const r = byId(records);
  assert.equal(r["osm:n1"].safety, "ok");
  assert.equal(r["osm:n1"].target.distanceM, 0);
  assert.deepEqual(r["osm:n2"].reasons, ["no-public-path"]);
  assert.equal(r["osm:n2"].safety, "excluded");
  assert.equal(r["osm:n3"].safety, "ok");
  assert.ok(Math.abs(r["osm:n3"].target.distanceM - 39) < 0.5);
});

test("water without a path is excluded as water-no-path, with a path it is a walk", () => {
  const { records } = classify([
    way(
      10,
      [
        [0, 100],
        [300, 100],
      ],
      { waterway: "river", name: "Radbuza" },
    ),
    way(
      11,
      [
        [0, 900],
        [300, 900],
      ],
      { waterway: "river", name: "Úslava" },
    ),
    footway(12, [
      [0, 120],
      [300, 120],
    ]),
    rect(13, 2000, 2000, 2100, 2100, {
      natural: "water",
      water: "pond",
      name: "Kalikovský rybník",
    }),
  ]);
  const r = byId(records);
  assert.equal(r["osm:w10"].category, "river_walk");
  assert.equal(r["osm:w10"].safety, "ok");
  assert.deepEqual(r["osm:w11"].reasons, ["water-no-path"]);
  assert.equal(r["osm:w13"].category, "lake_walk");
  assert.deepEqual(r["osm:w13"].reasons, ["water-no-path"]);
});

// One fixture per hard exclusion and review rule in docs/WORLDS-PLAN.md C.2.3.
const EXCLUSION_FIXTURES = [
  ["school", { amenity: "school" }],
  ["kindergarten", { amenity: "kindergarten" }],
  ["playground", { leisure: "playground" }],
  ["hospital", { amenity: "hospital" }],
  ["care-home", { amenity: "nursing_home" }],
  ["prison", { amenity: "prison" }],
  ["military", { military: "bunker", historic: "memorial" }],
  [
    "worship-exterior",
    { amenity: "place_of_worship", historic: "building", name: "Kostel" },
    "review",
  ],
  [
    "cemetery",
    { landuse: "cemetery", tourism: "attraction", name: "Ústřední hřbitov" },
    "review",
  ],
  [
    "sensitive-memorial",
    { historic: "memorial", memorial: "stolperstein" },
    "review",
  ],
  ["private-access", { leisure: "garden", access: "private" }],
  ["railway", { railway: "station", name: "Hlavní nádraží" }],
  ["motorway", { highway: "motorway_link", bridge: "yes" }],
  ["quarry", { landuse: "quarry", name: "Lom" }],
  ["construction", { tourism: "viewpoint", construction: "yes" }],
  ["embassy", { amenity: "embassy" }],
  ["police", { amenity: "police" }],
  ["bar", { amenity: "pub", name: "U Salzmannů" }],
  ["aerodrome", { aeroway: "aerodrome", tourism: "viewpoint" }],
  ["adult-venue", { amenity: "casino" }],
  ["disused", { amenity: "fountain", "disused:amenity": "fountain" }],
  ["disused", { tourism: "viewpoint", abandoned: "yes" }],
];

test("every exclusion rule has a fixture that carries its reason code", () => {
  const covered = new Set(EXCLUSION_FIXTURES.map(([code]) => code));
  for (const rule of TAG_RULES) assert.ok(covered.has(rule.code), rule.code);
  for (const [code, tags, level = "excluded"] of EXCLUSION_FIXTURES) {
    const { records } = classify([node(1, 0, 5, tags), mainPath()]);
    const r = records.find((x) => x.id === "osm:n1");
    assert.ok(r, code);
    assert.ok(r.reasons.includes(code), `${code}: ${r.reasons}`);
    assert.equal(r.safety, level, code);
    assert.ok(SAFETY_REASONS[code], code);
  }
});

test("POIs inside grounds inherit the grounds' reason; review grounds give review", () => {
  const { records } = classify([
    rect(20, 0, -50, 100, 50, { amenity: "hospital" }),
    node(21, 50, 10, { tourism: "artwork", artwork_type: "sculpture" }),
    rect(22, 300, -50, 400, 50, { landuse: "cemetery" }),
    node(23, 350, 10, { historic: "memorial", name: "Pomník padlým" }),
    rect(24, 600, -50, 700, 50, { landuse: "military" }),
    node(25, 650, 0, { tourism: "viewpoint" }),
    footway(26, [
      [-100, 0],
      [1000, 0],
    ]),
  ]);
  const r = byId(records);
  assert.equal(r["osm:n21"].category, "sculpture");
  assert.ok(r["osm:n21"].reasons.includes("inside-hospital"));
  assert.equal(r["osm:n21"].safety, "excluded");
  assert.deepEqual(r["osm:n23"].reasons, ["inside-cemetery"]);
  assert.equal(r["osm:n23"].safety, "review");
  assert.ok(r["osm:n25"].reasons.includes("inside-military"));
  assert.equal(r["osm:n25"].safety, "excluded");
});

test("review categories and unnamed features carry reason codes", () => {
  const { records } = classify([
    node(1, 0, 5, {
      leisure: "pitch",
      sport: "skateboard",
      name: "Skatepark Lochotín",
    }),
    node(2, 50, 5, { place: "square" }),
    node(3, 100, 5, { place: "square", name: "Náměstí Republiky" }),
    node(4, 150, 5, { shop: "bakery" }),
    mainPath(),
  ]);
  const r = byId(records);
  assert.equal(r["osm:n1"].category, "skate_park");
  assert.deepEqual(r["osm:n1"].reasons, ["category-review"]);
  assert.equal(r["osm:n1"].safety, "review");
  assert.deepEqual(r["osm:n2"].reasons, ["unnamed"]);
  assert.equal(r["osm:n2"].safety, "excluded");
  assert.equal(r["osm:n3"].safety, "ok");
  assert.equal(r["osm:n4"], undefined, "non-game shops are not POIs at all");
});

test("public path rules: footways yes, private, tunnels, motorways and bare roads no", () => {
  assert.equal(isPublicPath({ highway: "footway" }), true);
  assert.equal(isPublicPath({ highway: "residential" }), true);
  assert.equal(isPublicPath({ highway: "footway", access: "private" }), false);
  assert.equal(
    isPublicPath({ highway: "service", access: "private", foot: "yes" }),
    true,
  );
  assert.equal(isPublicPath({ highway: "service" }), false);
  assert.equal(isPublicPath({ highway: "footway", tunnel: "yes" }), false);
  assert.equal(isPublicPath({ highway: "trunk", sidewalk: "both" }), false);
  assert.equal(isPublicPath({ highway: "primary" }), false);
  assert.equal(isPublicPath({ highway: "primary", sidewalk: "both" }), true);
  assert.equal(isPublicPath({ highway: "path", foot: "no" }), false);
  const { paths } = osmToInputs([
    footway(
      1,
      [
        [0, 0],
        [10, 0],
      ],
      { access: "private" },
    ),
    way(
      2,
      [
        [0, 0],
        [10, 0],
      ],
      { highway: "motorway" },
    ),
    footway(3, [
      [0, 0],
      [10, 0],
    ]),
  ]);
  assert.deepEqual(
    paths.map((p) => p.id),
    ["osm:w3"],
  );
});

test("re-import after an operator closure keeps the closure", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "poi-closure-"));
  const db = openDatabase(join(dir, "db.sqlite"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const v1 = [
    node(1, 0, 10, { amenity: "fountain", name: "Kašna" }),
    node(2, 200, 10, { amenity: "fountain" }),
    mainPath(),
  ];
  const first = byId(classify(v1).records)["osm:n1"];
  assert.equal(first.safety, "ok");
  const operator = { isOperator: () => true, clock: () => 1_700_000_000_000 };
  const receipt = changePoiPlace(
    db,
    first,
    {
      actor: "qa-operator",
      operationId: "close-fountain",
      candidateId: first.id,
      action: "close",
      reason: "Broken paving around the fountain",
      expectedVersion: 0,
    },
    operator,
  );
  assert.equal(receipt.state, "closed");
  assert.equal(receipt.cityId, "poi");
  // A new import: renamed, nudged 3 m and with an extra tag.
  const v2 = [
    node(1, 3, 10, {
      amenity: "fountain",
      name: "Kašna Hygie",
      drinking_water: "no",
    }),
    node(2, 200, 10, { amenity: "fountain" }),
    mainPath(),
  ];
  const closures = loadPoiClosures(db);
  const after = byId(classify(v2, { closures }).records);
  assert.equal(after["osm:n1"].safety, "excluded");
  assert.ok(after["osm:n1"].reasons.includes("operator-closure"));
  assert.deepEqual(after["osm:n1"].closure, {
    scope: "poi",
    id: "osm:n1",
    version: 1,
  });
  assert.equal(after["osm:n2"].safety, "ok", "other POIs stay open");
  // Even a re-numbered OSM node on the same spot stays closed (geometry match).
  const moved = byId(
    classify([node(77, 0, 10, { amenity: "fountain" }), mainPath()], {
      closures,
    }).records,
  )["osm:n77"];
  assert.equal(moved.safety, "excluded");
  changePoiPlace(
    db,
    after["osm:n1"],
    {
      actor: "qa-operator",
      operationId: "reopen-fountain",
      candidateId: "osm:n1",
      action: "reopen",
      reason: "Paving repaired",
      expectedVersion: 1,
    },
    operator,
  );
  const reopened = byId(
    classify(v2, { closures: loadPoiClosures(db) }).records,
  );
  assert.equal(reopened["osm:n1"].safety, "ok");
  assert.throws(
    () =>
      changePoiPlace(db, first, {
        actor: "someone",
        operationId: "x",
        candidateId: first.id,
        action: "close",
        reason: "nope nope",
        expectedVersion: 2,
      }),
    /operator authority/,
  );
});

test("output is deterministic and independent of input order", () => {
  const elements = [
    ...schoolNextToPark(),
    node(5, 50, 5, { amenity: "fountain" }),
    farPath(),
  ];
  const a = classify(elements);
  const b = classify([...elements].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.report.policy, POI_POLICY);
  assert.equal(a.report.total, a.records.length);
  for (const r of a.records) {
    assert.match(r.h3r7, /^87/);
    assert.match(r.h3r5, /^85/);
    for (const reason of r.reasons) assert.ok(SAFETY_REASONS[reason], reason);
  }
});

test("Overture places: categories, exclusions and confidence", () => {
  const place = (id, primary, x, y, extra = {}) => ({
    id,
    names: { primary: `Place ${id}` },
    categories: { primary },
    confidence: 0.9,
    lat: at(x, y).lat,
    lng: at(x, y).lon,
    ...extra,
  });
  const pois = overtureToInputs([
    place("a", "park", 0, 5),
    place("b", "elementary_school", 50, 5),
    place("c", "scenic_viewpoint", 100, 5, { confidence: 0.2 }),
    place("d", "dentist", 150, 5),
    place("e", "night_club", 200, 5),
  ]);
  const { records } = classifyPois({ ...osmToInputs([mainPath()]), pois });
  const r = byId(records);
  assert.equal(r["ovt:a"].safety, "ok");
  assert.equal(r["ovt:a"].category, "park");
  assert.ok(r["ovt:b"].reasons.includes("school"));
  assert.ok(r["ovt:c"].reasons.includes("low-confidence"));
  assert.equal(r["ovt:d"], undefined);
  assert.ok(r["ovt:e"].reasons.includes("bar"));
});

test("reason levels and tag reasons stay consistent", () => {
  assert.equal(levelOf("inside-cemetery"), "review");
  assert.equal(levelOf("inside-school"), "excluded");
  assert.equal(levelOf("operator-closure"), "excluded");
  assert.deepEqual(tagReasons({ amenity: "fountain" }), []);
  for (const code of Object.keys(SAFETY_REASONS))
    assert.match(code, /^[a-z-]+$/);
});

test("W3 adapter: classifyOsm, classifyOverture and assessPoi", () => {
  assert.equal(TAXONOMY_VERSION, "poi-taxonomy-v1");
  assert.equal(SAFETY_VERSION, "poi-safety-v1");
  assert.equal(classifyOsm({ leisure: "park" }), "park");
  assert.equal(classifyOsm({ shop: "bakery" }), null);
  assert.equal(classifyOsm(undefined), null);
  assert.equal(classifyOverture({ category: "public_plaza" }), "plaza");
  assert.equal(
    classifyOverture({ category: "unknown_thing", basicCategory: "park" }),
    "park",
  );
  assert.equal(classifyOverture({ category: "dentist" }), null);
  const path = { lat: 49.75, lng: 13.38, distanceM: 12, wayId: "osm:w1" };
  const park = {
    id: "osm:w100",
    category: "park",
    name: "Park",
    tags: { leisure: "park" },
  };
  assert.deepEqual(assessPoi(park, { nearestPath: path }), {
    safety: "ok",
    reason: null,
    reasons: [],
    target: { lat: 49.75, lng: 13.38 },
  });
  const far = assessPoi(park, { nearestPath: null });
  assert.equal(far.safety, "excluded");
  assert.equal(far.reason, "no-public-path");
  assert.equal(far.target, null);
  const inSchool = assessPoi(park, {
    nearestPath: path,
    exclusion: { kind: "school", id: "osm:w101" },
  });
  assert.equal(inSchool.safety, "excluded");
  assert.equal(inSchool.reason, "inside-school");
  assert.equal(
    assessPoi(park, {
      nearestPath: path,
      exclusion: { kind: "care_home", id: "x" },
    }).reason,
    "inside-care-home",
  );
  assert.equal(
    assessPoi(park, {
      nearestPath: path,
      exclusion: { kind: "aerodrome", id: "x" },
    }).reason,
    "inside-aerodrome",
  );
  const cem = assessPoi(park, {
    nearestPath: path,
    exclusion: { kind: "cemetery", id: "x" },
  });
  assert.equal(cem.safety, "review");
  assert.equal(cem.reason, "inside-cemetery");
  assert.deepEqual(cem.target, { lat: 49.75, lng: 13.38 });
  const closed = assessPoi(park, {
    nearestPath: path,
    closures: new Set(["osm:w100"]),
  });
  assert.equal(closed.safety, "excluded");
  assert.equal(closed.reason, "operator-closure");
  const school = assessPoi(
    { id: "osm:n5", category: null, name: "ZŠ", tags: { amenity: "school" } },
    { nearestPath: path },
  );
  assert.equal(school.reason, "school");
  const ovt = assessPoi(
    { id: "ovt:abc", category: "skate_park", name: "Skatepark", tags: {} },
    { nearestPath: path },
  );
  assert.equal(ovt.safety, "review");
  assert.equal(ovt.reason, "category-review");
  const river = assessPoi(
    {
      id: "osm:w9",
      category: "river_walk",
      name: "Mže",
      tags: { waterway: "river" },
    },
    { nearestPath: { ...path, distanceM: 55 } },
  );
  assert.equal(river.reason, "water-no-path");
});

test("names and access values that mean staff or members only exclude a POI", async () => {
  const { restrictedName } = await import("../server/poi/safety.mjs");
  for (const n of [
    "Pusat Sumber (Untuk Kakitangan Sahaja)",
    "Staff Only",
    "Members only lounge",
    "MBPT staff quarters",
    "Nur für Personal",
    "Réservé au personnel",
    "関係者以外立入禁止",
    "员工专用",
  ])
    assert.equal(restrictedName(n), true, n);
  for (const n of ["Staff", "Wagstaff", "Flagstaff", "Private Driver Barcelona", "Good Vibes Only", "Only Shoes", "Café Privé"])
    assert.equal(restrictedName(n), false, n);
  assert.deepEqual(tagReasons({ amenity: "library", name: "Pusat Sumber (Untuk Kakitangan Sahaja)" }), ["private-access"]);
  assert.deepEqual(tagReasons({ amenity: "library", "name:en": "Staff only library" }), ["private-access"]);
  assert.deepEqual(tagReasons({ leisure: "park", access: "residents" }), ["private-access"]);
  assert.deepEqual(tagReasons({ leisure: "park", access: "residents", foot: "yes" }), []);
  const v = assessPoi(
    { id: "ovt:x", category: "library", name: "Staff Only Reading Room", tags: {} },
    { nearestPath: { lat: 1, lng: 1, distanceM: 5 } },
  );
  assert.equal(v.safety, "excluded");
  assert.equal(v.reason, "private-access");
});
