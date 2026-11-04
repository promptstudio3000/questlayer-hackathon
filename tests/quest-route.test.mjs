import test from "node:test";
import assert from "node:assert/strict";
import { activeQuestRoute } from "../src/quest-route.ts";

const here = { lat: 49.7475, lng: 13.3776 };
const base = { completed: 0, closes_at: Date.now() + 3600_000, opens_at: 0, kind: "route" };
const walk = (id, stops, extra = {}) => ({
  ...base,
  id,
  zone_id: `zone-${id}`,
  lat: stops.at(-1).lat,
  lng: stops.at(-1).lng,
  checkpointCount: 3,
  checkpoint: 3 - stops.length,
  nextPoint: stops[0],
  stops,
  ...extra,
});
const a = { lat: 49.748, lng: 13.378 },
  b = { lat: 49.749, lng: 13.379 },
  c = { lat: 49.75, lng: 13.38 };

test("draws the pointed walk from the explorer through every stop ahead", () => {
  const route = activeQuestRoute([walk("one", [a, b, c])], { position: here, now: Date.now(), questId: "one" });
  assert.equal(route.questId, "one");
  assert.deepEqual(route.points, [here, a, b, c]);
});

test("a walk in the selected place is drawn before it starts", () => {
  const route = activeQuestRoute([walk("one", [a, b, c])], { position: here, now: Date.now(), zoneId: "zone-one" });
  assert.equal(route?.questId, "one");
});

test("without a selection only a walk already started is drawn", () => {
  const now = Date.now();
  assert.equal(activeQuestRoute([walk("one", [a, b, c])], { position: here, now }), null);
  const route = activeQuestRoute([walk("one", [a, b, c]), walk("two", [b, c])], { position: here, now });
  assert.deepEqual(route.points, [here, b, c]);
});

test("a hunt in any order is drawn nearest stop first", () => {
  const route = activeQuestRoute([walk("hunt", [c, a, b], { visitedStops: [] })], {
    position: here,
    now: Date.now(),
    questId: "hunt",
  });
  assert.deepEqual(route.points, [here, a, b, c]);
});

test("finished, closed and single-stop quests draw nothing", () => {
  const now = Date.now();
  for (const q of [
    walk("done", [a, b, c], { completed: 1 }),
    walk("closed", [a, b, c], { closes_at: now - 1 }),
    walk("single", [a], { checkpointCount: 1 }),
  ])
    assert.equal(activeQuestRoute([q], { position: here, now, questId: q.id }), null);
});
