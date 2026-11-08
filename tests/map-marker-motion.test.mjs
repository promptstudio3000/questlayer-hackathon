import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// MapLibre places a Marker by writing `transform` on its root element. A CSS
// animation of `transform` on that same element overrides the position, and
// the marker flies between its spot and the map corner on load.
test("wearable find marker bobs without touching transform", () => {
  const css = readFileSync(new URL("../src/wearables.css", import.meta.url), "utf8");
  const bob = css.match(/@keyframes wearable-bob\s*\{[\s\S]*?\n\}/);
  assert.ok(bob, "wearable-bob keyframes exist");
  assert.doesNotMatch(bob[0], /transform\s*:/);
  assert.match(bob[0], /translate\s*:/);
});
