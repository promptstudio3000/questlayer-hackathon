// MapLibre positions markers with position:absolute + an inline transform.
// A marker class with position:relative puts markers back into normal flow,
// so NPCs, monsters and places stack by a fixed pixel offset and drift on zoom.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("every map marker keeps MapLibre's absolute anchoring", () => {
  assert.match(
    css("style.css"),
    /\.maplibregl-map \.maplibregl-marker \{\s*position: absolute;\s*top: 0;\s*left: 0;/,
  );
});

test("actor markers do not reset their position", () => {
  const rule = css("actors.css").match(/\.actor-marker \{[^}]*\}/)?.[0] || "";
  assert.ok(rule, "missing .actor-marker rule");
  assert.doesNotMatch(rule, /position:/);
});
