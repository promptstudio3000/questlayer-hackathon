import test from "node:test";
import assert from "node:assert/strict";
import {
  adventureResultScope,
  belongsToAdventureScope,
  adventureItemForEquip,
  createAdventureReadContext,
  isFreshAdventureRead,
} from "../src/adventure-results.ts";

const item = {
  id: "aura-precise-identity",
  kind: "aura",
  name: "River Light",
  rarity: "uncommon",
  slot: "above",
  color: "#51B4BA",
  serial: 17,
  equipped: 0,
};
const player = { id: "river-explorer", inventory: [item] };
const result = {
  id: "receipt",
  version: 1,
  domain: "demo",
  source: "system-quest",
  status: "confirmed",
  playerId: player.id,
  realm: "arena",
  reward: { xp: 80, goldU: 0, item },
  itemCurrent: { status: "owned", equippable: true, equipped: false },
};

test("result recovery is scoped to the actual actor, realm and demo reward domain", () => {
  assert.notEqual(
    adventureResultScope(player.id, "arena", true),
    adventureResultScope(player.id, "gps", true),
  );
  assert.notEqual(
    adventureResultScope(player.id, "arena", true),
    adventureResultScope("other-explorer", "arena", true),
  );
  assert.equal(adventureResultScope(player.id, "arena", false), "");
  assert.equal(adventureResultScope(undefined, "arena", true), "");
  for (const change of [
    { playerId: "other-explorer" },
    { realm: "gps" },
    { domain: "native" },
    { source: "creator" },
    { version: 2 },
  ]) {
    assert.equal(
      belongsToAdventureScope({ ...result, ...change }, player.id, "arena"),
      false,
    );
    assert.equal(
      adventureItemForEquip({ ...result, ...change }, player, "arena"),
      null,
    );
  }
});

test("returning to an actor or realm never reopens an old result or revives an old response", () => {
  const model = createAdventureReadContext();
  const first = model.update("actor-a/arena", true);
  model.update("actor-b/arena", true);
  const returned = model.update("actor-a/arena", true);
  assert.notEqual(first.scope, returned.scope);
  assert.equal(isFreshAdventureRead(first, returned), false);
  model.update("actor-a/gps", true);
  const arenaAgain = model.update("actor-a/arena", true);
  assert.notEqual(returned.scope, arenaAgain.scope);
  model.update("", true);
  const demoAgain = model.update("actor-a/arena", true);
  assert.notEqual(arenaAgain.scope, demoAgain.scope);
});

test("reconnecting preserves the historical result but requires a fresh ownership check", () => {
  const model = createAdventureReadContext();
  const checked = model.update("actor-a/arena", true);
  assert.equal(isFreshAdventureRead(checked, checked), true);
  const offline = model.update("actor-a/arena", false);
  assert.equal(offline.scope, checked.scope);
  assert.equal(isFreshAdventureRead(checked, offline), false);
  const reconnected = model.update("actor-a/arena", true);
  assert.equal(reconnected.scope, checked.scope);
  assert.equal(isFreshAdventureRead(checked, reconnected), false);
  assert.equal(isFreshAdventureRead(reconnected, reconnected), true);
});

test("an actively selected native outfit can be deliberately replaced by a recorded owned demo Aura", () => {
  const wearing = {
    ...player,
    nativeOutfit: true,
    inventory: [{ ...item, equipped: 1 }],
  };
  assert.equal(adventureItemForEquip(result, wearing, "arena")?.id, item.id);
});

test("an exact old award cannot authorize equipping a transferred, listed, reserved or native-minted item", () => {
  assert.equal(adventureItemForEquip(result, player, "arena")?.id, item.id);
  for (const status of [
    "none",
    "listed",
    "reserved",
    "minted",
    "not-owned",
    "missing",
  ])
    assert.equal(
      adventureItemForEquip(
        { ...result, itemCurrent: { ...result.itemCurrent, status } },
        player,
        "arena",
      ),
      null,
    );
  for (const changed of [
    { ...item, id: "same-name-different-id" },
    { ...item, native_claim_id: "voucher" },
    { ...item, native_token_id: "native-token" },
    { ...item, equipped: 1 },
  ])
    assert.equal(
      adventureItemForEquip(
        result,
        { ...player, inventory: [changed] },
        "arena",
      ),
      null,
    );
  assert.equal(
    adventureItemForEquip(result, { ...player, inventory: [] }, "arena"),
    null,
  );
  assert.equal(
    adventureItemForEquip(
      { ...result, itemCurrent: { ...result.itemCurrent, equippable: false } },
      player,
      "arena",
    ),
    null,
  );
});

test("zero-item results remain inspectable without fabricating equipment", () => {
  for (const receipt of [
    null,
    { ...result, reward: { xp: 50, goldU: 0, item: null } },
  ])
    assert.equal(adventureItemForEquip(receipt, player, "arena"), null);
  assert.equal(
    adventureItemForEquip(
      { ...result, itemCurrent: { ...result.itemCurrent, equipped: true } },
      player,
      "arena",
    ),
    null,
  );
});
