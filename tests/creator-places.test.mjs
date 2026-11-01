import test from "node:test";
import assert from "node:assert/strict";
import { creatorPlace } from "../server/creators/place-policy.mjs";

test("creator places accept visit, trail and chest templates only", () => {
  assert.deepEqual(
    creatorPlace({ template: "visit", points: [{ lat: 49.747451234, lng: 13.3774 }] }),
    { template: "visit", points: [{ lat: 49.74745, lng: 13.3774 }] },
  );
  const trail = creatorPlace({
    template: "trail",
    points: [
      { lat: 49.7474, lng: 13.3774 },
      { lat: 49.7484, lng: 13.3784 },
    ],
  });
  assert.equal(trail.points.length, 2);
  assert.throws(() => creatorPlace({ template: "race", points: [{ lat: 1, lng: 1 }] }));
  assert.throws(() => creatorPlace({ template: "chest", points: [] }));
  assert.throws(() =>
    creatorPlace({ template: "trail", points: [{ lat: 49.7, lng: 13.3 }] }),
  );
  assert.throws(() =>
    creatorPlace({ template: "visit", points: [{ lat: 95, lng: 13 }] }),
  );
  assert.throws(() =>
    creatorPlace({
      template: "trail",
      points: [
        { lat: 49.7, lng: 13.3 },
        { lat: 49.8, lng: 13.3 },
      ],
    }),
    /5 km/,
  );
  assert.throws(() =>
    creatorPlace({ template: "visit", points: [{ lat: 1, lng: 1, note: "x" }] }),
  );
});
