import test from "node:test";
import assert from "node:assert/strict";
import {
  AURA_EDITIONS,
  AURA_GRIDS,
  AURA_OUTLINE,
  AURA_SLOTS,
  auraEdition,
  auraMarkup,
  auraRects,
} from "../src/aura-art-data.ts";

const editions = [...AURA_EDITIONS, "unknown-edition", null, undefined];

test("every edition and slot renders a crisp-edged SVG on its authored grid", () => {
  for (const edition of editions)
    for (const slot of AURA_SLOTS)
      for (const size of [1, 2, 3]) {
        const markup = auraMarkup(edition, slot, "#ff6fb0", size),
          grid = AURA_GRIDS[slot];
        assert.ok(markup.startsWith("<svg"));
        assert.match(markup, /shape-rendering="crispEdges"/);
        assert.match(
          markup,
          new RegExp(`viewBox="0 0 ${grid.width} ${grid.height}"`),
        );
        assert.match(markup, new RegExp(`width="${grid.width * size}"`));
        assert.match(markup, new RegExp(`height="${grid.height * size}"`));
        assert.match(markup, new RegExp(`data-aura-slot="${slot}"`));
        assert.ok(markup.endsWith("</svg>"));
      }
  assert.equal(AURA_GRIDS.above.width, 48);
  assert.equal(AURA_GRIDS.above.height, 24);
  assert.equal(AURA_GRIDS.below.width, 56);
  assert.equal(AURA_GRIDS.below.height, 20);
});
test("pixels stay inside the grid on integer coordinates with the shared outline", () => {
  for (const edition of editions)
    for (const slot of AURA_SLOTS) {
      const rects = auraRects({ edition, slot, color: "#ff6fb0" }),
        grid = AURA_GRIDS[slot];
      assert.ok(rects.length > 20);
      for (const r of rects) {
        assert.ok([r.x, r.y, r.width, r.height].every(Number.isInteger));
        assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0);
        assert.ok(r.x + r.width <= grid.width && r.y + r.height <= grid.height);
        assert.match(r.color, /^#[A-Fa-f0-9]{6}$/);
      }
      const outline = rects.filter((r) => r.color === AURA_OUTLINE.color);
      assert.ok(outline.length > 0);
      assert.ok(outline.every((r) => r.opacity === AURA_OUTLINE.opacity));
      assert.ok(rects.some((r) => r.frame === "a"));
      assert.ok(rects.some((r) => r.frame === "b"));
    }
});
test("authored editions differ from each other; unknown editions fall back to the colour design", () => {
  for (const slot of AURA_SLOTS) {
    const shapes = AURA_EDITIONS.map((edition) =>
      JSON.stringify(auraRects({ edition, slot }).map((r) => [r.x, r.y, r.width])),
    );
    assert.equal(new Set(shapes).size, AURA_EDITIONS.length);
    const unknown = auraMarkup("festival", slot, "#ff6fb0"),
      generic = auraMarkup(null, slot, "#ff6fb0");
    assert.equal(unknown, generic);
    assert.match(unknown, /data-aura-edition="generic"/);
    assert.match(unknown, /#FF6FB0/);
    assert.notEqual(
      auraMarkup(null, slot, "#ff6fb0"),
      auraMarkup(null, slot, "#51b4ba"),
    );
    assert.doesNotMatch(auraMarkup("polar", slot, "#ff6fb0"), /#FF6FB0/);
    assert.match(auraMarkup(null, slot, "not a colour"), /data-aura-edition="generic"/);
  }
  assert.equal(auraMarkup("gold", "sideways"), auraMarkup("gold", "above"));
  assert.equal(auraMarkup("gold", "above", null, 1.5), auraMarkup("gold", "above"));
});
test("markup is inert: rects only, no scripts, handlers or external references", () => {
  for (const edition of editions)
    for (const slot of AURA_SLOTS) {
      const markup = auraMarkup(edition, slot, "#ff6fb0", 2);
      assert.doesNotMatch(markup, /<script/i);
      assert.doesNotMatch(markup, /\bon[a-z]+=/i);
      assert.doesNotMatch(markup, /href|xlink|url\(|http|<image|<use|<foreignObject/i);
      assert.deepEqual(
        [...new Set(markup.match(/<[a-z]+/gi))].sort(),
        ["<g", "<rect", "<svg"],
      );
    }
});
test("items resolve to their authored edition by edition, name or verified colour", () => {
  assert.equal(auraEdition({ edition: "moon" }), "moon");
  assert.equal(auraEdition({ name: "Northern Lights" }), "polar");
  assert.equal(auraEdition({ name: "Moon Ring" }), "moon");
  assert.equal(auraEdition({ name: "Golden Dust" }), "gold");
  assert.equal(auraEdition({ color: "#9EDFC5" }), "polar");
  assert.equal(auraEdition({ color: "#b49beb" }), "moon");
  assert.equal(auraEdition({ name: "Festival Aura", color: "#ff6fb0" }), null);
  assert.equal(auraEdition({}), null);
});
