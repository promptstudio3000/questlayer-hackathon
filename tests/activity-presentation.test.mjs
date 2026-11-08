import test from "node:test";
import assert from "node:assert/strict";
import { activityKind, activityProgress, activityRequirement, questsInZone } from "../src/activity-view.ts";

const here = { lat: 49.747, lng: 13.377 };
const next = { lat: 49.748, lng: 13.378 };
const quest = { id: "walk", zone_id: "park", kind: "route", completed: 0, ...next, checkpoint: 1, checkpointCount: 4, stops: [next, here, next] };

test("ordered walks, return walks and any-order hunts retain distinct teaching topics", () => {
  assert.equal(activityKind(quest), "trail");
  assert.equal(activityKind({ ...quest, activity: { templateId: "return-trail" } }), "return");
  assert.equal(activityKind({ ...quest, visitedStops: [] }), "hunt");
  assert.equal(activityKind({ ...quest, kind: "visit", clue: { question: "Which place?" } }), "clue");
});

test("a return walk reports its current server checkpoint rather than restarting at stop one", () => {
  assert.equal(activityProgress(quest, here), "Stop 2 of 4");
  assert.equal(activityProgress({ ...quest, checkpoint: 4, stops: [] }, here), "Finish walk");
  assert.equal(activityProgress({ ...quest, completed: 1 }, here), "Completed");
});

test("an any-order hunt reports completion without inventing an ordered next stop", () => {
  assert.equal(activityProgress({ ...quest, visitedStops: [2], checkpointCount: 3 }, here), "Any order · 1/3");
});

test("place choices only include the activities actually attached to that place", () => {
  const other = { ...quest, id: "other", zone_id: "another-park" };
  assert.deepEqual(questsInZone([quest, other], { id: "park" }), [quest]);
  assert.deepEqual(questsInZone([quest], null), []);
});

test("essential compact requirements do not depend on teaching preferences", () => {
  const zone = { id: "park", ...here, opensAt: 0, closesAt: 200000, radius: 100 };
  const current = { ...quest, kind: "visit", opens_at: 0, closes_at: 200000 };
  assert.equal(activityRequirement(current, zone, here, 100000, true, null, false), "You're offline");
  assert.equal(activityRequirement(current, {...zone, operatorPause: {reason:"Pause"}}, here, 100000, true, null, true), "Not open now");
  assert.equal(activityRequirement({...current,closes_at:99999}, zone, here, 100000, true, null, true), "Closed for today");
  assert.match(activityRequirement(current, zone, here, 100000, true, null, true), /within 25 m/);
});

test("GPS explanation retains the existing precision and freshness boundaries", () => {
  const zone = { id: "park", ...here, opensAt: 0, closesAt: 200000, radius: 100 };
  const current = { ...quest, ...here, kind: "visit", opens_at: 0, closes_at: 200000 };
  for (const fix of [null,{accuracy:36,timestamp:100000},{accuracy:8,timestamp:84999},{accuracy:8,timestamp:102001}])
    assert.match(activityRequirement(current, zone, here, 100000, false, fix, true), /fresh, accurate GPS/);
  assert.equal(activityRequirement(current, zone, here, 100000, false, {accuracy:35,timestamp:85000}, true), null);
});
