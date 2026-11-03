// NPC- and monster-only Aura editions (catalog `source` npc/monster, PR #52):
// one award per player per edition, ever. The row in earned_editions is the
// durable "already earned" mark, so selling, transferring or securing the
// Aura on NEAR never makes the source pay it again. The Aura lands in the
// game inventory (the wardrobe); the player secures it on NEAR through the
// ordinary award-signed redeem_aura claim, whose claim id prefix
// (earned:npc: / earned:monster:) comes from awardClaimPrefix().
//
// Sources (docs/NPC-PLAN.md §7, §13.4; docs/ASSET-CATALOG.md):
//   pilgrim     5 quest-giver lines turned in            server/npc/service.mjs
//   chronicle   first storyteller chapter set finished   server/npc/service.mjs
//   ledger      10 settled trades with one trader         server/npc/trader.mjs
//   wisp        first Pocket Wisp mini-game win           server/actors/hunt/rewards.mjs
//   wardbreaker first zone guardian win                   server/actors/hunt/rewards.mjs
//   bossbane    3+ landed hits on a defeated weekly boss  server/actors/hunt/boss.mjs
//   season      the hackathon season goal                 server/season/service.mjs
import { id } from "./domain.mjs";
import { AURA_CATALOG, AURA_SUPPLY } from "./aura-catalog.mjs";
import { history } from "./database.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "./schema-compatibility.mjs";

export const EARNED_EDITIONS_SCHEMA = registerModuleSchema({
  name: "earned-editions",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS earned_editions(player_id TEXT NOT NULL,edition TEXT NOT NULL,source TEXT NOT NULL,item_id TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,edition))`,
});

export const PILGRIM_LINES = 5;
export const EARNED_EDITION_IDS = Object.freeze(
  AURA_CATALOG.filter((e) => ["npc", "monster", "season"].includes(e.source)).map((e) => e.id),
);

const ready = new WeakSet();
export function ensureEarnedEditions(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, EARNED_EDITIONS_SCHEMA);
  ready.add(db);
}

/** Whether the player already earned this edition (from any source). */
export function hasEarnedEdition(db, player, edition) {
  ensureEarnedEditions(db);
  return !!db
    .prepare("SELECT 1 FROM earned_editions WHERE player_id=? AND edition=?")
    .get(player, edition);
}

/** Editions this player has earned, oldest first. */
export function earnedEditions(db, player) {
  ensureEarnedEditions(db);
  return db
    .prepare("SELECT edition,source,item_id AS itemId,created_at AS createdAt FROM earned_editions WHERE player_id=? ORDER BY created_at")
    .all(player);
}

/**
 * Award one NPC/monster edition Aura to the player's wardrobe, once per
 * player and edition. Call inside the caller's transaction. Returns the new
 * inventory item, or null when the player already earned it (or already
 * holds one from before this ledger existed) or the edition is sold out.
 */
export function awardEditionOnce(db, player, editionId, source, now = Date.now()) {
  ensureEarnedEditions(db);
  const e = AURA_CATALOG.find((x) => x.id === editionId);
  if (!e || !EARNED_EDITION_IDS.includes(editionId)) return null;
  const mark = db
    .prepare("INSERT OR IGNORE INTO earned_editions(player_id,edition,source,item_id,created_at) VALUES(?,?,?,NULL,?)")
    .run(player, editionId, String(source).slice(0, 160), now);
  if (mark.changes !== 1) return null;
  // Earned before this ledger (e.g. the altar or the old trader check): record
  // it as earned and do not pay again.
  const held = db
    .prepare("SELECT id FROM inventory WHERE player_id=? AND kind='aura' AND name=? ORDER BY created_at LIMIT 1")
    .get(player, e.demoName);
  if (held) {
    db.prepare("UPDATE earned_editions SET source='held',item_id=? WHERE player_id=? AND edition=?").run(held.id, player, editionId);
    return null;
  }
  db.prepare("INSERT OR IGNORE INTO editions VALUES (?,0,?)").run(e.demoName, AURA_SUPPLY);
  const row = db.prepare("SELECT * FROM editions WHERE name=?").get(e.demoName);
  if (row.minted >= row.max_supply) {
    db.prepare("DELETE FROM earned_editions WHERE player_id=? AND edition=?").run(player, editionId);
    return null;
  }
  const item = {
    id: id("aura"),
    name: e.demoName,
    rarity: e.rarity,
    slot: e.slot,
    color: e.demoColor || e.color,
    serial: row.minted + 1,
    edition: e.id,
  };
  db.prepare("UPDATE editions SET minted=minted+1 WHERE name=?").run(e.demoName);
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    item.id, player, "aura", item.name, item.rarity, item.slot, item.color, 0, item.serial, now,
  );
  db.prepare("UPDATE earned_editions SET item_id=? WHERE player_id=? AND edition=?").run(item.id, player, editionId);
  history(db, player, "earned-edition", `Earned ${e.name}`, 0, { edition: e.id, item: item.id, source });
  return item;
}
