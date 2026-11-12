import { atomic } from "./database.mjs";
import { globalRewardReceipt } from './global-rewards.mjs';
import { assert, id } from "./domain.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "./schema-compatibility.mjs";

export const ADVENTURE_RESULTS_SCHEMA = registerModuleSchema({
  name: "adventure-results",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS adventure_results(
 id TEXT PRIMARY KEY,
 player_id TEXT NOT NULL REFERENCES players(id),
 quest_id TEXT NOT NULL REFERENCES quests(id),
 world_id TEXT NOT NULL REFERENCES worlds(id),
 domain TEXT NOT NULL CHECK(domain='demo'),
 realm TEXT NOT NULL CHECK(realm IN ('arena','gps')),
 quest_title TEXT NOT NULL,
 quest_kind TEXT NOT NULL,
 xp INTEGER NOT NULL CHECK(xp>=0),
 gold_u INTEGER NOT NULL CHECK(gold_u>=0),
 item_id TEXT,
 item_snapshot TEXT CHECK(item_snapshot IS NULL OR json_valid(item_snapshot)),
 created_at INTEGER NOT NULL,
 UNIQUE(player_id,quest_id),
 FOREIGN KEY(quest_id,player_id) REFERENCES quest_claims(quest_id,player_id),
 CHECK((item_id IS NULL AND item_snapshot IS NULL) OR (item_id IS NOT NULL AND item_snapshot IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS adventure_results_owner_time ON adventure_results(player_id,created_at DESC,quest_id DESC);
CREATE TABLE IF NOT EXISTS adventure_result_views(
 player_id TEXT NOT NULL REFERENCES players(id),
 quest_id TEXT NOT NULL REFERENCES quests(id),
 viewed_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,quest_id),
 FOREIGN KEY(quest_id,player_id) REFERENCES quest_claims(quest_id,player_id)
);
`,
});

const identifier = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 1024 &&
  !v.includes("\0");
const base = `SELECT qc.quest_id AS claimed_quest_id,qc.created_at AS claim_time,
q.world_id AS current_world_id,q.title AS current_title,q.kind AS current_kind,
w.manifest AS current_manifest,r.*,v.viewed_at
FROM quest_claims qc JOIN quests q ON q.id=qc.quest_id JOIN worlds w ON w.id=q.world_id
JOIN adventure_results r ON r.quest_id=qc.quest_id AND r.player_id=qc.player_id
LEFT JOIN adventure_result_views v ON v.quest_id=qc.quest_id AND v.player_id=qc.player_id`;
const domainFilter = "r.domain='demo'";
function checkPlayer(player) {
  assert(identifier(player), "Sign in to inspect your adventure results.", 401);
}
function queryOptions(options = {}) {
  assert(
    options && typeof options === "object" && !Array.isArray(options),
    "Invalid adventure result query.",
    400,
    "INVALID_RESULT_QUERY",
  );
  const { limit = 20, realm, unviewedOnly = false, cursor = null } = options;
  assert(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 50,
    "Choose 1–50 adventure results.",
    400,
    "INVALID_RESULT_QUERY",
  );
  assert(
    realm === undefined || realm === "arena" || realm === "gps",
    "Unknown adventure realm.",
    400,
    "INVALID_RESULT_QUERY",
  );
  assert(
    typeof unviewedOnly === "boolean",
    "Invalid result filter.",
    400,
    "INVALID_RESULT_QUERY",
  );
  assert(
    cursor === null ||
      (typeof cursor === "string" &&
        cursor.length > 0 &&
        cursor.length <= 4096),
    "Invalid result cursor.",
    400,
    "INVALID_RESULT_QUERY",
  );
  return { limit, realm, unviewedOnly, cursor };
}
export function demoAdventureWorld(quest) {
  let world;
  try {
    world = JSON.parse(quest.manifest);
  } catch {
    throw Error("Adventure world data is unavailable.");
  }
  assert(
    typeof quest.world_id === "string" &&
      quest.world_id.startsWith("demo:") &&
      world?.id === quest.world_id &&
      typeof world.arena === "boolean",
    "This result belongs to another reward domain.",
    409,
    "RESULT_DOMAIN_MISMATCH",
  );
  return world;
}
function itemSnapshot(item) {
  if (!item) return null;
  assert(
    identifier(item.id) &&
      typeof item.name === "string" &&
      typeof item.rarity === "string" &&
      ["above", "below"].includes(item.slot) &&
      typeof item.color === "string" &&
      (item.serial === null || Number.isSafeInteger(item.serial)),
    "The awarded item snapshot is invalid.",
    500,
    "RESULT_WRITE_FAILED",
  );
  return {
    id: item.id,
    kind: "aura",
    name: item.name,
    rarity: item.rarity,
    slot: item.slot,
    color: item.color,
    serial: item.serial,
  };
}
function unavailable(status, reason) {
  return { status, equippable: false, equipped: false, reason };
}
export function currentAdventureItem(db, player, item) {
  if (!item) return unavailable("none", "No item was awarded.");
  const row = db.prepare("SELECT * FROM inventory WHERE id=?").get(item.id);
  if (!row)
    return unavailable(
      "missing",
      "The awarded item is no longer in the demo inventory.",
    );
  if (row.player_id !== player)
    return unavailable(
      "not-owned",
      "This item is no longer owned by this explorer.",
    );
  if (row.kind !== "aura")
    return unavailable(
      "missing",
      "This Aura is no longer in your collection.",
    );
  const current = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    rarity: row.rarity,
    slot: row.slot,
    color: row.color,
    serial: row.serial,
    equipped: row.equipped,
  };
  const award = db
    .prepare("SELECT state FROM native_awards WHERE item_id=?")
    .get(item.id);
  if (award?.state === "minted")
    return {
      ...unavailable(
        "minted",
        "This Aura is secured. Find it in your Secured collection.",
      ),
      item: current,
    };
  // Issued vouchers remain reserved until restoreDemo verifies finalized expiry
  // and absence of a native token. Browser/server wall-clock expiry is insufficient.
  if (award?.state === "issued")
    return {
      ...unavailable(
        "reserved",
        "This Aura is being secured. Check your Secured collection; it returns here if securing expires.",
      ),
      item: current,
    };
  if (
    db
      .prepare("SELECT 1 FROM listings WHERE item_id=? AND state='open'")
      .get(item.id)
  )
    return {
      ...unavailable(
        "listed",
        "Cancel the market listing before trying this Aura on.",
      ),
      item: current,
    };
  const nativeOutfit = !!db
    .prepare("SELECT native_outfit FROM players WHERE id=?")
    .get(player)?.native_outfit;
  const equipped = !!row.equipped && !nativeOutfit;
  return {
    status: "owned",
    equippable: !equipped,
    equipped,
    reason: equipped
      ? "This Aura is already equipped."
      : "Ready to try on. Your ghost wears it on the map.",
    item: current,
  };
}
function present(db, player, row) {
  if (!row) return null;
  const item = row.item_snapshot ? JSON.parse(row.item_snapshot) : null;
  const near=globalRewardReceipt(db,player,row.quest_id);
  return {
    id: row.id,
    version: 1,
    domain: "demo",
    source: "system-quest",
    status: "confirmed",
    playerId: row.player_id,
    questId: row.quest_id,
    worldId: row.world_id,
    realm: row.realm,
    questKind: row.quest_kind,
    title: row.quest_title,
    completedAt: row.created_at,
    viewedAt: row.viewed_at ?? null,
    reward: { xp: row.xp, goldU: row.gold_u, item, ...(near?{near}:{}) },
    itemCurrent: currentAdventureItem(db, player, item),
  };
}
export function initializeAdventureResults(db) {
  return ensureModuleVersion(db, ADVENTURE_RESULTS_SCHEMA);
}

// Caller owns the existing claim/checkpoint transaction. A write failure must
// roll back its XP, shared prize, item, progress and history together.
export function recordAdventureResult(
  db,
  { player, quest, reward, xp, item, now },
) {
  checkPlayer(player);
  const world = demoAdventureWorld(quest),
    snapshot = itemSnapshot(item);
  assert(
    Number.isSafeInteger(xp) &&
      xp >= 0 &&
      Number.isSafeInteger(reward) &&
      reward >= 0 &&
      Number.isSafeInteger(now) &&
      now >= 0,
    "Adventure result amounts are invalid.",
    500,
    "RESULT_WRITE_FAILED",
  );
  const resultId = id("adventure-result");
  db.prepare(
    `INSERT INTO adventure_results(id,player_id,quest_id,world_id,domain,realm,quest_title,quest_kind,xp,gold_u,item_id,item_snapshot,created_at) VALUES(?,?,?,?,'demo',?,?,?,?,?,?,?,?)`,
  ).run(
    resultId,
    player,
    quest.id,
    quest.world_id,
    world.arena ? "arena" : "gps",
    quest.title,
    quest.kind,
    xp,
    reward,
    snapshot?.id ?? null,
    snapshot ? JSON.stringify(snapshot) : null,
    now,
  );
  return resultId;
}
export function createAdventureResults(db) {
  initializeAdventureResults(db);
  function forQuest(player, questId) {
    checkPlayer(player);
    assert(identifier(questId), "Invalid adventure reference.", 400);
    return present(
      db,
      player,
      db
        .prepare(
          `${base} WHERE qc.player_id=? AND qc.quest_id=? AND ${domainFilter}`,
        )
        .get(player, questId),
    );
  }
  function get(player, resultId) {
    checkPlayer(player);
    assert(
      typeof resultId === "string" &&
        resultId.length > 0 &&
        resultId.length <= 2048 &&
        !resultId.includes("\0"),
      "Invalid adventure result.",
      400,
    );
    const result = present(
      db,
      player,
      db
        .prepare(
          `${base} WHERE qc.player_id=? AND r.id=? AND r.domain='demo'`,
        )
        .get(player, resultId),
    );
    assert(result, "Adventure result not found.", 404, "RESULT_NOT_FOUND");
    return result;
  }
  function list(player, options = {}) {
    checkPlayer(player);
    const { limit, realm, unviewedOnly, cursor } = queryOptions(options);
    const where = ["qc.player_id=?", domainFilter],
      params = [player];
    if (realm) {
      where.push(
        "r.realm=?",
      );
      params.push(realm);
    }
    if (unviewedOnly) where.push("v.viewed_at IS NULL");
    if (cursor) {
      let data;
      try {
        data = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      } catch {}
      assert(
        data?.version === 1 &&
          data.playerId === player &&
          data.realm === (realm ?? null) &&
          data.unviewedOnly === unviewedOnly &&
          Number.isSafeInteger(data.at) &&
          data.at >= 0 &&
          identifier(data.questId),
        "This result cursor does not match the current explorer or filters.",
        400,
        "INVALID_RESULT_QUERY",
      );
      where.push("(qc.created_at<? OR (qc.created_at=? AND qc.quest_id<?))");
      params.push(data.at, data.at, data.questId);
    }
    const rows = db
        .prepare(
          `${base} WHERE ${where.join(" AND ")} ORDER BY qc.created_at DESC,qc.quest_id DESC LIMIT ?`,
        )
        .all(...params, limit + 1),
      page = rows.slice(0, limit),
      last = page.at(-1);
    const nextCursor =
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              playerId: player,
              realm: realm ?? null,
              unviewedOnly,
              at: last.claim_time,
              questId: last.claimed_quest_id,
            }),
          ).toString("base64url")
        : null;
    return { results: page.map((row) => present(db, player, row)), nextCursor };
  }
  function markViewed(player, resultId, now = Date.now()) {
    checkPlayer(player);
    assert(
      Number.isSafeInteger(now) && now >= 0,
      "Invalid result view time.",
      400,
    );
    return atomic(db, () => {
      const result = get(player, resultId);
      db.prepare(
        "INSERT OR IGNORE INTO adventure_result_views(player_id,quest_id,viewed_at) VALUES(?,?,?)",
      ).run(player, result.questId, now);
      return get(player, resultId);
    });
  }
  return {
    list,
    get,
    forQuest,
    latest: (player, options = {}) =>
      list(player, { ...options, limit: 1, cursor: null }).results[0] ?? null,
    markViewed,
  };
}

export function replayAdventureResult(result) {
  assert(result, "Adventure result not found.", 404, "RESULT_NOT_FOUND");
  return {
    reward: result.reward.goldU,
    xp: result.reward.xp,
    item: result.reward.item,
    result,
    replayed: true,
  };
}
