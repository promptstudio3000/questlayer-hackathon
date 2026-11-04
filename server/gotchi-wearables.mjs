// Aavegotchi wearables in QuestLayer (4 Nov 2026).
//
// 1. Clones: every Aavegotchi wearable from the official Base contract can be
//    found on the map as a free in-game copy ("clone"). Wearable finds are a
//    deterministic subset of a world's street finds, so they reuse the street
//    coin claim path (GPS check, travel guard, XP caps). A clone is a cosmetic
//    row in this database, never an NFT, never tradable and never sold.
// 2. Verified: when a player's linked Base address held the original item at
//    the last ownership check (external_links snapshot, at most a day old), the
//    clone shows a gold "verified" check. The original never leaves the wallet.
//    Owned originals also appear in the wardrobe without being found first.
//
// Artwork comes from the contract's getItemSvg(itemId) at runtime
// (GotchiItemArt cache); names, slots and placement on the 64×64 gotchi canvas
// come from server/data/gotchi-wearables.json (scripts/build-gotchi-wearables.mjs).
import { readFileSync } from "node:fs";
import { assert, hash } from "./domain.mjs";
import { streetFindIds } from "./street-finds.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "./schema-compatibility.mjs";

const data = JSON.parse(
  readFileSync(new URL("./data/gotchi-wearables.json", import.meta.url), "utf8"),
);
export const WEARABLES = new Map(data.items.map((item) => [item.id, item]));
export const WEARABLE_SLOTS = ["head", "face", "eyes", "body", "hand", "pet"];
/** How often each rarity drops, in percent of wearable finds. */
export const WEARABLE_DROP_WEIGHTS = Object.freeze({ ...data.dropWeights });
/** About one street find in three holds a wearable, at most this many per world. */
export const WEARABLE_FINDS_PER_WORLD = 12;
/** An ownership check older than this no longer shows the gold check. */
export const VERIFIED_FOR_MS = 24 * 3600_000;
const byRarity = new Map();
for (const item of data.items) {
  if (!byRarity.has(item.rarity)) byRarity.set(item.rarity, []);
  byRarity.get(item.rarity).push(item);
}

export const WEARABLES_SCHEMA = registerModuleSchema({
  name: "gotchi-wearables",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS wearable_clones(player_id TEXT NOT NULL REFERENCES players(id),item_id INTEGER NOT NULL CHECK(item_id>0),source TEXT NOT NULL CHECK(source IN ('find','original')),equipped INTEGER NOT NULL DEFAULT 0 CHECK(equipped IN (0,1)),created_at INTEGER NOT NULL,PRIMARY KEY(player_id,item_id))`,
});
const ready = new WeakSet();
export function ensureWearablesSchema(db) {
  if (ready.has(db)) return;
  if (db.isTransaction) return void ensureModuleVersion(db, WEARABLES_SCHEMA);
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureModuleVersion(db, WEARABLES_SCHEMA);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  ready.add(db);
}

export const publicWearable = (item) => ({
  id: item.id,
  name: item.name,
  slot: item.slot,
  rarity: item.rarity,
  dims: item.dims,
});

/** Deterministic rarity-weighted pick for one coin seed. */
export function wearableForSeed(seed) {
  const h = hash(`wearable:${seed}`);
  const roll = parseInt(h.slice(0, 8), 16) % 1000;
  let edge = 0,
    rarity = "common";
  for (const [name, weight] of Object.entries(WEARABLE_DROP_WEIGHTS)) {
    edge += weight * 10;
    if (roll < edge) {
      rarity = name;
      break;
    }
  }
  const pool = byRarity.get(rarity) || data.items;
  return pool[parseInt(h.slice(8, 16), 16) % pool.length];
}

const findCache = new WeakMap();
/** coinId → wearable for a world's wearable finds (subset of street finds). */
export function wearableFinds(db, worldId) {
  const finds = streetFindIds(db, worldId);
  let byWorld = findCache.get(db);
  if (!byWorld) findCache.set(db, (byWorld = new Map()));
  const hit = byWorld.get(worldId);
  if (hit && hit.finds === finds) return hit.map;
  const map = new Map();
  for (const coinId of [...finds].sort()) {
    if (map.size >= WEARABLE_FINDS_PER_WORLD) break;
    if (parseInt(hash(`wearable-find:${coinId}`).slice(0, 4), 16) % 3 === 0)
      map.set(coinId, wearableForSeed(coinId));
  }
  if (byWorld.size >= 1024) byWorld.delete(byWorld.keys().next().value);
  byWorld.set(worldId, { finds, map });
  return map;
}

/** Inside the coin claim transaction: give the clone of this find, if any. */
export function grantWearableFind(db, player, worldId, coinId, now = Date.now()) {
  const item = wearableFinds(db, worldId).get(coinId);
  if (!item) return null;
  ensureWearablesSchema(db);
  const added = db
    .prepare(
      "INSERT OR IGNORE INTO wearable_clones(player_id,item_id,source,equipped,created_at) VALUES(?,?,?,?,?)",
    )
    .run(player, item.id, "find", 0, now).changes;
  return { ...publicWearable(item), duplicate: !added };
}

/** Item ids held by any of the player's linked Base addresses at a recent check. */
export function verifiedItemIds(db, player, now = Date.now()) {
  const ids = new Set();
  const links = db
    .prepare(
      "SELECT data FROM external_links WHERE player_id=? AND verified_at>=?",
    )
    .all(player, now - VERIFIED_FOR_MS);
  for (const link of links) {
    let snapshot;
    try {
      snapshot = JSON.parse(link.data);
    } catch {
      continue;
    }
    for (const w of snapshot.wearables || [])
      if (/^[1-9]\d{0,77}$/.test(w.quantity || "")) ids.add(Number(w.itemId));
    for (const g of snapshot.gotchis || [])
      for (const id of g.equipped || []) if (Number(id) > 0) ids.add(Number(id));
  }
  return ids;
}

/** Owned originals join the wardrobe as clones the first time they are seen. */
export function adoptOriginals(db, player, now = Date.now()) {
  ensureWearablesSchema(db);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO wearable_clones(player_id,item_id,source,equipped,created_at) VALUES(?,?,?,?,?)",
  );
  for (const id of verifiedItemIds(db, player, now))
    if (WEARABLES.has(id)) insert.run(player, id, "original", 0, now);
}

export function wardrobe(db, player, now = Date.now()) {
  adoptOriginals(db, player, now);
  const verified = verifiedItemIds(db, player, now);
  const link = db
    .prepare(
      "SELECT MAX(verified_at) AS at, COUNT(*) AS n FROM external_links WHERE player_id=?",
    )
    .get(player);
  const items = db
    .prepare(
      "SELECT item_id,source,equipped,created_at FROM wearable_clones WHERE player_id=? ORDER BY created_at DESC, item_id",
    )
    .all(player)
    .flatMap((row) => {
      const item = WEARABLES.get(row.item_id);
      return item
        ? [
            {
              ...publicWearable(item),
              source: row.source,
              equipped: !!row.equipped,
              verified: verified.has(row.item_id),
              foundAt: row.created_at,
            },
          ]
        : [];
    });
  return {
    items,
    linked: link.n > 0,
    verifiedAt: link.at || null,
    verifiedForMs: VERIFIED_FOR_MS,
    catalogSize: WEARABLES.size,
  };
}

export function equipWearable(db, player, itemId, equipped, now = Date.now()) {
  adoptOriginals(db, player, now);
  const id = Number(itemId);
  assert(Number.isSafeInteger(id) && WEARABLES.has(id), "Unknown wearable.", 400);
  const row = db
    .prepare("SELECT 1 FROM wearable_clones WHERE player_id=? AND item_id=?")
    .get(player, id);
  assert(row, "Find this wearable on the map first.", 403);
  const slot = WEARABLES.get(id).slot;
  const sameSlot = data.items.filter((i) => i.slot === slot).map((i) => i.id);
  db.exec("SAVEPOINT wearable_equip");
  try {
    if (equipped)
      db.prepare(
        `UPDATE wearable_clones SET equipped=0 WHERE player_id=? AND item_id IN (${sameSlot.map(() => "?").join(",")})`,
      ).run(player, ...sameSlot);
    db.prepare(
      "UPDATE wearable_clones SET equipped=? WHERE player_id=? AND item_id=?",
    ).run(equipped ? 1 : 0, player, id);
    db.exec("RELEASE wearable_equip");
  } catch (error) {
    db.exec("ROLLBACK TO wearable_equip");
    db.exec("RELEASE wearable_equip");
    throw error;
  }
  return wardrobe(db, player, now);
}

/** What a player wears, for their own marker and for others who may see it. */
export function wornWearables(db, player, now = Date.now()) {
  ensureWearablesSchema(db);
  const rows = db
    .prepare(
      "SELECT item_id FROM wearable_clones WHERE player_id=? AND equipped=1 LIMIT 8",
    )
    .all(player);
  if (!rows.length) return [];
  const verified = verifiedItemIds(db, player, now);
  return rows.flatMap((row) => {
    const item = WEARABLES.get(row.item_id);
    return item
      ? [{ ...publicWearable(item), verified: verified.has(row.item_id) }]
      : [];
  });
}
