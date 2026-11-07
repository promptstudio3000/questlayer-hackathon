import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  questPinKind,
  altarModelId,
  mapGuidePoints,
  servicePin,
  questPinMarkup,
} from "../src/map-kit.ts";
const position = { lat: 49.74, lng: 13.37 },
  next = { lat: 49.75, lng: 13.38 },
  now = 1000;
const zone = { ...position, id: "z", tier: 2, opensAt: 0, closesAt: 2000 };
const q = {
  ...next,
  id: "q",
  zone_id: "z",
  tier: 1,
  kind: "route",
  completed: 0,
  opens_at: 0,
  closes_at: 2000,
  activity: { icon: "return" },
};
test("map appearance derives from actual quest family and canonical tier", () => {
  assert.equal(questPinKind(q), "return");
  assert.equal(altarModelId(zone, [q], now), "return-tier-2");
  assert.equal(questPinKind({ ...q, clue: {} }), "clue");
  assert.equal(
    altarModelId(
      zone,
      [q, { ...q, id: "chest", kind: "chest", activity: undefined }],
      now,
      1,
      "chest",
    ),
    "chest-tier-2",
  );
  assert.equal(
    altarModelId({ ...zone, tier: 3 }, [{ ...q, clue: {} }], now),
    "landmark-tier-3",
  );
  assert.equal(
    altarModelId({ ...zone, tier: 99 }, [], now),
    "discovery-tier-1",
  );
});
test("guidance preserves ordered stops, gives explicit targets priority and rejects invalid geometry", () => {
  const route = {
    questId: "q",
    points: [position, next, { lat: 49.76, lng: 13.39 }],
  };
  const input = { position, route, zone, quests: [q], now };
  assert.deepEqual(mapGuidePoints(input), route.points);
  assert.deepEqual(
    mapGuidePoints({
      ...input,
      selectedQuestId: "chest",
      quests: [q, { ...q, id: "chest", kind: "chest", activity: undefined }],
    }),
    [position, next],
  );
  assert.deepEqual(mapGuidePoints({ ...input, target: next }), [
    position,
    next,
  ]);
  assert.deepEqual(
    mapGuidePoints({
      ...input,
      route: { ...route, points: [position, { lat: NaN, lng: 3 }, next] },
    }),
    [],
  );
  assert.deepEqual(mapGuidePoints({ ...input, route: null }), [position, next]);
  assert.deepEqual(
    mapGuidePoints({ ...input, route: null, quests: [{ ...q, completed: 1 }] }),
    [],
  );
  assert.deepEqual(mapGuidePoints({ ...input, route: null, now: 2001 }), []);
  assert.deepEqual(
    mapGuidePoints({
      ...input,
      route: null,
      quests: [{ ...q, opens_at: 1500 }],
    }),
    [],
  );
  assert.deepEqual(
    mapGuidePoints({ ...input, route: null, playerTier: 0 }),
    [],
  );
});
test("only supported service types get a service pin; marker HTML is allowlisted", () => {
  assert.equal(servicePin("keeper"), "/art/map-kit/pins/keeper.png");
  assert.equal(servicePin("guardian"), null);
  assert(!questPinMarkup('\" onerror=evil').includes("evil"));
});
test("adopted runtime artwork retains package hashes and embedded GLBs", () => {
  const provenance = JSON.parse(
    readFileSync(
      new URL("../public/art/map-kit/provenance.json", import.meta.url),
    ),
  );
  for (const entry of provenance.files) {
    const file = new URL(
      `../public/art/map-kit/${entry.path}`,
      import.meta.url,
    );
    assert(existsSync(file));
    const data = readFileSync(file);
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      entry.sha256,
      entry.path,
    );
    if (entry.path.endsWith(".glb")) {
      assert.equal(data.toString("ascii", 0, 4), "glTF");
      const json = JSON.parse(
        data.toString("utf8", 20, 20 + data.readUInt32LE(12)),
      );
      assert(json.buffers.every((b) => !b.uri));
      assert.equal(json.images?.length || 0, 0);
    }
  }
});
