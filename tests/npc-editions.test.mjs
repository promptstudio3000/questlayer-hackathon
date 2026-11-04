// NPC- and monster-only Aura editions reach the wardrobe from their sources,
// once per player and edition, and secure on NEAR with the right claim prefix.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { claimQuest } from "../server/game.mjs";
import { createNpcService } from "../server/npc/service.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../server/actors/schema.mjs";
import { createHuntRewards } from "../server/actors/hunt/rewards.mjs";
import { AwardVouchers } from "../server/native/award-vouchers.mjs";
import {
  EARNED_EDITION_IDS,
  PILGRIM_LINES,
  awardEditionOnce,
  earnedEditions,
} from "../server/earned-editions.mjs";
import { AURA_CATALOG } from "../server/aura-catalog.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const DAY = "2026-11-02";
const RADA = { id: "rada", kind: "npc", archetype: "quest_giver", name: "Poutnice Ráda", persona: "poutnice-rada" };
const BELA = { id: "bela", kind: "npc", archetype: "storyteller", name: "Kronikářka Běla", persona: "kronikarka-bela" };
const wardrobe = (db, player) =>
  db.prepare("SELECT * FROM inventory WHERE player_id=? AND kind='aura' ORDER BY created_at").all(player);

async function fixture(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const player = createPlayer(db, "Walker", NOW);
  const world = await ensureWorld(db, HOME, true, NOW);
  let clock = NOW;
  const view = () => worldView(db, world.id, player, { now: clock });
  const service = createNpcService(db, {
    env: {},
    config: { provider: "template", perHour: 20, perMinute: 6, dailyCalls: 2000 },
    provider: null,
    clock: () => clock,
  });
  const finish = (offer) => {
    for (const step of offer.terms.steps) {
      clock += 1000;
      const q = view().quests.find((x) => x.id === step.questId);
      const at = q.nextPoint || q;
      try {
        claimQuest(db, player, q.id, { lat: at.lat, lng: at.lng, accuracy: 5 }, clock);
      } catch {
        db.prepare("INSERT INTO quest_claims VALUES (?,?,?)").run(q.id, player, clock);
      }
    }
  };
  return { db, player, view, service, finish };
}

function vouchersFor(db, player) {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run("walker.testnet", player, NOW);
  const native = {
    contractId: "nfts.questlayer-dev-20261101.testnet",
    view: async (method) =>
      method === "get_award_signer"
        ? publicKey
        : method === "supported_editions"
          ? AURA_CATALOG.map((e) => e.id)
          : method === "edition_minted"
            ? 0
            : null,
    claimSnapshot: async () => ({ tokenId: null, blockTimestampMs: NOW }),
  };
  const signer = { publicKey, sign: (m) => sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
  return new AwardVouchers(db, native, signer, { clock: () => NOW });
}

test("e2e: a storyteller chapter set ends with the Chronicle Crown in the wardrobe, claimable as earned:npc:", async (t) => {
  const { db, player, view, service, finish } = await fixture(t);
  let last;
  for (let chapter = 1; chapter <= 3; chapter++) {
    const offer = service.greet({ player, actor: BELA, world: view() }).menu[0];
    assert.ok(offer, `chapter ${chapter} on the menu`);
    assert.equal(offer.terms.chapter, chapter);
    service.accept({ player, actor: BELA, world: view(), offerId: offer.id });
    finish(offer);
    last = service.complete({ player, actor: BELA, world: view(), offerId: offer.id });
    assert.equal(last.state, "completed");
    if (chapter < 3) assert.equal(last.edition, undefined);
  }
  assert.equal(last.edition?.name, "Chronicle Crown");
  assert.equal(last.aura, null, "the Crown replaces the set's chest Aura the first time");
  const crown = wardrobe(db, player).find((i) => i.name === "Chronicle Crown");
  assert.ok(crown, "Chronicle Crown is in the wardrobe");
  assert.equal(crown.id, last.edition.id);
  assert.deepEqual(
    earnedEditions(db, player).map((e) => e.edition),
    ["chronicle"],
  );
  // Securing it on NEAR uses the award-signed redeem_aura claim with the NPC prefix.
  const claim = await vouchersFor(db, player).issue(player, crown.id, "walker.testnet");
  assert.equal(claim.edition, "chronicle");
  assert.match(claim.claim_id, /^earned:npc:aura_/);
  assert.ok(claim.signature);
});

test("the fifth quest-giver line adds Pilgrim's Path, once", async (t) => {
  const { db, player, view, service, finish } = await fixture(t);
  // Four lines turned in on earlier days (two per day is the cap).
  for (let i = 0; i < PILGRIM_LINES - 1; i++)
    db.prepare(
      "INSERT INTO actor_offers(id,actor_id,player_id,encounter_id,kind,terms,menu_hash,state,expires_at,created_at,completed_at) VALUES (?,?,?,?,?,?,?,'completed',?,?,?)",
    ).run(`quest:old${i}@${player}`, "rada", player, "direct", "quest", JSON.stringify({ worldId: "old", steps: [] }), "h", NOW, NOW - 86_400_000 * (i + 1), NOW - 86_400_000 * (i + 1));
  const menu = service.greet({ player, actor: RADA, world: view() }).menu;
  const first = menu[0];
  service.accept({ player, actor: RADA, world: view(), offerId: first.id });
  finish(first);
  const done = service.complete({ player, actor: RADA, world: view(), offerId: first.id });
  assert.equal(done.edition?.name, "Pilgrim's Path");
  assert.ok(wardrobe(db, player).some((i) => i.name === "Pilgrim's Path"));
  const second = service.greet({ player, actor: RADA, world: view() }).menu[0];
  if (second) {
    service.accept({ player, actor: RADA, world: view(), offerId: second.id });
    finish(second);
    assert.equal(service.complete({ player, actor: RADA, world: view(), offerId: second.id }).edition, undefined, "sixth line pays no second Pilgrim");
  }
  assert.equal(wardrobe(db, player).filter((i) => i.name === "Pilgrim's Path").length, 1);
});

test("first guardian win pays Wardbreaker, first Pocket Wisp win pays the Wisp Halo, once each", () => {
  const db = openDatabase(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Hunter");
  const win = (archetype, actorId, dayId = DAY) => ({ player: p, actorId, archetype, outcome: "won", dayId, element: "frost", finishedAt: NOW });
  assert.equal(rewards.onChallengeResult(win("roamer", "lickquidator-1")).edition, null);
  const g = rewards.onChallengeResult(win("guardian", "lick-brute-1"));
  assert.equal(g.edition?.edition, "wardbreaker");
  assert.equal(rewards.onChallengeResult(win("guardian", "lick-brute-2")).edition, null, "second guardian pays XP only");
  assert.equal(rewards.onChallengeResult(win("guardian", "lick-brute-1", "2026-11-03")).edition, null, "next day too");
  const l = rewards.onChallengeResult(win("lurker", "pocket-wisp-1"));
  assert.equal(l.edition?.edition, "wisp");
  assert.equal(rewards.onChallengeResult(win("lurker", "pocket-wisp-2")).edition, null);
  const names = wardrobe(db, p).map((i) => i.name).sort();
  assert.deepEqual(names, ["Wardbreaker Horns", "Will-o'-Wisp Halo"]);
});

test("awardEditionOnce: only NPC/monster/season editions, never twice, never after a sale, not when already held", () => {
  const db = openDatabase(":memory:");
  const p = createPlayer(db, "Collector"),
    q = createPlayer(db, "Buyer");
  assert.deepEqual([...EARNED_EDITION_IDS].sort(), ["bossbane", "chronicle", "ledger", "patron", "pilgrim", "season", "wardbreaker", "wisp"]);
  assert.equal(awardEditionOnce(db, p, "gold", "x", NOW), null, "chest editions are not awarded here");
  const item = awardEditionOnce(db, p, "bossbane", "monster:boss:w1", NOW);
  assert.equal(item.name, "Bossbane Fangring");
  // Sold or moved away: the source still never pays again.
  db.prepare("UPDATE inventory SET player_id=? WHERE id=?").run(q, item.id);
  assert.equal(awardEditionOnce(db, p, "bossbane", "monster:boss:w2", NOW + 1), null);
  // A player who already holds one from before this ledger is marked, not paid.
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run("old-ledger", q, "aura", "Merchant's Ledger", "epic", "below", "#e0a94a", 0, 1, NOW);
  assert.equal(awardEditionOnce(db, q, "ledger", "npc:vojtech", NOW), null);
  assert.deepEqual(earnedEditions(db, q).map((r) => ({ ...r })), [{ edition: "ledger", source: "held", itemId: "old-ledger", createdAt: NOW }]);
  // Sold out: no mark, so nothing is recorded as paid.
  db.prepare("UPDATE editions SET minted=max_supply WHERE name='Bossbane Fangring'").run();
  const r = createPlayer(db, "Latecomer");
  assert.equal(awardEditionOnce(db, r, "bossbane", "monster:boss:w3", NOW), null);
  assert.equal(earnedEditions(db, r).length, 0);
});
