import test from "node:test";
import assert from "node:assert/strict";
import { mapObjective, OBJECTIVE_ORDER, canOfferNearbyAction } from "../src/map-objective.ts";

test("a manual selection survives competing coach, receipt and recommendation updates", () => {
  assert.equal(mapObjective(Object.fromEntries(OBJECTIVE_ORDER.map(k => [k, true]))), "selection");
});

test("a started NPC or map activity keeps the goal until its own nearby target is ready", () => {
  assert.equal(canOfferNearbyAction("selection", undefined, false, true, false), false);
  assert.equal(canOfferNearbyAction("selection", undefined, false, true, true), true);
  assert.equal(canOfferNearbyAction("selection", undefined, true, true, false), true);
  assert.equal(canOfferNearbyAction("selection", undefined, false, false, false), true);
});
test("clearing an objective reveals the next actionable state without inventing one", () => {
  const states = { native: true, receipt: true, notice: true, away: true, coach: true, find: true, quest: true };
  for (const kind of OBJECTIVE_ORDER.slice(1)) {
    assert.equal(mapObjective(states), kind);
    states[kind] = false;
  }
  assert.equal(mapObjective(states), "empty");
  assert.equal(mapObjective({}), "empty");
});

test("nearby actors cannot block wearing the first Aura, sharing it, finishing the guide or reading a receipt", () => {
  for (const step of ["aura", "secure", undefined]) assert.equal(canOfferNearbyAction("coach", step), false);
  for (const goal of ["receipt", "notice"]) assert.equal(canOfferNearbyAction(goal, "find"), false);
  for (const step of ["find", "coin", "chest"]) assert.equal(canOfferNearbyAction("coach", step), true);
  assert.equal(canOfferNearbyAction("selection", "chest"), true);
  assert.equal(canOfferNearbyAction("quest"), true);
  for (const goal of ["coach", "receipt", "notice"]) assert.equal(canOfferNearbyAction(goal, "aura", true), true, "Explicitly dismissing the current card reveals nearby actions without cancelling progress");
});
