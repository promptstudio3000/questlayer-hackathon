// Badges (docs/BADGES.md).
//
// 1. Place badges: one per notable place (peak, viewpoint, landmark, bigger
//    city), earned once by reaching it with a fresh GPS fix. Stored here, not
//    in inventory, so they can never be sold, listed or moved.
// 2. Player badges: POAP-like designs any explorer with a NEAR account can
//    create for a place they are standing at, an event (with a code) or one of
//    their own community quests. Designs and holdings live on NEAR in the
//    soulbound questlayer_badges contract; this table is the game's queue and
//    cache in front of it (server/badges/chain.mjs mints).
import { createHash, randomBytes } from "node:crypto";
import { assert, distance, point } from "../domain.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { BADGES_SCHEMA, PLACE_BADGE_MINTS_SCHEMA } from "./schema.mjs";
export { BADGES_SCHEMA, PLACE_BADGE_MINTS_SCHEMA };
import { placesAt, nearestPlaces, PLACE_KINDS } from "./place-catalog.mjs";


export const GPS_MAX_AGE_MS = 15_000;
/** Faster than an airliner between two checks: the second fix is not trusted. */
export const MAX_TRAVEL_MPS = 340;
export const USER_KINDS = Object.freeze(["place", "event", "quest"]);
export const USER_ICONS = Object.freeze(["🏅", "⭐", "🗺️", "⛰️", "🔭", "🏛️", "🌲", "🌊", "🏰", "🎉", "🎵", "🍺", "☕", "🚲", "🥾", "📸", "🧭", "🔥", "💎", "👻"]);
export const USER_COLORS = Object.freeze(["#c08a2b", "#2b7bc0", "#3a9d5d", "#b8432f", "#7d4cc0", "#d06b9c", "#4a5568", "#0f8b8d"]);
export const MAX_CLAIM_ATTEMPTS = 5;
/** Place-badge mints wait this long before looking for a linked account again. */
export const NO_ACCOUNT_RETRY_MS = 10 * 60_000;
/** Supply of one place design on chain (the contract's maximum). */
export const PLACE_SUPPLY = 10_000;
const RARITY_COLORS = Object.freeze({ common: "#3a9d5d", rare: "#2b7bc0", epic: "#7d4cc0", legendary: "#c08a2b" });

/** The on-chain id of a place badge design: a-z, 0-9 and dashes, at most 48. */
export function placeChainId(badgeId) {
  const full = `place-${badgeId}`;
  if (full.length <= 48) return full;
  const h = createHash("sha256").update(badgeId).digest("hex").slice(0, 8);
  return `${full.slice(0, 39).replace(/-+$/g, "")}-${h}`;
}

/** A user_badges-shaped row for createArgs: a sponsored Place design. */
export function placeDesignRow(badge, contractId) {
  const where = [badge.region, badge.country].filter(Boolean).join(", ");
  const title = badge.name.replace(/\s+/g, " ").trim().slice(0, 48).trim();
  return {
    id: placeChainId(badge.id),
    creator_account: contractId,
    title: title.length >= 3 ? title : `${title} ${badge.kind}`.slice(0, 48),
    description: `QuestLayer place badge: reached ${badge.name} (${badge.kind}${where ? `, ${where}` : ""}) in person with live GPS.`.slice(0, 280),
    icon: badge.icon,
    color: RARITY_COLORS[badge.rarity] || RARITY_COLORS.common,
    kind: "place",
    lat: badge.lat,
    lng: badge.lng,
    radius_m: Math.max(25, Math.min(50_000, Math.round(badge.radiusM))),
    max_supply: PLACE_SUPPLY,
    starts_at: null,
    ends_at: null,
  };
}

export function userBadgeSettings(env = process.env, network = "testnet") {
  const int = (v, d, min, max) => {
    const n = v === undefined || v === "" ? d : Number(v);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : d;
  };
  return Object.freeze({
    // Player badges are sponsored by the game on testnet; mainnet needs an
    // explicit switch and its own funding decision.
    enabled: env.USER_BADGES_ENABLED ? env.USER_BADGES_ENABLED === "1" : network === "testnet",
    // Earned place badges minted as soulbound NFTs (sponsored by the game).
    placeMints: env.PLACE_BADGES_ONCHAIN ? env.PLACE_BADGES_ONCHAIN === "1" : network === "testnet",
    maxActivePerPlayer: int(env.USER_BADGES_MAX_ACTIVE, 5, 1, 100),
    maxPerDay: int(env.USER_BADGES_MAX_PER_DAY, 3, 1, 50),
    maxSupply: int(env.USER_BADGES_MAX_SUPPLY, 200, 1, 10_000),
  });
}

/** A GPS fix good enough for a place: fresh, and accurate for its radius. */
export function placeFix(fix, now, radiusM = 100) {
  point(fix);
  const maxAccuracy = Math.max(35, Math.min(150, radiusM / 3));
  assert(
    Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= maxAccuracy,
    "Your location is not precise enough yet. Step into the open and try again.",
    422,
    "GPS_ACCURACY",
  );
  assert(
    Number.isFinite(fix.timestamp) && fix.timestamp <= now + 2000 && now - fix.timestamp <= GPS_MAX_AGE_MS,
    "Your location is out of date. Wait a moment for a fresh one, then try again.",
    422,
    "GPS_STALE",
  );
  return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: fix.timestamp };
}

function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
}
const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "").slice(0, max);
const hasControl = (s) => /[\u0000-\u001f\u007f]/.test(s);
// Event codes are short shared words, not secrets: stored readable so the
// creator can see them again, compared case-insensitively.
const codeHash = (badgeId, code) => createHash("sha256").update(`${badgeId}:${code.trim().toLowerCase()}`).digest("hex");

export function createBadgeService(db, { catalog, linkedAccount, settings = userBadgeSettings(), chain = () => null, now = Date.now } = {}) {
  ensureModuleVersion(db, BADGES_SCHEMA);
  ensureModuleVersion(db, PLACE_BADGE_MINTS_SCHEMA);
  const lastFix = new Map();
  // Badges earned before on-chain minting existed are minted too.
  db.prepare(
    "INSERT OR IGNORE INTO place_badge_mints(player_id,badge_id,state,created_at,updated_at) SELECT player_id,badge_id,'queued',created_at,created_at FROM place_badge_awards",
  ).run();
  const queueMint = db.prepare("INSERT OR IGNORE INTO place_badge_mints(player_id,badge_id,state,created_at,updated_at) VALUES(?,?,'queued',?,?)");

  function earnedPlaces(player) {
    return db
      .prepare("SELECT badge_id AS badgeId,created_at AS earnedAt FROM place_badge_awards WHERE player_id=? ORDER BY created_at")
      .all(player);
  }

  /** Awards every place badge whose radius contains this fix. Idempotent. */
  function check(player, fix) {
    const t = now();
    const at = placeFix(fix, t, 20_000);
    const prev = lastFix.get(player);
    lastFix.set(player, { lat: at.lat, lng: at.lng, t });
    if (lastFix.size > 50_000) lastFix.delete(lastFix.keys().next().value);
    if (prev && t > prev.t) {
      const mps = distance(prev, at) / ((t - prev.t) / 1000);
      if (mps > MAX_TRAVEL_MPS) return { earned: [], suspicious: true };
    }
    const earned = [];
    const insert = db.prepare("INSERT OR IGNORE INTO place_badge_awards VALUES(?,?,?,?,?,?)");
    for (const { badge } of placesAt(catalog, at)) {
      const maxAccuracy = Math.max(35, Math.min(150, badge.radiusM / 3));
      if (at.accuracy > maxAccuracy) continue;
      if (insert.run(player, badge.id, at.lat, at.lng, at.accuracy, t).changes === 1) {
        queueMint.run(player, badge.id, t, t);
        earned.push({ ...badge, earnedAt: t, chain: { state: "queued", tx: null, tokenId: null } });
      }
    }
    return { earned, suspicious: false };
  }

  function placeMints(player) {
    const rows = db
      .prepare("SELECT badge_id AS badgeId,state,account_id AS accountId,chain_tx AS tx,token_id AS tokenId FROM place_badge_mints WHERE player_id=?")
      .all(player);
    // A queued mint goes to the account linked when it is sent.
    const linked = rows.some((r) => !r.accountId) ? linkedAccount(player) : null;
    return new Map(rows.map((r) => [r.badgeId, { state: r.state, accountId: r.accountId ?? linked, tx: r.tx, tokenId: r.tokenId }]));
  }

  function placesView(player, at) {
    const earned = new Map(earnedPlaces(player).map((r) => [r.badgeId, r.earnedAt]));
    const mints = placeMints(player);
    const byKind = Object.fromEntries(PLACE_KINDS.map((k) => [k, { earned: 0, total: 0 }]));
    for (const b of catalog.badges) {
      byKind[b.kind].total++;
      if (earned.has(b.id)) byKind[b.kind].earned++;
    }
    const list = catalog.badges.map((b) => ({ ...b, earnedAt: earned.get(b.id) ?? null, chain: mints.get(b.id) ?? null }));
    // Earned badges first (newest first), then the rest in catalog order.
    list.sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0));
    let next = [];
    if (at) {
      next = nearestPlaces(catalog, at, { limit: 5, skip: new Set(earned.keys()) }).map((x) => ({
        id: x.badge.id,
        distanceM: Math.round(x.distanceM),
        toEdgeM: Math.round(x.toEdgeM),
      }));
    }
    return {
      version: catalog.version,
      total: catalog.badges.length,
      earned: earned.size,
      onChain: [...mints.values()].filter((m) => m.state === "minted").length,
      byKind,
      badges: list,
      next,
    };
  }

  // ------------------------------------------------------------ player badges

  function userRow(r, player) {
    if (!r) return null;
    const minted = db.prepare("SELECT count(*) AS n FROM user_badge_claims WHERE badge_id=? AND state!='failed'").get(r.id).n;
    const mine = player ? db.prepare("SELECT state,token_id AS tokenId,chain_tx AS tx FROM user_badge_claims WHERE badge_id=? AND player_id=?").get(r.id, player) : null;
    const own = player && r.creator_player === player;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      icon: r.icon,
      color: r.color,
      kind: r.kind,
      place: r.lat == null ? null : { lat: r.lat, lng: r.lng, radiusM: r.radius_m },
      questRef: r.quest_ref,
      needsCode: !!r.code,
      code: own ? r.code : undefined,
      creatorAccount: r.creator_account,
      mine: !!own,
      maxSupply: r.max_supply,
      claimed: minted,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      state: r.state,
      onChain: r.state === "live",
      tx: r.chain_tx,
      holding: mine || null,
      createdAt: r.created_at,
    };
  }

  function userView(player, at) {
    const c = chain();
    const created = db.prepare("SELECT * FROM user_badges WHERE creator_player=? ORDER BY created_at DESC LIMIT 50").all(player);
    const held = db
      .prepare("SELECT b.* FROM user_badge_claims c JOIN user_badges b ON b.id=c.badge_id WHERE c.player_id=? ORDER BY c.created_at DESC LIMIT 200")
      .all(player);
    return {
      enabled: settings.enabled,
      contractId: c?.contractId ?? null,
      minting: !!c?.ready,
      account: linkedAccount(player),
      limits: { maxActive: settings.maxActivePerPlayer, maxPerDay: settings.maxPerDay, maxSupply: settings.maxSupply },
      icons: USER_ICONS,
      colors: USER_COLORS,
      created: created.map((r) => userRow(r, player)),
      held: held.map((r) => userRow(r, player)),
      nearby: at ? nearUser(player, at) : [],
    };
  }

  function nearUser(player, at, radiusM = 5000) {
    // Cheap bounding box first, exact distance after.
    const dLat = radiusM / 111_000,
      dLng = radiusM / (111_000 * Math.max(0.1, Math.cos((at.lat * Math.PI) / 180)));
    return db
      .prepare(
        "SELECT * FROM user_badges WHERE state IN('queued','live') AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 200",
      )
      .all(at.lat - dLat, at.lat + dLat, at.lng - dLng, at.lng + dLng)
      .map((r) => ({ ...userRow(r, player), distanceM: Math.round(distance(at, r)) }))
      .filter((b) => b.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 20);
  }

  function overview(player, at = null) {
    if (at) point(at);
    return { places: placesView(player, at), user: userView(player, at) };
  }

  function requireUser(player) {
    assert(settings.enabled, "Player badges are not open on this server yet.", 503, "USER_BADGES_OFF");
    const account = linkedAccount(player);
    assert(account, "Link a NEAR account first: player badges live on NEAR.", 409, "NEAR_ACCOUNT_REQUIRED");
    return account;
  }

  function createUserBadge(player, input = {}) {
    const account = requireUser(player);
    const t = now();
    const title = clean(input.title, 48);
    const description = clean(input.description, 280);
    assert(title.length >= 3, "Give the badge a title of at least 3 characters.", 400, "BADGE_TITLE");
    assert(!hasControl(title) && !hasControl(description), "Use plain text only.", 400, "BADGE_TEXT");
    const icon = USER_ICONS.includes(input.icon) ? input.icon : USER_ICONS[0];
    const color = USER_COLORS.includes(input.color) ? input.color : USER_COLORS[0];
    const kind = USER_KINDS.includes(input.kind) ? input.kind : null;
    assert(kind, "Choose what the badge is for: a place, an event or a quest.", 400, "BADGE_KIND");
    const maxSupply = Number(input.maxSupply ?? 50);
    assert(Number.isSafeInteger(maxSupply) && maxSupply >= 1 && maxSupply <= settings.maxSupply, `Supply must be 1–${settings.maxSupply}.`, 400, "BADGE_SUPPLY");
    const endsAt = input.endsAt == null || input.endsAt === "" ? null : Number(input.endsAt);
    assert(endsAt === null || (Number.isSafeInteger(endsAt) && endsAt > t + 3_600_000 && endsAt < t + 366 * 86_400_000), "The end date must be between one hour and one year from now.", 400, "BADGE_END");
    const active = db.prepare("SELECT count(*) AS n FROM user_badges WHERE creator_player=? AND state IN('queued','live')").get(player).n;
    assert(active < settings.maxActivePerPlayer, `You can run ${settings.maxActivePerPlayer} badges at a time.`, 429, "BADGE_LIMIT");
    const today = db.prepare("SELECT count(*) AS n FROM user_badges WHERE creator_player=? AND created_at>?").get(player, t - 86_400_000).n;
    assert(today < settings.maxPerDay, `You can create ${settings.maxPerDay} badges a day.`, 429, "BADGE_DAILY_LIMIT");

    let lat = null,
      lng = null,
      radius = null,
      questRef = null,
      code = null;
    if (kind === "place" || (kind === "event" && input.fix)) {
      // A place badge is made where you stand: the creator has been there.
      radius = Math.round(Number(input.radiusM ?? 100));
      assert(Number.isSafeInteger(radius) && radius >= 30 && radius <= 2000, "The radius must be 30–2000 m.", 400, "BADGE_RADIUS");
      const at = placeFix(input.fix, t, radius);
      lat = Math.round(at.lat * 1e6) / 1e6;
      lng = Math.round(at.lng * 1e6) / 1e6;
    }
    if (kind === "event") {
      code = clean(input.code, 32) || randomBytes(4).toString("hex");
      assert(code.length >= 4 && !hasControl(code), "The event code must be 4–32 characters.", 400, "BADGE_CODE");
    }
    if (kind === "quest") {
      questRef = clean(input.questRef, 96);
      const m = /^creator:([A-Za-z0-9_-]{1,80})$/.exec(questRef);
      assert(m, "Pick one of your community quests.", 400, "BADGE_QUEST");
      let quest = null;
      try {
        quest = db.prepare("SELECT author FROM creator_quests WHERE id=?").get(m[1]);
      } catch {
        quest = null;
      }
      assert(quest && quest.author === player, "You can only make a badge for your own community quest.", 403, "BADGE_QUEST_OWNER");
    }
    let id;
    do id = `${slug(title) || "badge"}-${randomBytes(3).toString("hex")}`;
    while (db.prepare("SELECT 1 FROM user_badges WHERE id=?").get(id));
    db.prepare(
      "INSERT INTO user_badges(id,creator_player,creator_account,title,description,icon,color,kind,lat,lng,radius_m,quest_ref,code,max_supply,starts_at,ends_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)",
    ).run(id, player, account, title, description, icon, color, kind, lat, lng, radius, questRef, code, maxSupply, null, endsAt, t, t);
    return userRow(db.prepare("SELECT * FROM user_badges WHERE id=?").get(id), player);
  }

  function claimUserBadge(player, input = {}) {
    const account = requireUser(player);
    const t = now();
    const r = db.prepare("SELECT * FROM user_badges WHERE id=?").get(String(input.badgeId || ""));
    assert(r && (r.state === "live" || r.state === "queued"), "This badge is not available.", 404, "BADGE_NOT_FOUND");
    const existing = db.prepare("SELECT * FROM user_badge_claims WHERE badge_id=? AND player_id=?").get(r.id, player);
    if (existing && existing.state !== "failed") return { badge: userRow(r, player), already: true };
    assert(!r.starts_at || t >= r.starts_at, "This badge is not open yet.", 409, "BADGE_NOT_OPEN");
    assert(!r.ends_at || t < r.ends_at, "This badge has ended.", 410, "BADGE_ENDED");
    const given = db.prepare("SELECT count(*) AS n FROM user_badge_claims WHERE badge_id=? AND state!='failed'").get(r.id).n;
    assert(given < r.max_supply, "All of these badges are given out.", 409, "BADGE_SOLD_OUT");
    const other = db.prepare("SELECT 1 FROM user_badge_claims WHERE badge_id=? AND account_id=? AND player_id!=? AND state!='failed'").get(r.id, account, player);
    assert(!other, "This NEAR account already holds the badge.", 409, "BADGE_ACCOUNT_HOLDS");
    if (r.lat != null) {
      const at = placeFix(input.fix, t, r.radius_m);
      assert(distance(at, r) <= r.radius_m, "Get closer to the badge's place, then try again.", 422, "OUT_OF_RANGE");
    }
    if (r.kind === "event")
      assert(
        typeof input.code === "string" && codeHash(r.id, input.code) === codeHash(r.id, r.code || ""),
        "That code does not match. Ask the organiser for the event code.",
        422,
        "BADGE_CODE",
      );
    if (r.kind === "quest") {
      const questId = r.quest_ref.slice("creator:".length);
      let done = null;
      try {
        done = db.prepare("SELECT 1 FROM creator_completion_receipts WHERE quest_id=? AND participant=?").get(questId, player);
      } catch {
        done = null;
      }
      assert(done, "Finish the quest first; the badge unlocks when it is accepted.", 409, "BADGE_QUEST_OPEN");
    }
    if (existing)
      db.prepare("UPDATE user_badge_claims SET state='queued',account_id=?,attempts=0,error=NULL,updated_at=? WHERE badge_id=? AND player_id=?").run(account, t, r.id, player);
    else
      db.prepare("INSERT INTO user_badge_claims(badge_id,player_id,account_id,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)").run(r.id, player, account, t, t);
    return { badge: userRow(r, player), already: false };
  }

  function userBadge(player, id) {
    const r = db.prepare("SELECT * FROM user_badges WHERE id=?").get(String(id || ""));
    assert(r && r.state !== "hidden", "This badge is not available.", 404, "BADGE_NOT_FOUND");
    return userRow(r, player);
  }

  // ------------------------------------------------------------ chain queue

  function pendingCreations(limit = 5) {
    return db.prepare("SELECT * FROM user_badges WHERE state='queued' ORDER BY created_at LIMIT ?").all(limit);
  }
  function pendingClaims(limit = 10) {
    return db
      .prepare(
        "SELECT c.*,b.id AS bid FROM user_badge_claims c JOIN user_badges b ON b.id=c.badge_id WHERE c.state='queued' AND b.state='live' ORDER BY c.created_at LIMIT ?",
      )
      .all(limit);
  }
  function markCreated(id, tx) {
    db.prepare("UPDATE user_badges SET state='live',chain_tx=?,error=NULL,updated_at=? WHERE id=? AND state='queued'").run(tx, now(), id);
  }
  function markCreateFailed(id, error) {
    const r = db.prepare("SELECT attempts FROM user_badges WHERE id=?").get(id);
    const attempts = (r?.attempts ?? 0) + 1;
    db.prepare("UPDATE user_badges SET attempts=?,error=?,state=?,updated_at=? WHERE id=?").run(
      attempts,
      String(error).slice(0, 300),
      attempts >= MAX_CLAIM_ATTEMPTS ? "failed" : "queued",
      now(),
      id,
    );
  }
  function markMinted(badgeId, player, tx, tokenId) {
    db.prepare("UPDATE user_badge_claims SET state='minted',chain_tx=?,token_id=?,error=NULL,updated_at=? WHERE badge_id=? AND player_id=?").run(tx, tokenId, now(), badgeId, player);
  }
  function markClaimFailed(badgeId, player, error, final = false) {
    const r = db.prepare("SELECT attempts FROM user_badge_claims WHERE badge_id=? AND player_id=?").get(badgeId, player);
    const attempts = (r?.attempts ?? 0) + 1;
    db.prepare("UPDATE user_badge_claims SET attempts=?,error=?,state=?,updated_at=? WHERE badge_id=? AND player_id=?").run(
      attempts,
      String(error).slice(0, 300),
      final || attempts >= MAX_CLAIM_ATTEMPTS ? "failed" : "queued",
      now(),
      badgeId,
      player,
    );
  }
  // ------------------------------------------------------------ place mints

  /** Place designs some queued mint needs that are not live on chain yet. */
  function pendingPlaceDesigns(contractId, limit = 3) {
    const ids = db
      .prepare(
        "SELECT DISTINCT m.badge_id AS id FROM place_badge_mints m LEFT JOIN place_badge_designs d ON d.badge_id=m.badge_id WHERE m.state='queued' AND (d.badge_id IS NULL OR d.state='queued') ORDER BY m.created_at LIMIT ?",
      )
      .all(limit * 4);
    const out = [];
    for (const { id } of ids) {
      const badge = catalog.byId.get(id);
      if (!badge) continue;
      out.push({ badgeId: id, row: placeDesignRow(badge, contractId) });
      if (out.length >= limit) break;
    }
    return out;
  }
  function markPlaceDesign(badgeId, chainId, { tx = null, error = null } = {}) {
    const t = now();
    const prev = db.prepare("SELECT attempts FROM place_badge_designs WHERE badge_id=?").get(badgeId);
    const attempts = (prev?.attempts ?? 0) + (error ? 1 : 0);
    const state = error ? (attempts >= MAX_CLAIM_ATTEMPTS ? "failed" : "queued") : "live";
    db.prepare(
      "INSERT INTO place_badge_designs(badge_id,chain_id,state,attempts,chain_tx,error,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(badge_id) DO UPDATE SET state=excluded.state,attempts=excluded.attempts,chain_tx=COALESCE(excluded.chain_tx,chain_tx),error=excluded.error,updated_at=excluded.updated_at",
    ).run(badgeId, chainId, state, attempts, tx, error ? String(error).slice(0, 300) : null, t);
    if (state === "failed")
      db.prepare("UPDATE place_badge_mints SET state='failed',error=?,updated_at=? WHERE badge_id=? AND state='queued'").run("The place design could not be created on NEAR.", t, badgeId);
  }
  /**
   * Queued mints whose design is live, with the account resolved now. A player
   * without a linked account is skipped for NO_ACCOUNT_RETRY_MS.
   */
  function pendingPlaceMints(limit = 10) {
    const t = now();
    const rows = db
      .prepare(
        "SELECT m.player_id,m.badge_id,d.chain_id FROM place_badge_mints m JOIN place_badge_designs d ON d.badge_id=m.badge_id AND d.state='live' WHERE m.state='queued' AND m.next_at<=? ORDER BY m.next_at,m.created_at LIMIT ?",
      )
      .all(t, limit * 3);
    const out = [];
    for (const r of rows) {
      const account = linkedAccount(r.player_id);
      if (!account) {
        db.prepare("UPDATE place_badge_mints SET next_at=?,updated_at=? WHERE player_id=? AND badge_id=?").run(t + NO_ACCOUNT_RETRY_MS, t, r.player_id, r.badge_id);
        continue;
      }
      out.push({ playerId: r.player_id, badgeId: r.badge_id, chainId: r.chain_id, accountId: account });
      if (out.length >= limit) break;
    }
    return out;
  }
  function markPlaceMinted(player, badgeId, accountId, tx, tokenId) {
    db.prepare("UPDATE place_badge_mints SET state='minted',account_id=?,chain_tx=COALESCE(?,chain_tx),token_id=?,error=NULL,updated_at=? WHERE player_id=? AND badge_id=?").run(
      accountId,
      tx,
      tokenId,
      now(),
      player,
      badgeId,
    );
  }
  function markPlaceMintFailed(player, badgeId, error, final = false) {
    const t = now();
    const r = db.prepare("SELECT attempts FROM place_badge_mints WHERE player_id=? AND badge_id=?").get(player, badgeId);
    const attempts = (r?.attempts ?? 0) + 1;
    db.prepare("UPDATE place_badge_mints SET attempts=?,error=?,state=?,next_at=?,updated_at=? WHERE player_id=? AND badge_id=?").run(
      attempts,
      String(error).slice(0, 300),
      final || attempts >= MAX_CLAIM_ATTEMPTS ? "failed" : "queued",
      t + 30_000 * 2 ** attempts,
      t,
      player,
      badgeId,
    );
  }

  /** Operator moderation: hides a design here (chain pause is separate). */
  function hide(id) {
    return db.prepare("UPDATE user_badges SET state='hidden',updated_at=? WHERE id=?").run(now(), id).changes === 1;
  }

  /** Health summary: catalog size, chain readiness and the mint queue. */
  function status() {
    const c = chain();
    const q = (sql) => db.prepare(sql).get().n;
    return {
      status: "on",
      places: catalog.badges.length,
      placeVersion: catalog.version,
      placeAwards: q("SELECT count(*) AS n FROM place_badge_awards"),
      userBadges: settings.enabled ? "on" : "off",
      placeMinting: settings.placeMints ? "on" : "off",
      contractId: c?.contractId ?? null,
      minting: !!c?.ready,
      minterError: c?.ready ? null : (c?.error ?? null),
      queue: {
        designs: q("SELECT count(*) AS n FROM user_badges WHERE state='queued'"),
        claims: q("SELECT count(*) AS n FROM user_badge_claims WHERE state='queued'"),
        failed: q("SELECT count(*) AS n FROM user_badge_claims WHERE state='failed'"),
      },
      placeMints: {
        designsLive: q("SELECT count(*) AS n FROM place_badge_designs WHERE state='live'"),
        queued: q("SELECT count(*) AS n FROM place_badge_mints WHERE state='queued'"),
        minted: q("SELECT count(*) AS n FROM place_badge_mints WHERE state='minted'"),
        failed: q("SELECT count(*) AS n FROM place_badge_mints WHERE state='failed'"),
      },
    };
  }

  return {
    status,
    catalog,
    settings,
    check,
    overview,
    createUserBadge,
    claimUserBadge,
    userBadge,
    pendingCreations,
    pendingClaims,
    markCreated,
    markCreateFailed,
    markMinted,
    markClaimFailed,
    pendingPlaceDesigns,
    markPlaceDesign,
    pendingPlaceMints,
    markPlaceMinted,
    markPlaceMintFailed,
    hide,
  };
}
