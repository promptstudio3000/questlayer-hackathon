import test from "node:test";
import assert from "node:assert/strict";
import {
  adventureStorageKey,
  parseAdventureSelection,
  resolveAdventureSelection,
} from "../src/adventure-selection.ts";

const now = Date.parse("2026-10-31T12:00:00Z");
function fixture() {
  const reference = {
    version: 1,
    playerId: "explorer-a",
    realm: "arena",
    worldId: "demo:plzen:2026-10-31",
    zoneId: "park",
    questId: "trail",
  };
  const world = {
    id: reference.worldId,
    arena: true,
    endsAt: now + 3600000,
    zones: [{ id: "park", name: "Chvojkovy lomy", closesAt: now + 1800000 }],
    quests: [
      {
        id: "trail",
        zone_id: "park",
        checkpoint: 1,
        completed: 0,
        claimant: null,
        closes_at: now + 900000,
      },
    ],
  };
  return { reference, world };
}
const resolve = (r, w, time = now) =>
  resolveAdventureSelection(r, w, "explorer-a", true, time);

test("a reload bookmark restores identities from fresh server data, not saved rewards or coordinates", () => {
  const { reference, world } = fixture();
  const saved = parseAdventureSelection(
    JSON.stringify({ ...reference, lat: 1, gold_u: 999999, completed: 1 }),
    "explorer-a",
    true,
  );
  assert.deepEqual(saved, reference);
  assert.equal(resolve(saved, world).quest, world.quests[0]);
  assert.equal(resolve(saved, world).zone, world.zones[0]);
});

test("player, realm and schema boundaries reject foreign or corrupted bookmarks", () => {
  const { reference } = fixture();
  const raw = JSON.stringify(reference);
  assert.equal(parseAdventureSelection(raw, "explorer-b", true), null);
  assert.equal(parseAdventureSelection(raw, "explorer-a", false), null);
  for (const broken of [
    null,
    "{",
    "null",
    "[]",
    "x".repeat(4097),
    JSON.stringify({ ...reference, version: 2 }),
    JSON.stringify({ ...reference, questId: 0 }),
  ])
    assert.equal(parseAdventureSelection(broken, "explorer-a", true), null);
  assert.notEqual(
    adventureStorageKey("explorer-a", true),
    adventureStorageKey("explorer-b", true),
  );
  assert.notEqual(
    adventureStorageKey("explorer-a", true),
    adventureStorageKey("explorer-a", false),
  );
});

test("loading, failed reads and an old realm snapshot do not invalidate a bookmark", () => {
  const { reference, world } = fixture();
  assert.equal(resolve(reference, null).status, "waiting");
  assert.equal(
    resolve(reference, { ...world, arena: false }).status,
    "waiting",
  );
  assert.equal(resolve(reference, world).status, "ready");
});

test("day rollover, expired targets and removed content stop presenting the old objective", () => {
  const { reference, world } = fixture();
  for (const changed of [
    { ...world, id: "tomorrow" },
    { ...world, endsAt: now },
    { ...world, zones: [] },
    { ...world, quests: [] },
    { ...world, zones: [{ ...world.zones[0], closesAt: now }] },
    { ...world, quests: [{ ...world.quests[0], closes_at: now }] },
  ]) {
    const result = resolve(reference, changed);
    assert.equal(result.status, "unavailable");
    assert.equal(result.zone, null);
    assert.equal(result.quest, null);
  }
});

test("a checkpoint refresh and a competing shared claim retain the selected activity with authoritative status", () => {
  const { reference, world } = fixture();
  const refreshed = structuredClone(world);
  Object.assign(refreshed.quests[0], { checkpoint: 2, claimant: "explorer-b" });
  assert.equal(resolve(reference, refreshed).quest.checkpoint, 2);
  assert.equal(resolve(reference, refreshed).quest.claimant, "explorer-b");
  refreshed.quests[0].completed = 1;
  assert.equal(resolve(reference, refreshed).quest.completed, 1);
  assert.equal(world.quests[0].checkpoint, 1);
});

test("bookmarks cannot attach an activity to a different zone or account", () => {
  const { reference, world } = fixture();
  assert.equal(
    resolve({ ...reference, playerId: "explorer-b" }, world).status,
    "unavailable",
  );
  assert.equal(
    resolve({ ...reference, realm: "gps" }, world).status,
    "unavailable",
  );
  assert.equal(
    resolve(reference, {
      ...world,
      quests: [{ ...world.quests[0], zone_id: "other-park" }],
    }).status,
    "unavailable",
  );
});

test("zone-only selection stays valid before opening and does not choose a different activity", () => {
  const { reference, world } = fixture();
  const result = resolve({ ...reference, questId: null }, world);
  assert.equal(result.status, "ready");
  assert.equal(result.quest, null);
  assert.equal(resolve(null, world).status, "empty");
});
