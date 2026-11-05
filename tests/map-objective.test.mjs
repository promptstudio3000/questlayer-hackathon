import test from "node:test";
import assert from "node:assert/strict";
import { mapObjective, OBJECTIVE_ORDER } from "../src/map-objective.ts";

test("a manual selection survives competing coach, receipt and recommendation updates", () => {
  assert.equal(mapObjective(Object.fromEntries(OBJECTIVE_ORDER.map(k => [k, true]))), "selection");
});
test("clearing an objective reveals the next actionable state without inventing one", () => {
  const states = { native: true, receipt: true, notice: true, coach: true, find: true, quest: true };
  for (const kind of OBJECTIVE_ORDER.slice(1)) {
    assert.equal(mapObjective(states), kind);
    states[kind] = false;
  }
  assert.equal(mapObjective(states), "empty");
  assert.equal(mapObjective({}), "empty");
});
