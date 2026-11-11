import test from "node:test";
import assert from "node:assert/strict";
import { nearbyCounts, nearbyFilterOf, nearbyRows, nearbySortOf } from "../src/nearby-list.ts";

const rows = [
  { key: "zone:a", kind: "zone", ref: "a", distanceM: 300, xp: 50, reward: 0 },
  { key: "quest:a1", kind: "quest", ref: "a1", distanceM: 310, xp: 50, reward: 0, shownByZone: true },
  { key: "quest:a2", kind: "quest", ref: "a2", distanceM: 320, xp: 100, reward: 0 },
  { key: "zone:b", kind: "zone", ref: "b", distanceM: 50, xp: 200, reward: 0, locked: true },
  { key: "npc:x", kind: "npc", ref: "x", distanceM: 900, xp: 0, reward: 0 },
  { key: "community:bounty:c", kind: "community", ref: "bounty:c", distanceM: 700, xp: 0, reward: 1_500_000 },
  { key: "community:note:n", kind: "community", ref: "note:n", distanceM: Infinity, xp: 0, reward: 0 },
];
const keys = (list) => list.map((r) => r.key);

test("All lists every kind once, nearest first, locked rows last", () => {
  assert.deepEqual(keys(nearbyRows(rows, "all", "distance")), [
    "zone:a", "quest:a2", "community:bounty:c", "npc:x", "community:note:n", "zone:b",
  ]);
});

test("each filter keeps only its kind, including quests a place row shows", () => {
  assert.deepEqual(keys(nearbyRows(rows, "quests", "distance")), ["quest:a1", "quest:a2"]);
  assert.deepEqual(keys(nearbyRows(rows, "zones", "distance")), ["zone:a", "zone:b"]);
  assert.deepEqual(keys(nearbyRows(rows, "npcs", "distance")), ["npc:x"]);
  assert.deepEqual(keys(nearbyRows(rows, "community", "distance")), ["community:bounty:c", "community:note:n"]);
});

test("XP and reward sorts fall back to distance", () => {
  assert.deepEqual(keys(nearbyRows(rows, "all", "xp")).slice(0, 3), ["quest:a2", "zone:a", "community:bounty:c"]);
  assert.equal(nearbyRows(rows, "all", "reward")[0].key, "community:bounty:c");
});

test("counts match the chips and unknown values fall back", () => {
  assert.deepEqual(nearbyCounts(rows), { all: 6, zones: 2, quests: 2, npcs: 1, community: 2 });
  assert.equal(nearbyFilterOf("monsters"), "all");
  assert.equal(nearbySortOf(null), "distance");
  assert.equal(nearbySortOf("reward"), "reward");
});
