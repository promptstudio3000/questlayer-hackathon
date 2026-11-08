import { purchaseAtomic } from "../../gold-spend/purchases.mjs";
// Monster rewards (docs/NPC-PLAN.md §13.4, slice M3). Every grant is a row in
// monster_rewards keyed by (player, source, kind), so a replayed result can't
// pay twice. Nothing here mints GOLD: wins pay account-bound XP, element
// shards and roll tickets, and the only Aura route is crafting shards plus a
// common Aura into a supply-capped monster edition (claim prefix
// earned:monster:, see server/aura-catalog.mjs).
import { assert, id, levelFor } from "../../domain.mjs";
import { altarOfferingsPerDay } from "../../levels.mjs";
import { AURA_CATALOG, AURA_SUPPLY } from "../../aura-catalog.mjs";
import { atomic, history } from "../../database.mjs";
import { recordChainAction } from "../../chain-ledger/service.mjs";
import { ensureModuleVersion } from "../../schema-compatibility.mjs";
import { HUNT_SCHEMA } from "./schema.mjs";
import { awardEditionOnce, ensureEarnedEditions } from "../../earned-editions.mjs";
import { altarFee, burnGold, priceU } from "../../gold-spend/ledger.mjs";

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
// Golden Altar recipes (docs/GAME-LOOPS.md P1-4). Each one sinks monster
// shards and common Auras into an existing native edition, so no contract
// upgrade is needed. `element: null` takes any shards (largest piles first);
// otherwise only that element counts. All recipes share the daily offering
// limit (CRAFTS_PER_DAY, L6 unlock raises it).
export const ALTAR_RECIPES = Object.freeze(
  [
    { id: "wardbreaker", edition: "wardbreaker", element: null, shards: CRAFT_SHARDS, commons: 1, guardian: true },
    { id: "frost-lights", edition: "polar", element: "frost", shards: 6, commons: 1, guardian: false },
    { id: "ember-comet", edition: "comet", element: "ember", shards: 8, commons: 2, guardian: true },
    { id: "storm-crown", edition: "storm", element: "storm", shards: 8, commons: 2, guardian: true },
    { id: "void-moon", edition: "moon", element: "void", shards: 8, commons: 2, guardian: true },
  ].map((r) => Object.freeze(r)),
);
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

// altarFees: the Golden Altar takes a small GOLD fee per offering, burned
// (QGOLD stream 4, server/data/gold-spend.json). The server turns it on;
// unit tests of the recipes leave it off.
export function createHuntRewards(db, { now = () => Date.now(), altarFees = false } = {}) {
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

  let lastChain = null;
  function addXp(player, source, xp, dayId, title, at, data = {}) {
    lastChain = null;
    if (!xp || !grant(player, source, "xp", xp, dayId, data, at)) return 0;
    db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(xp, player);
    lastChain = recordChainAction(db, {
      player,
      kind: source.startsWith("boss") ? "boss" : "monster",
      xp,
      at: data.where || null,
      ref: source,
      evidence: { source, title, archetype: data.archetype || null },
      now: at ?? now(),
    });
    history(db, player, "monster", title, 0, { source, xp, ...(lastChain ? { chain: { id: lastChain.id, status: lastChain.status, tx: null } } : {}) });
    return xp;
  }

  const openedChest = db.prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?");
  const chestOpened = (questId, player) => !!openedChest.get(questId, player);

  // Challenge results from server/actors/challenges/service.mjs (onResult).
  function onChallengeResult(result) {
    if (result?.outcome !== "won" || !WIN_XP[result.archetype]) return null;
    const { player, actorId, dayId, archetype } = result,
      at = result.finishedAt ?? now(),
      source = `win:${actorId}:${dayId}`;
    if (!db.prepare("SELECT 1 FROM players WHERE id=?").get(player)) return null;
    return atomic(db, () => {
      const out = { xp: 0, shards: null, rollTicket: false, unlocks: null, edition: null };
      out.xp = addXp(player, source, WIN_XP[archetype], dayId, `Beat ${result.name || "a monster"}`, at, { archetype, where: result.where });
      if (lastChain) out.chain = lastChain;
      const element = ELEMENTS.includes(result.element) ? result.element : "void";
      const room = Math.max(0, DAILY_SHARD_CAP - shardsToday.get(player, dayId).n),
        shards = Math.min(room, WIN_SHARDS[archetype]);
      if (shards && grant(player, source, "shard", shards, dayId, { element }, at)) {
        addShards.run(player, element, shards, at);
        out.shards = { element, count: shards };
      }
      if (archetype === "lurker") out.rollTicket = grant(player, source, "roll", 1, dayId, {}, at);
      // The guardian drops the chest it stood on. Only a chest this player has
      // not opened yet is announced; an opened one has nothing left to open.
      const chestId = result.guards?.questId;
      if (archetype === "guardian" && result.guards?.zoneId && typeof chestId === "string" && !chestOpened(chestId, player))
        out.unlocks = { zoneId: result.guards.zoneId, questId: chestId };
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

  function recipeView(r, ctx) {
    const e = AURA_CATALOG.find((x) => x.id === r.edition);
    const have = r.element ? ctx.shards[r.element] || 0 : ctx.shardTotal;
    const needs = [
      ...(have < r.shards ? ["shards"] : []),
      ...(r.guardian && !ctx.guardianWins ? ["guardian"] : []),
      ...(ctx.commons < r.commons ? ["common-aura"] : []),
      ...(ctx.craftedToday < ctx.perDay ? [] : ["daily"]),
      ...(altarFees && ctx.goldU < priceU(altarFee(r.id)) ? ["gold"] : []),
    ];
    return {
      id: r.id,
      edition: r.edition,
      name: e?.demoName || r.edition,
      rarity: e?.rarity || "common",
      slot: e?.slot || "above",
      element: r.element,
      shards: r.shards,
      commons: r.commons,
      guardian: r.guardian,
      gold: altarFees ? altarFee(r.id) : 0,
      ready: needs.length === 0,
      needs,
    };
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
      commons = commonAuras(player, 2).length,
      // L6 unlock (server/data/level-table.json): a second offering per day.
      perDay = altarOfferingsPerDay(levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0), CRAFTS_PER_DAY);
    const goldU = db.prepare("SELECT gold_u FROM players WHERE id=?").get(player)?.gold_u ?? 0;
    const ctx = { shards, shardTotal: total, guardianWins, craftedToday, commons, perDay, goldU };
    const recipes = ALTAR_RECIPES.map((r) => recipeView(r, ctx));
    const first = recipes[0];
    return {
      shards,
      shardTotal: total,
      shardsToday: shardsToday.get(player, dayId).n,
      dailyShardCap: DAILY_SHARD_CAP,
      rollTickets: sum("roll"),
      monsterXp: sum("xp"),
      guardianWins,
      // Original single recipe, kept for older clients.
      craft: { edition: CRAFT_EDITION, shards: CRAFT_SHARDS, ready: first.ready, perDay, needs: first.needs },
      altar: { perDay, craftedToday, recipes },
    };
  }

  // Oldest common Auras the player can give up: not equipped, never listed,
  // never claimed on NEAR. `itemId` (optional) goes first when it qualifies.
  function commonAuras(player, limit, itemId) {
    const listed = tableExists(db, "listings") ? "AND NOT EXISTS(SELECT 1 FROM listings l WHERE l.item_id=i.id)" : "";
    const claimed = tableExists(db, "native_awards") ? "AND NOT EXISTS(SELECT 1 FROM native_awards a WHERE a.item_id=i.id)" : "";
    return db
      .prepare(
        `SELECT i.* FROM inventory i WHERE i.player_id=? AND i.kind='aura' AND i.rarity='common' AND i.equipped=0 ${listed} ${claimed} ORDER BY (i.id=?) DESC, i.created_at LIMIT ?`,
      )
      .all(player, itemId || "", limit);
  }

  // Offer shards + common Auras at the Golden Altar for a recipe's edition.
  function craft(player, { itemId, dayId, recipe = CRAFT_EDITION }) {
    assert(player, "Sign in to craft.", 401, "AUTH");
    const r = ALTAR_RECIPES.find((x) => x.id === recipe);
    assert(r, "The altar does not know this recipe.", 400, "CRAFT_RECIPE");
    const at = now();
    return purchaseAtomic(db, () => {
      const s = summary(player, dayId),
        v = s.altar.recipes.find((x) => x.id === r.id);
      assert(!v.needs.includes("daily"), s.altar.perDay > 1 ? `The altar accepts ${s.altar.perDay} offerings per day.` : "The altar accepts one offering per day.", 429, "CRAFT_DAILY");
      assert(!v.needs.includes("guardian"), "Beat a zone guardian first.", 409, "CRAFT_GUARDIAN");
      assert(
        !v.needs.includes("shards"),
        r.element ? `You need ${r.shards} ${r.element} shards.` : `You need ${r.shards} monster shards.`,
        409,
        "CRAFT_SHARDS",
      );
      const auras = commonAuras(player, r.commons, itemId);
      assert(
        auras.length >= r.commons && (!itemId || auras[0].id === itemId),
        r.commons > 1 ? `Offer ${r.commons} common Auras you are not wearing, listing or claiming.` : "Offer a common Aura you are not wearing, listing or claiming.",
        409,
        "CRAFT_AURA",
      );
      assert(!v.needs.includes("gold"), `The altar asks ${altarFee(r.id)} GOLD for this offering.`, 402, "CRAFT_GOLD");
      db.prepare("INSERT OR IGNORE INTO players(id,name,gold_u,created_at) VALUES(?,?,0,?)").run(ALTAR_ACCOUNT, "Golden Altar", at);
      const item = grantEdition(db, player, r.edition, at);
      assert(item, "This edition is fully crafted. Your shards are safe.", 409, "CRAFT_SOLD_OUT");
      const fee = altarFees ? burnGold(db, { player, kind: "altar", ref: `${r.id}:${item.id}`, amountU: priceU(altarFee(r.id)), title: `Altar offering: ${item.name}`, now: at }) : null;
      let left = r.shards;
      const spent = {};
      const piles = r.element ? [[r.element, s.shards[r.element]]] : Object.entries(s.shards).sort((a, b) => b[1] - a[1]);
      for (const [element, count] of piles) {
        const take = Math.min(count, left);
        if (!take) continue;
        db.prepare("UPDATE actor_shards SET count=count-?,updated_at=? WHERE player_id=? AND element=?").run(take, at, player, element);
        spent[element] = take;
        left -= take;
      }
      for (const a of auras) db.prepare("UPDATE inventory SET player_id=?,equipped=0 WHERE id=?").run(ALTAR_ACCOUNT, a.id);
      grant(player, `craft:${item.id}`, "craft", 1, dayId, { edition: r.edition, recipe: r.id, spent, offered: auras.map((a) => a.id) }, at);
      history(db, player, "monster", `Crafted ${item.name}`, 0, { item: item.id, recipe: r.id, offered: auras.map((a) => a.name), spent });
      return {
        item,
        recipe: r.id,
        spent,
        offered: { id: auras[0].id, name: auras[0].name },
        offeredAll: auras.map((a) => ({ id: a.id, name: a.name })),
        ...(fee ? { gold: { burned: fee.amountU, balanceU: fee.balanceU } } : {}),
      };
    });
  }

  return { grant, addXp, onChallengeResult, summary, craft, shardsOf };
}
