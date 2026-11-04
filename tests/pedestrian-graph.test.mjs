import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  importPedestrianGraph,
  createPedestrianRouter,
} from "../server/spatial/pedestrian-graph.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { buildCityPlan } from "../server/world-planner.mjs";

const p = [
  { lat: 49.75, lng: 13.37 },
  { lat: 49.75, lng: 13.372 },
  { lat: 49.751, lng: 13.372 },
];
function source() {
  return {
    elements: [
      ...p.map((p, i) => ({ type: "node", id: i + 1, lat: p.lat, lon: p.lng })),
      { type: "way", id: 10, nodes: [1, 2, 3], tags: { highway: "footway" } },
    ],
  };
}
const make = (s = source(), extra = {}) =>
  importPedestrianGraph(s, { cityId: "qa-city", ...extra });

test("pedestrian distance follows original OSM node connections and is explicitly not field verification", () => {
  const router = createPedestrianRouter(make());
  const r = router.route(
    { ...p[0], pathId: "osm-way-10" },
    { ...p[2], pathId: "osm-way-10" },
  );
  assert.equal(r.status, "reachable");
  assert.ok(r.meters > 240 && r.meters < 260);
  assert.equal(r.fieldReview, "pending");
});
test("overlaid bridge/ground coordinates with different OSM IDs do not create a crossing", () => {
  const s = source();
  s.elements.push(
    { type: "node", id: 4, lat: p[1].lat, lon: p[1].lng },
    { type: "node", id: 5, lat: p[1].lat - 0.001, lon: p[1].lng },
    {
      type: "way",
      id: 11,
      nodes: [4, 5],
      tags: { highway: "footway", bridge: "yes", layer: "1" },
    },
  );
  const r = createPedestrianRouter(make(s)).route(
    { ...p[0], pathId: "10" },
    { lat: p[1].lat - 0.001, lng: p[1].lng, pathId: "11" },
  );
  assert.equal(r.status, "unreachable");
  assert.equal(r.reason, "disconnected-public-paths");
  assert.equal(
    createPedestrianRouter(make(s)).route(p[1], p[0]).status,
    "unreachable",
  );
});
test("private paths, barriers, excluded crossings and one-way foot restrictions are enforced", () => {
  for (const change of [
    (s) => {
      s.elements.at(-1).tags.access = "private";
    },
    (s) => {
      s.elements[1].tags = { barrier: "gate" };
    },
  ]) {
    const s = source();
    change(s);
    assert.equal(
      createPedestrianRouter(make(s)).route(p[0], p[2]).status,
      "unreachable",
    );
  }
  const exclusion = {
    id: "closed-crossing",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [13.3709, 49.7499],
          [13.3711, 49.7499],
          [13.3711, 49.7501],
          [13.3709, 49.7501],
          [13.3709, 49.7499],
        ],
      ],
    },
  };
  assert.equal(
    createPedestrianRouter(make(), { exclusions: [exclusion] }).route(
      p[0],
      p[2],
    ).status,
    "unreachable",
  );
  const s = source();
  s.elements.at(-1).tags["oneway:foot"] = "yes";
  const router = createPedestrianRouter(make(s));
  assert.equal(router.route(p[0], p[2]).status, "reachable");
  assert.equal(router.route(p[2], p[0]).status, "unreachable");
});
test("configured graph validation rejects unreachable city objectives and requires an explicit mapped entry", () => {
  const candidate = {
    id: "qa-place",
    name: "QA park",
    sector: "central",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [13.3695, 49.7495],
          [13.3725, 49.7495],
          [13.3725, 49.7515],
          [13.3695, 49.7515],
          [13.3695, 49.7495],
        ],
      ],
    },
    targets: p.map((p) => ({ point: [p.lng, p.lat], pathId: "osm-way-10" })),
    entry: { ...p[0], pathId: "10" },
  };
  const pack = {
    ...PLZEN,
    id: "qa-city",
    candidates: [candidate],
    pedestrianGraph: make(),
  };
  const good = buildCityPlan(pack, "2026-11-02");
  assert.equal(good.zones.length, 1);
  assert.equal(good.diagnostics.routing, "mapped-connectivity");
  assert.equal(good.zones[0].walking.routes.length, 3);
  const missing = buildCityPlan(
    { ...pack, candidates: [{ ...candidate, entry: undefined }] },
    "2026-11-02",
  );
  assert.equal(missing.zones.length, 0);
  assert.equal(
    missing.diagnostics.rejected[0].reason,
    "missing-reviewed-entry",
  );
  const wrong = structuredClone(pack);
  wrong.candidates[0].targets[2].pathId = "unknown-way";
  assert.equal(buildCityPlan(wrong, "2026-11-02").zones.length, 0);
});
test("graph import CLI writes a separate versioned artifact without activating a CityPack", () => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-graph-cli-"));
  try {
    const input = join(dir, "source.json"),
      output = join(dir, "graph.json");
    writeFileSync(input, JSON.stringify(source()));
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "scripts/import-pedestrian-graph.mjs",
          "--input",
          input,
          "--output",
          output,
          "--city",
          "qa-city",
        ],
        { encoding: "utf8" },
      ),
    );
    assert.equal(report.activated, false);
    assert.equal(report.edges, 2);
    assert.equal(
      createPedestrianRouter(JSON.parse(readFileSync(output, "utf8"))).route(
        p[0],
        p[2],
      ).status,
      "reachable",
    );
    assert.throws(
      () =>
        importPedestrianGraph(
          { elements: [{ type: "way", id: 1, geometry: [] }] },
          { cityId: "qa-city" },
        ),
      /node coordinates/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
