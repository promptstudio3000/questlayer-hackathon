import test from "node:test";
import assert from "node:assert/strict";
import { dialogTabBoundary } from "../src/dialog-focus.ts";

test("Tab and Shift-Tab wrap both native dialog boundaries", () => {
  const first = {},
    middle = {},
    last = {},
    stops = [first, middle, last];
  assert.equal(dialogTabBoundary(stops, last, false), first);
  assert.equal(dialogTabBoundary(stops, first, true), last);
  assert.equal(dialogTabBoundary(stops, middle, false), null);
  assert.equal(dialogTabBoundary(stops, middle, true), null);
});
test("an initially focused heading or removed control enters the live tab order", () => {
  const first = {},
    last = {},
    stops = [first, last];
  for (const active of [null, {}]) {
    assert.equal(dialogTabBoundary(stops, active, false), first);
    assert.equal(dialogTabBoundary(stops, active, true), last);
  }
});
test("single-control and temporarily empty dialogs never request an outside focus target", () => {
  const only = {};
  assert.equal(dialogTabBoundary([only], only, false), only);
  assert.equal(dialogTabBoundary([only], only, true), only);
  assert.equal(dialogTabBoundary([], null, false), null);
});
