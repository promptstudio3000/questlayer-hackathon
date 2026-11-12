// Irregular zone outlines and locked Tier 3 places (Lubos, 11 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { organicRing } from "../server/spatial/organic-shape.mjs";
import { tier3PoiIndex } from "../server/poi-quests.mjs";
import { TIER_STAKE_NEAR } from "../server/staker-gates.mjs";
import { TIER_NEAR } from "../src/tier-stake.ts";

const metres = (c, [lng, lat]) =>
  Math.hypot((lng - c.lng) * 111320 * Math.cos((c.lat * Math.PI) / 180), (lat - c.lat) * 110540);

test("an organic ring is closed, seeded and irregular within its bounds", () => {
  const c = { lat: 49.7475, lng: 13.3774 };
  const ring = organicRing(c, 40, "zone-a");
  assert.deepEqual(ring[0], ring.at(-1));
  assert.deepEqual(organicRing(c, 40, "zone-a"), ring);
  assert.notDeepEqual(organicRing(c, 40, "zone-b"), ring);
  const d = ring.map((p) => metres(c, p));
  assert.ok(Math.min(...d) > 40 * 0.72 && Math.max(...d) < 40 * 1.28);
  // Not a circle: the radius varies by more than a few metres.
  assert.ok(Math.max(...d) - Math.min(...d) > 6);
  // Wider than the 25 m visit check everywhere.
  assert.ok(Math.min(...d) > 25);
});

test("the Plzeň compact demo zones are not circles", () => {
  const layout = JSON.parse(readFileSync(new URL("../server/data/demo-zones/plzen-compact.json", import.meta.url), "utf8"));
  for (const z of layout.candidates) {
    const ring = z.geometry.coordinates[0];
    const cx = ring.slice(1).reduce((s, p) => s + p[0], 0) / (ring.length - 1),
      cy = ring.slice(1).reduce((s, p) => s + p[1], 0) / (ring.length - 1);
    const d = ring.map((p) => metres({ lng: cx, lat: cy }, p));
    assert.ok(Math.max(...d) / Math.min(...d) > 1.15, `${z.name} looks round`);
    assert.ok(z.targets.length >= 3, `${z.name} has targets`);
  }
});

test("one plain visit per street cell becomes the Tier 3 place", () => {
  const visit = { template: "poi-visit" };
  assert.equal(tier3PoiIndex([visit, visit]), -1);
  assert.equal(tier3PoiIndex([visit, { template: "poi-category-hunt" }, { ...visit, chest: true }]), 0);
  assert.equal(tier3PoiIndex([visit, visit, { template: "landmark-clue" }]), 1);
  assert.equal(tier3PoiIndex([{ template: "landmark-clue" }, { template: "poi-category-hunt" }, { ...visit, chest: true }]), -1);
});

test("the client's tier stake amounts match the server's", () => {
  assert.deepEqual({ ...TIER_NEAR }, { ...TIER_STAKE_NEAR });
});
