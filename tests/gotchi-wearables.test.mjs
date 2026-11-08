import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import { updatePresence } from "../server/presence.mjs";
import { publicAppearance } from "../server/appearance.mjs";
import { SocialContent } from "../server/social-content.mjs";
import {
  WEARABLES,
  WEARABLE_FINDS_PER_WORLD,
  VERIFIED_FOR_MS,
  wearableForSeed,
  wearableFinds,
  wardrobe,
  equipWearable,
  wornWearables,
} from "../server/gotchi-wearables.mjs";
import { playerCard, sendWave, takeWaves, WAVE_LIMITS } from "../server/player-waves.mjs";
import { streetFindIds } from "../server/street-finds.mjs";
import { wearableStarterMarkup, characterMarkerMarkup } from "../src/character-art.ts";

const now = Date.parse("2026-11-04T12:00:00Z");
const share = (db, player, at = now, arena = true) => {
  updatePresence(db, player, { enabled: true, renew: true, leaseId: "l1", lat: HOME.lat, lng: HOME.lng, arena }, at);
};
const link = (db, player, itemIds, at = now, address = "0x" + "a".repeat(40)) =>
  db
    .prepare("INSERT OR REPLACE INTO external_links VALUES (?,?,?,?)")
    .run(
      address,
      player,
      JSON.stringify({
        gotchis: [],
        wearables: itemIds.map((itemId) => ({ itemId: String(itemId), quantity: "1" })),
        verifiedAt: at,
      }),
      at,
    );

test("catalog holds the official wearables with slot, rarity and canvas placement", () => {
  assert.ok(WEARABLES.size >= 250);
  const hat = WEARABLES.get(1);
  assert.equal(hat.name, "Camo Hat");
  assert.equal(hat.slot, "head");
  for (const w of WEARABLES.values()) {
    assert.ok(["head", "face", "eyes", "body", "hand", "pet"].includes(w.slot));
    assert.ok(w.dims.every((n) => Number.isInteger(n) && n >= 0 && n <= 64));
  }
});

test("drops are deterministic and mostly common, rarely godlike", () => {
  assert.equal(wearableForSeed("x:coin:1").id, wearableForSeed("x:coin:1").id);
  const counts = {};
  for (let i = 0; i < 4000; i++) {
    const r = wearableForSeed(`w:coin:${i}`).rarity;
    counts[r] = (counts[r] || 0) + 1;
  }
  assert.ok(counts.common > counts.rare && counts.rare > counts.mythical);
  assert.ok((counts.godlike || 0) < 120);
});

test("wearable finds sit on street finds, show on the map and give a clone once", async () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const w = await ensureWorld(db, HOME, true, now);
  const finds = wearableFinds(db, w.id);
  const street = streetFindIds(db, w.id);
  assert.ok(finds.size > 0 && finds.size <= WEARABLE_FINDS_PER_WORLD);
  for (const id of finds.keys()) assert.ok(street.has(id));
  const view = worldView(db, w.id);
  const coin = view.coins.find((c) => c.wearable);
  assert.ok(coin, "the map shows a wearable find");
  assert.equal(coin.find, true);
  assert.equal(coin.wearable.id, finds.get(coin.id).id);
  const r = claimCoin(db, a, coin.id, coin, now);
  assert.equal(r.wearable.id, coin.wearable.id);
  assert.equal(r.wearable.duplicate, false);
  const mine = wardrobe(db, a, now);
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].source, "find");
  assert.equal(mine.items[0].verified, false);
  // Another explorer picking up the same item id elsewhere would be a duplicate.
  assert.equal(claimCoin(db, a, coin.id, coin, now).alreadyClaimed, true);
});

test("a linked wallet holding the original turns the clone gold-verified, for a day", () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  link(db, a, [1, 99999]);
  const mine = wardrobe(db, a, now);
  assert.deepEqual(mine.items.map((i) => [i.id, i.source, i.verified]), [[1, "original", true]]);
  assert.equal(wardrobe(db, a, now + VERIFIED_FOR_MS + 1).items[0].verified, false);
});

test("one wearable per slot; worn items reach the public appearance", async () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const hats = [...WEARABLES.values()].filter((w) => w.slot === "head").slice(0, 2).map((w) => w.id);
  link(db, a, hats);
  await assert.rejects(async () => equipWearable(db, a, 3, true, now), /Find this wearable/);
  equipWearable(db, a, hats[0], true, now);
  equipWearable(db, a, hats[1], true, now);
  const worn = wornWearables(db, a, now);
  assert.deepEqual(worn.map((w) => w.id), [hats[1]]);
  assert.equal(worn[0].verified, true);
  const row = db.prepare("SELECT * FROM players WHERE id=?").get(a);
  const look = await publicAppearance(db, row, null, { now });
  assert.deepEqual(look.wearables, [{ id: hats[1], slot: "head", dims: WEARABLES.get(hats[1]).dims, verified: true }]);
  assert.equal(JSON.stringify(look).includes("0xaaaa"), false, "no wallet address");
  equipWearable(db, a, hats[1], false, now);
  assert.deepEqual(wornWearables(db, a, now), []);
});

test("explorer card needs sharing and no block; waves are preset, both sharing, rate limited", () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now),
    b = createPlayer(db, "Bob", now);
  assert.throws(() => playerCard(db, a, b, null, now), /no longer sharing/);
  share(db, b);
  const card = playerCard(db, a, b, null, now);
  assert.equal(card.name, "Bob");
  assert.equal(card.canWave, false);
  assert.match(card.waveHint, /Share your position/);
  assert.throws(() => sendWave(db, a, b, "hello", now), /Share your position/);
  share(db, a);
  assert.equal(playerCard(db, a, b, null, now).canWave, true);
  assert.throws(() => sendWave(db, a, b, "call me 555", now), /ready phrases/);
  assert.deepEqual(sendWave(db, a, b, "hello", now), { sent: true, phrase: "Hello!" });
  assert.throws(() => sendWave(db, a, b, "thanks", now + 1000), /Give them a minute/);
  const inbox = takeWaves(db, b, now + 2000);
  assert.deepEqual(inbox.map((w) => [w.name, w.text]), [["Alice", "Hello!"]]);
  assert.deepEqual(takeWaves(db, b, now + 3000), [], "read once");
  const later = now + WAVE_LIMITS.pairMs + 1;
  share(db, a, later);
  share(db, b, later);
  sendWave(db, a, b, "thanks", later);
  // A block hides the card, stops waves both ways and drops unread ones.
  new SocialContent(db).setBlock(b, a, true);
  assert.equal(takeWaves(db, b, later + 1).length, 0);
  assert.throws(() => playerCard(db, a, b, null, later + 5), /no longer sharing/);
  assert.throws(() => sendWave(db, b, a, "hello", later + 10), /no longer sharing/);
});

test("starter markup layers wearables by slot at their canvas place and rejects bad input", () => {
  const svg = wearableStarterMarkup([
    { id: 1, slot: "head", dims: [15, 2, 34, 20] },
    { id: 2, slot: "body", dims: [15, 41, 34, 14] },
    { id: 3, slot: "hand", dims: [5, 31, 99, 11] },
  ]);
  assert.ok(svg.indexOf("/api/wearables/art/2.svg") < svg.indexOf("/api/wearables/art/1.svg"));
  assert.ok(svg.includes('x="15" y="2" width="34" height="20"'));
  assert.ok(!svg.includes("/art/3.svg"), "out-of-canvas dims are dropped");
  assert.ok(!characterMarkerMarkup({ wearables: [{ id: 1, slot: "head", dims: [1, 1, 1, 1] }], skinUrl: "/api/aavegotchi/skin?tokenId=5" }).includes("/art/1.svg"));
});
