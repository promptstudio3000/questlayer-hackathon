import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILDING_HEIGHT_CAP,
  inPolygon,
  landmarkFeatures,
  landmarkHeight,
  landmarkMinHeight,
} from "../src/map-landmarks.ts";

const square = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];

test("only churches, castles, monuments and towers are landmarks", () => {
  assert.equal(landmarkMinHeight("place_of_worship", "christian"), 30);
  assert.equal(landmarkMinHeight("castle", "castle"), 26);
  assert.equal(landmarkMinHeight("monument", "monument"), 22);
  assert.equal(landmarkMinHeight("museum", "museum"), 0);
  assert.equal(landmarkMinHeight("cafe", "cafe"), 0);
});

test("landmark height uses the real height, boosted and bounded", () => {
  assert.equal(landmarkHeight(102, 30), 102);
  assert.equal(landmarkHeight(8, 30), 30);
  assert.equal(landmarkHeight(undefined, 30), 30);
  assert.equal(landmarkHeight(400, 30), 140);
  assert.ok(landmarkHeight(8, 30) > BUILDING_HEIGHT_CAP);
});

test("point in polygon respects holes", () => {
  const ring = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
  assert.equal(inPolygon([1, 1], ring), true);
  assert.equal(inPolygon([5, 5], ring), false);
  assert.equal(inPolygon([11, 5], ring), false);
});

test("a church lifts only its own polygon out of a merged building group", () => {
  const merged = { polygons: [square(0, 0, 1), square(5, 5, 1)], height: 8 };
  const out = landmarkFeatures([{ class: "place_of_worship", subclass: "christian", lng: 0.5, lat: 0.5 }], [merged]);
  assert.equal(out.length, 1);
  assert.equal(out[0].properties.height, 30);
  assert.ok(inPolygon([0.5, 0.5], out[0].geometry.coordinates));
  assert.equal(inPolygon([5.5, 5.5], out[0].geometry.coordinates), false);
});

test("a cathedral keeps its real tower height", () => {
  const out = landmarkFeatures(
    [{ class: "place_of_worship", subclass: "christian", lng: 0.5, lat: 0.5 }],
    [{ polygons: [square(0, 0, 1)], height: 102 }],
  );
  assert.equal(out[0].properties.height, 102);
});

test("a church drawn as nave and tower raises the tower, not a cap", () => {
  const out = landmarkFeatures(
    [{ class: "place_of_worship", subclass: "christian", lng: 0.5, lat: 0.5 }],
    [
      { polygons: [square(0, 0, 3)], height: 20 },
      { polygons: [square(2, 2, 0.5)], height: 60 },
      { polygons: [square(9, 9, 1)], height: 40 },
    ],
  );
  const heights = out.map((f) => f.properties.height).sort((a, b) => a - b);
  assert.deepEqual(heights, [20, 60]);
});

test("ordinary pois, hidden buildings and duplicates add nothing", () => {
  const b = { polygons: [square(0, 0, 1)], height: 8 };
  assert.equal(landmarkFeatures([{ class: "cafe", lng: 0.5, lat: 0.5 }], [b]).length, 0);
  assert.equal(landmarkFeatures([{ class: "place_of_worship", lng: 3, lat: 3 }], [b]).length, 0);
  assert.equal(
    landmarkFeatures([{ class: "place_of_worship", lng: 0.5, lat: 0.5 }], [{ ...b, hide3d: true }]).length,
    0,
  );
  const twice = [{ class: "place_of_worship", lng: 0.5, lat: 0.5 }, { class: "place_of_worship", lng: 0.6, lat: 0.6 }];
  assert.equal(landmarkFeatures(twice, [b, b]).length, 1);
});
