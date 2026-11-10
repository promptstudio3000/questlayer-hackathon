import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWearablesSchema } from "../server/gotchi-wearables.mjs";
import {
  outfitEquipped,
  ownedItemIds,
  setOutfitSlot,
  ownedOutfit,
  GotchiOutfitArt,
} from "../server/gotchi-outfit.mjs";

const now = Date.parse("2026-11-10T12:00:00Z");
const address = "0x" + "b".repeat(40);
const link = (db, player, itemIds, at = now) =>
  db
    .prepare("INSERT OR REPLACE INTO external_links VALUES (?,?,?,?)")
    .run(
      address,
      player,
      JSON.stringify({ gotchis: [], wearables: itemIds.map((itemId) => ({ itemId: String(itemId), quantity: "1" })), verifiedAt: at }),
      at,
    );
const wear = (db, player, appearance = { originTokenId: "1126", address }) =>
  db.prepare("UPDATE players SET appearance=? WHERE id=?").run(JSON.stringify(appearance), player);
const find = (db, player, itemId) => {
  ensureWearablesSchema(db);
  db.prepare("INSERT INTO wearable_clones(player_id,item_id,source,equipped,created_at) VALUES(?,?,?,?,?)").run(
    player,
    itemId,
    "find",
    0,
    now,
  );
};

test("the outfit overrides only slots 0-6 of the gotchi's own gear", () => {
  const gotchi = { equipped: [2, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9] };
  const ids = outfitEquipped(gotchi, { 3: 221, 4: 0, 15: 7, x: 5 });
  assert.equal(ids.length, 16);
  assert.deepEqual(ids.slice(0, 7), [2, 0, 0, 221, 0, 0, 0]);
  assert.equal(ids[15], 9);
  assert.deepEqual(outfitEquipped(null).every((n) => n === 0), true);
});

test("owned items are map clones and originals verified within a day", () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  find(db, a, 4);
  link(db, a, [1]);
  assert.deepEqual([...ownedItemIds(db, a, now)].sort(), [1, 4]);
  assert.deepEqual([...ownedItemIds(db, a, now + 25 * 3600_000)], [4]);
});

test("a slot takes only an owned item that fits, on a worn original", () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  link(db, a, [1, 2]);
  assert.throws(() => setOutfitSlot(db, a, "head", 1, now), /Wear one of your Aavegotchis/);
  wear(db, a);
  assert.throws(() => setOutfitSlot(db, a, "tail", 1, now), /Unknown slot/);
  assert.throws(() => setOutfitSlot(db, a, "body", 1, now), /does not fit/);
  assert.throws(() => setOutfitSlot(db, a, "head", 4, now), /Find this wearable/);
  assert.deepEqual(setOutfitSlot(db, a, "head", 1, now).outfit, { 3: 1 });
  assert.deepEqual(setOutfitSlot(db, a, "body", 0, now).outfit, { 3: 1, 0: 0 });
  setOutfitSlot(db, a, "head", null, now);
  const next = setOutfitSlot(db, a, "body", null, now);
  assert.equal(next.outfit, undefined);
  assert.equal(next.originTokenId, "1126");
});

test("items no longer owned fall out of the outfit", () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  link(db, a, [1]);
  find(db, a, 2);
  const outfit = { 3: 1, 0: 2, 4: 0 };
  assert.deepEqual(ownedOutfit(db, a, outfit, now), outfit);
  assert.deepEqual(ownedOutfit(db, a, outfit, now + 25 * 3600_000), { 0: 2, 4: 0 });
  assert.deepEqual(ownedOutfit(db, a, null, now), {});
});

test("outfit art is cached per outfit and falls back to the plain art", async () => {
  let calls = 0;
  const art = new GotchiOutfitArt({
    render: async (preview, equipped) => {
      calls++;
      if (equipped[3] === 666) throw new Error("rpc down");
      return `<svg data-hat="${equipped[3]}"/>`;
    },
  });
  const gotchi = { tokenId: "1126", svg: "<svg plain/>", equipped: [], preview: { hauntId: 1, collateral: "0x0", traits: [] } };
  assert.equal(await art.svg(gotchi, {}), "<svg plain/>");
  assert.equal(await art.svg(gotchi, { 3: 221 }), '<svg data-hat="221"/>');
  assert.equal(await art.svg(gotchi, { 3: 221 }), '<svg data-hat="221"/>');
  assert.equal(calls, 1);
  assert.equal(await art.svg(gotchi, { 3: 666 }), "<svg plain/>");
  assert.equal(await art.svg({ ...gotchi, preview: null }, { 3: 221 }), "<svg plain/>");
  assert.equal(await art.svg(null, { 3: 1 }), null);
});

test("the profile shows the outfit: found clones without the gold seal, the dress state only to its owner", async () => {
  const { playerCard } = await import("../server/player-waves.mjs");
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const b = createPlayer(db, "Bob", now);
  const gotchi = { tokenId: "1126", name: "Coinmandeer", brs: 630, svg: "<svg/>", equipped: [2, 0, 0, 1, 0, 0, 0], preview: null };
  db.prepare("INSERT INTO external_links VALUES (?,?,?,?)").run(
    address,
    a,
    JSON.stringify({ gotchis: [gotchi], wearables: [{ itemId: "2", quantity: "1" }], verifiedAt: now }),
    now,
  );
  find(db, a, 4);
  wear(db, a);
  setOutfitSlot(db, a, "head", 4, now);
  const own = playerCard(db, a, a, null, now);
  const head = own.slots.find((s) => s.slot === "head").item;
  assert.equal(head.id, 4);
  assert.equal(head.verified, false);
  assert.equal(own.slots.find((s) => s.slot === "body").item.verified, true);
  assert.deepEqual(own.dress, { gotchi: true, dressed: ["head"] });
  assert.equal(own.look, "3.4");
  const seen = playerCard(db, b, a, null, now);
  assert.equal(seen.dress, null);
  assert.equal(seen.slots.find((s) => s.slot === "head").item.id, 4);
});
