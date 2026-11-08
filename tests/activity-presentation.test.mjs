import test from "node:test";
import assert from "node:assert/strict";
import { activityKind, activityProgress, questsInZone } from "../src/activity-view.ts";

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
