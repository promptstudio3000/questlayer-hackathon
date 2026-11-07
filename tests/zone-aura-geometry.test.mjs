import test from "node:test";
import assert from "node:assert/strict";
import { wallRibbonGeometry } from "../src/zone-aura-geometry.ts";
import {
  zoneWallFeatures,
  zoneAuraColor,
  totemHeight,
} from "../src/zone-landmarks.ts";
const project = (p) => [...p];
const ring = [
  [0, 0],
  [120, 0],
  [120, 40],
  [45, 40],
  [45, 100],
  [0, 100],
  [0, 0],
];
test("organic curtain has no roof or floor triangles and keeps its exact ground boundary", () => {
  const { positions: p, uvs } = wallRibbonGeometry(ring, 180, project);
  assert(
    p.length > ring.length * 18,
    "subdivides straight edges for a soft upper silhouette",
  );
  for (let i = 0; i < p.length; i += 9) {
    const ys = [p[i + 1], p[i + 4], p[i + 7]];
    assert(Math.max(...ys) > Math.min(...ys), "no horizontal cap triangle");
  }
  for (let i = 0; i < p.length; i += 3)
    if (p[i + 1] === 0) {
      const x = p[i],
        z = p[i + 2];
      assert(
        ring.slice(1).some((b, j) => {
          const a = ring[j],
            cross = (x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0]);
          return (
            Math.abs(cross) < 0.01 &&
            x >= Math.min(a[0], b[0]) - 0.001 &&
            x <= Math.max(a[0], b[0]) + 0.001 &&
            z >= Math.min(a[1], b[1]) - 0.001 &&
            z <= Math.max(a[1], b[1]) + 0.001
          );
        }),
        "ground foot stays on an actual edge",
      );
    }
  const tops = [];
  for (let i = 0; i < uvs.length; i += 2)
    if (uvs[i + 1] === 1) tops.push(p[(i / 2) * 3 + 1]);
  assert(
    Math.max(...tops) - Math.min(...tops) > 20,
    "irregular upper height, not a geometric box",
  );
  assert(
    Math.min(...tops) > 150 && Math.max(...tops) < 210,
    "restrained billow",
  );
});
test("published concave outlines and holes stay separate boundary paths without expanding the zone", () => {
  const hole = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
    [10, 10],
  ];
  const now = 1000,
    z = {
      id: "z",
      tier: 2,
      lat: 0,
      lng: 0,
      radius: 30,
      color: "#672eeb",
      opensAt: 0,
      closesAt: 2000,
      geometry: { type: "Polygon", coordinates: [ring, hole] },
    };
  const copy = JSON.stringify(z),
    features = zoneWallFeatures([z], [], now);
  assert.equal(features.length, 2);
  assert(features.every((f) => f.geometry.type === "LineString"));
  assert.deepEqual(
    features.map((f) => f.geometry.coordinates),
    [ring, hole],
  );
  assert.equal(JSON.stringify(z), copy, "read-only presentation");
  assert.equal(features[0].properties.color, zoneAuraColor(2));
  assert(features[0].properties.height > 100);
  assert(totemHeight(3) <= 22, "altar stays a small landmark");
});
test("invalid geometry cannot produce a stretched wall across missing points", () => {
  for (const [r, h] of [
    [[], 180],
    [
      [
        [0, 0],
        [NaN, 2],
        [0, 0],
      ],
      180,
    ],
    [ring, NaN],
    [ring, 0],
  ])
    assert.equal(wallRibbonGeometry(r, h, project).positions.length, 0);
});
