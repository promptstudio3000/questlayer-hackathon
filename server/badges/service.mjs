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
import { BADGES_SCHEMA } from "./schema.mjs";
export { BADGES_SCHEMA };
import { placesAt, nearestPlaces, PLACE_KINDS } from "./place-catalog.mjs";


export const GPS_MAX_AGE_MS = 15_000;
/** Faster than an airliner between two checks: the second fix is not trusted. */
export const MAX_TRAVEL_MPS = 340;
export const USER_KINDS = Object.freeze(["place", "event", "quest"]);
export const USER_ICONS = Object.freeze(["🏅", "⭐", "🗺️", "⛰️", "🔭", "🏛️", "🌲", "🌊", "🏰", "🎉", "🎵", "🍺", "☕", "🚲", "🥾", "📸", "🧭", "🔥", "💎", "👻"]);
export const USER_COLORS = Object.freeze(["#c08a2b", "#2b7bc0", "#3a9d5d", "#b8432f", "#7d4cc0", "#d06b9c", "#4a5568", "#0f8b8d"]);
export const MAX_CLAIM_ATTEMPTS = 5;

export function userBadgeSettings(env = process.env, network = "testnet") {
  const int = (v, d, min, max) => {
    const n = v === undefined || v === "" ? d : Number(v);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : d;
  };
  return Object.freeze({
    // Player badges are sponsored by the game on testnet; mainnet needs an
    // explicit switch and its own funding decision.
    enabled: env.USER_BADGES_ENABLED ? env.USER_BADGES_ENABLED === "1" : network === "testnet",
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
  const lastFix = new Map();

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
      if (insert.run(player, badge.id, at.lat, at.lng, at.accuracy, t).changes === 1)
        earned.push({ ...badge, earnedAt: t });
    }
    return { earned, suspicious: false };
  }

  function placesView(player, at) {
    const earned = new Map(earnedPlaces(player).map((r) => [r.badgeId, r.earnedAt]));
    const byKind = Object.fromEntries(PLACE_KINDS.map((k) => [k, { earned: 0, total: 0 }]));
    for (const b of catalog.badges) {
      byKind[b.kind].total++;
      if (earned.has(b.id)) byKind[b.kind].earned++;
    }
    const list = catalog.badges.map((b) => ({ ...b, earnedAt: earned.get(b.id) ?? null }));
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
  /** Operator moderation: hides a design here (chain pause is separate). */
  function hide(id) {
    return db.prepare("UPDATE user_badges SET state='hidden',updated_at=? WHERE id=?").run(now(), id).changes === 1;
  }

  return {
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
    hide,
  };
}
