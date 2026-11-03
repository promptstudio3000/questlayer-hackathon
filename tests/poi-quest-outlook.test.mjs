// First session outside Plzeň: the coach's "nearest quest" line and the
// chest hint for POI street cells (scripts/e2e-world-journeys.mjs covers the
// browser side).
import test from "node:test";
import assert from "node:assert/strict";
import { guideHint } from "../server/ai/guide.mjs";
import { poiQuestOutlook } from "../src/nearest-discovery.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const HERE = { lat: 49.19522, lng: 16.60796 };
const zone = (id, lat, lng, extra = {}) => ({
  id,
  name: id,
  lat,
  lng,
  radius: 0,
  tier: 1,
  kind: "discovery",
  source: "poi",
  opensAt: NOW - 3_600_000,
  closesAt: NOW + 3_600_000,
  color: "#258b73",
  ...extra,
});
const quest = (id, z, extra = {}) => ({
  id,
  zone_id: z.id,
  title: `Visit ${z.name}`,
  kind: "visit",
  lat: z.lat,
  lng: z.lng,
  tier: 1,
  completed: false,
  opens_at: NOW - 3_600_000,
  closes_at: NOW + 3_600_000,
  ...extra,
});

test("the coach points at the nearest open POI quest", () => {
  const near = zone("Orloj", 49.1953, 16.608),
    far = zone("Lužánky", 49.2067, 16.6089),
    reviewed = zone("Plaza", 49.19523, 16.60797, { source: "city" });
  const out = poiQuestOutlook({
    position: HERE,
    zones: [near, far, reviewed],
    quests: [quest("q-far", far), quest("q-near", near), quest("q-r", reviewed)],
    tier: 1,
    now: NOW,
  });
  assert.equal(out.state, "open");
  assert.equal(out.nearest.quest.id, "q-near", "reviewed-city zones are not POI");
  assert.ok(out.nearest.distance < 20);
  // Done or above the player's tier: the next one wins.
  const next = poiQuestOutlook({
    position: HERE,
    zones: [near, far],
    quests: [
      quest("q-near", near, { completed: true }),
      quest("q-tier", near, { tier: 3 }),
      quest("q-far", far),
    ],
    tier: 1,
    now: NOW,
  });
  assert.equal(next.nearest.quest.id, "q-far");
});

test("before play hours, in an empty cell and when all done the coach says so", () => {
  const z = zone("Náves", 48.9696, 14.2736);
  const later = poiQuestOutlook({
    position: HERE,
    zones: [z],
    quests: [quest("q", z, { opens_at: NOW + 5 * 3_600_000, closes_at: NOW + 9 * 3_600_000 })],
    tier: 1,
    now: NOW,
  });
  assert.deepEqual(later, { state: "later", opensAt: NOW + 5 * 3_600_000 });
  assert.deepEqual(
    poiQuestOutlook({ position: HERE, zones: [], quests: [], tier: 1, now: NOW, emptyCell: true }),
    { state: "empty" },
  );
  assert.deepEqual(
    poiQuestOutlook({
      position: HERE,
      zones: [z],
      quests: [quest("q", z, { completed: true })],
      tier: 1,
      now: NOW,
    }),
    { state: "none" },
  );
});

test("chest hint names the opening time in a POI cell and the empty cell truthfully", () => {
  const opens = Date.parse("2026-11-03T07:00:00Z"); // 08:00 Prague
  const world = {
    timezone: "Europe/Prague",
    playerTier: 1,
    zones: [{ id: "z", name: "Brněnský orloj" }],
    quests: [
      {
        id: "c",
        zone_id: "z",
        kind: "chest",
        tier: 1,
        completed: false,
        opens_at: opens,
        closes_at: Date.parse("2026-11-03T19:00:00Z"),
        lat: 49.1953,
        lng: 16.608,
      },
    ],
    coins: [],
  };
  const early = guideHint("chest", {
    world,
    location: HERE,
    now: Date.parse("2026-11-03T01:00:00Z"),
  });
  assert.equal(
    early.hint,
    "The chest at Brněnský orloj opens at 08:00. Pick up street coins until then.",
  );
  const empty = guideHint("chest", {
    world: { ...world, quests: [], zones: [], poiQuests: { status: "empty", count: 0 } },
    location: HERE,
    now: NOW,
  });
  assert.match(empty.hint, /^No chest in this spot today\./);
});
