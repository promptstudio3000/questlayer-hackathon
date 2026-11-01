// Monster rewards (docs/NPC-PLAN.md §13.4, slice M3). Every grant is a row in
// monster_rewards keyed by (player, source, kind), so a replayed result can't
// pay twice. Nothing here mints GOLD: wins pay account-bound XP, element
// shards and roll tickets, and the only Aura route is crafting shards plus a
// common Aura into a supply-capped monster edition (claim prefix
// earned:monster:, see server/aura-catalog.mjs).
import { assert, id } from "../../domain.mjs";
import { AURA_CATALOG, AURA_SUPPLY } from "../../aura-catalog.mjs";
import { atomic, history } from "../../database.mjs";
import { ensureModuleVersion } from "../../schema-compatibility.mjs";
import { HUNT_SCHEMA } from "./schema.mjs";
import { awardEditionOnce, ensureEarnedEditions } from "../../earned-editions.mjs";

// First win per player against these archetypes pays an NPC/monster-only
// edition once (server/earned-editions.mjs). Pocket Wisps are the
// will-o'-wisp mini-game.
export const FIRST_WIN_EDITION = Object.freeze({ guardian: "wardbreaker", lurker: "wisp" });

export const WIN_XP = Object.freeze({ roamer: 20, guardian: 40, lurker: 25 });
export const WIN_SHARDS = Object.freeze({ roamer: 1, guardian: 2, lurker: 1 });
export const DAILY_SHARD_CAP = 12;
export const CRAFT_SHARDS = 10;
export const CRAFT_EDITION = "wardbreaker";
export const CRAFTS_PER_DAY = 1;
export const ELEMENTS = Object.freeze(["ember", "frost", "storm", "void"]);
// Commons offered at the altar go to this system account (the trader slice can
// restock from it); they never disappear, so edition supply stays honest.
export const ALTAR_ACCOUNT = "monster-hunt-altar";

const tableExists = (db, name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

/** Grant one Aura of a catalog edition while supply lasts. Call inside a transaction. */
export function grantEdition(db, player, editionId, now) {
  const e = AURA_CATALOG.find((x) => x.id === editionId);
  if (!e) return null;
  db.prepare("INSERT OR IGNORE INTO editions VALUES (?,0,?)").run(e.demoName, AURA_SUPPLY);
  const row = db.prepare("SELECT * FROM editions WHERE name=?").get(e.demoName);
  if (row.minted >= row.max_supply) return null;
  const item = { id: id("aura"), name: e.demoName, rarity: e.rarity, slot: e.slot, color: e.demoColor || e.color, serial: row.minted + 1, edition: e.id };
  db.prepare("UPDATE editions SET minted=minted+1 WHERE name=?").run(e.demoName);
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(item.id, player, "aura", item.name, item.rarity, item.slot, item.color, 0, item.serial, now);
  return item;
}

export function createHuntRewards(db, { now = () => Date.now() } = {}) {
  ensureModuleVersion(db, HUNT_SCHEMA);
  ensureEarnedEditions(db);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO monster_rewards(player_id,source,kind,amount,day_id,data,created_at) VALUES(?,?,?,?,?,?,?)",
  );
  const shardsToday = db.prepare(
    "SELECT COALESCE(SUM(amount),0) AS n FROM monster_rewards WHERE player_id=? AND kind='shard' AND day_id=?",
  );
  const addShards = db.prepare(
    "INSERT INTO actor_shards(player_id,element,count,updated_at) VALUES(?,?,?,?) ON CONFLICT(player_id,element) DO UPDATE SET count=count+excluded.count,updated_at=excluded.updated_at",
  );

  /** Grant once per (player, source, kind). Returns true when it was new. Inside a transaction. */
  function grant(player, source, kind, amount, dayId, data = {}, at = now()) {
    return insert.run(player, source, kind, amount, dayId, JSON.stringify(data), at).changes === 1;
  }

  function addXp(player, source, xp, dayId, title, at, data = {}) {
    if (!xp || !grant(player, source, "xp", xp, dayId, data, at)) return 0;
    db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(xp, player);
    history(db, player, "monster", title, 0, { source, xp });
    return xp;
  }

  // Challenge results from server/actors/challenges/service.mjs (onResult).
  function onChallengeResult(result) {
    if (result?.outcome !== "won" || !WIN_XP[result.archetype]) return null;
    const { player, actorId, dayId, archetype } = result,
      at = result.finishedAt ?? now(),
      source = `win:${actorId}:${dayId}`;
    if (!db.prepare("SELECT 1 FROM players WHERE id=?").get(player)) return null;
    return atomic(db, () => {
      const out = { xp: 0, shards: null, rollTicket: false, unlocks: null, edition: null };
      out.xp = addXp(player, source, WIN_XP[archetype], dayId, `Beat ${result.name || "a monster"}`, at, { archetype });
      const element = ELEMENTS.includes(result.element) ? result.element : "void";
      const room = Math.max(0, DAILY_SHARD_CAP - shardsToday.get(player, dayId).n),
        shards = Math.min(room, WIN_SHARDS[archetype]);
      if (shards && grant(player, source, "shard", shards, dayId, { element }, at)) {
        addShards.run(player, element, shards, at);
        out.shards = { element, count: shards };
      }
      if (archetype === "lurker") out.rollTicket = grant(player, source, "roll", 1, dayId, {}, at);
      if (archetype === "guardian" && result.guards?.zoneId) out.unlocks = { zoneId: result.guards.zoneId };
      const editionId = FIRST_WIN_EDITION[archetype];
      if (editionId) {
        const item = awardEditionOnce(db, player, editionId, `monster:${source}`, at);
        if (item) {
          grant(player, source, "edition", 1, dayId, { edition: editionId, item: item.id }, at);
          out.edition = { id: item.id, name: item.name, rarity: item.rarity, edition: editionId };
        }
      }
      return out;
    });
  }

  function shardsOf(player) {
    const rows = db.prepare("SELECT element,count FROM actor_shards WHERE player_id=?").all(player);
    return Object.fromEntries(ELEMENTS.map((e) => [e, rows.find((r) => r.element === e)?.count || 0]));
  }

  function summary(player, dayId) {
    const sum = (kind) =>
      db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM monster_rewards WHERE player_id=? AND kind=?").get(player, kind).n;
    const shards = shardsOf(player),
      total = Object.values(shards).reduce((a, b) => a + b, 0),
      guardianWins = db
        .prepare("SELECT COUNT(*) AS n FROM monster_rewards WHERE player_id=? AND kind='xp' AND json_extract(data,'$.archetype')='guardian'")
        .get(player).n,
      craftedToday = db
        .prepare("SELECT COUNT(*) AS n FROM monster_rewards WHERE player_id=? AND kind='craft' AND day_id=?")
        .get(player, dayId).n,
      common = commonAura(player);
    return {
      shards,
      shardTotal: total,
      shardsToday: shardsToday.get(player, dayId).n,
      dailyShardCap: DAILY_SHARD_CAP,
      rollTickets: sum("roll"),
      monsterXp: sum("xp"),
      guardianWins,
      craft: {
        edition: CRAFT_EDITION,
        shards: CRAFT_SHARDS,
        ready: total >= CRAFT_SHARDS && guardianWins > 0 && !!common && craftedToday < CRAFTS_PER_DAY,
        needs: [
          ...(total < CRAFT_SHARDS ? ["shards"] : []),
          ...(guardianWins ? [] : ["guardian"]),
          ...(common ? [] : ["common-aura"]),
          ...(craftedToday < CRAFTS_PER_DAY ? [] : ["daily"]),
        ],
      },
    };
  }

  // Oldest common Aura the player can give up: not equipped, never listed,
  // never claimed on NEAR.
  function commonAura(player, itemId) {
    const listed = tableExists(db, "listings") ? "AND NOT EXISTS(SELECT 1 FROM listings l WHERE l.item_id=i.id)" : "";
    const claimed = tableExists(db, "native_awards") ? "AND NOT EXISTS(SELECT 1 FROM native_awards a WHERE a.item_id=i.id)" : "";
    return db
      .prepare(
        `SELECT i.* FROM inventory i WHERE i.player_id=? AND i.kind='aura' AND i.rarity='common' AND i.equipped=0 ${listed} ${claimed} ${itemId ? "AND i.id=?" : ""} ORDER BY i.created_at LIMIT 1`,
      )
      .get(...(itemId ? [player, itemId] : [player]));
  }

  // 10 shards (largest piles first) + one common Aura -> one Wardbreaker Horns.
  function craft(player, { itemId, dayId }) {
    assert(player, "Sign in to craft.", 401, "AUTH");
    const at = now();
    return atomic(db, () => {
      const s = summary(player, dayId);
      assert(s.guardianWins > 0, "Beat a zone guardian first.", 409, "CRAFT_GUARDIAN");
      assert(s.shardTotal >= CRAFT_SHARDS, `You need ${CRAFT_SHARDS} monster shards.`, 409, "CRAFT_SHARDS");
      assert(s.craft.needs.indexOf("daily") < 0, "The altar accepts one offering per day.", 429, "CRAFT_DAILY");
      const aura = commonAura(player, itemId);
      assert(aura, "Offer a common Aura you are not wearing, listing or claiming.", 409, "CRAFT_AURA");
      db.prepare("INSERT OR IGNORE INTO players(id,name,gold_u,created_at) VALUES(?,?,0,?)").run(ALTAR_ACCOUNT, "Golden Altar", at);
      const item = grantEdition(db, player, CRAFT_EDITION, at);
      assert(item, "This edition is fully crafted. Your shards are safe.", 409, "CRAFT_SOLD_OUT");
      let left = CRAFT_SHARDS;
      const spent = {};
      for (const [element, count] of Object.entries(s.shards).sort((a, b) => b[1] - a[1])) {
        const take = Math.min(count, left);
        if (!take) continue;
        db.prepare("UPDATE actor_shards SET count=count-?,updated_at=? WHERE player_id=? AND element=?").run(take, at, player, element);
        spent[element] = take;
        left -= take;
      }
      db.prepare("UPDATE inventory SET player_id=?,equipped=0 WHERE id=?").run(ALTAR_ACCOUNT, aura.id);
      grant(player, `craft:${item.id}`, "craft", 1, dayId, { edition: CRAFT_EDITION, spent, offered: aura.id }, at);
      history(db, player, "monster", `Crafted ${item.name}`, 0, { item: item.id, offered: aura.name, spent });
      return { item, spent, offered: { id: aura.id, name: aura.name } };
    });
  }

  return { grant, addXp, onChallengeResult, summary, craft, shardsOf };
}
