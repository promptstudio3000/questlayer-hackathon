// Nearby explorer card and "waves" (4 Nov 2026).
//
// Tapping another explorer on the map opens a small card: name, level, the
// Aavegotchi wearables they wear (gold check when their wallet holds the
// original), their Auras, and a few safe actions. The card is only available
// while that explorer shares their position (explicit opt-in, docs/PEER-APPEARANCES.md)
// and neither side has blocked the other.
//
// Waves are the minimal, safe first step of player messages: a fixed set of
// preset phrases, no free text, so there is nothing to moderate and no way
// to pass phone numbers, links or other personal data. A wave needs both
// explorers to be sharing their position right now, respects blocks both ways,
// is rate limited per pair, per sender and per receiver, and disappears after
// an hour. Free-text chat is a later, separate decision (docs/PLAYER-CARDS.md).
import { assert, id } from "./domain.mjs";
import { demoProgression } from "./database.mjs";
import { isSocialBlocked } from "./social-content.mjs";
import { wornWearables, publicWearable, verifiedItemIds, VERIFIED_FOR_MS, WEARABLES } from "./gotchi-wearables.mjs";
import { outfitEquipped, outfitVersion, ownedOutfit } from "./gotchi-outfit.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "./schema-compatibility.mjs";

export const WAVE_PHRASES = Object.freeze({
  hello: "Hello!",
  "nice-look": "Nice look!",
  "team-up": "Want to explore together?",
  "found-here": "There is a find near here.",
  thanks: "Thanks!",
  "see-you": "See you around!",
});
export const WAVE_LIMITS = Object.freeze({
  pairMs: 60_000,
  perSenderHour: 20,
  perReceiverHour: 30,
  keepMs: 3600_000,
});
const PRESENCE_FRESH_MS = 30_000;

export const WAVES_SCHEMA = registerModuleSchema({
  name: "player-waves",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS player_waves(id TEXT PRIMARY KEY,from_id TEXT NOT NULL REFERENCES players(id),to_id TEXT NOT NULL REFERENCES players(id),phrase TEXT NOT NULL,created_at INTEGER NOT NULL,seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0,1)),CHECK(from_id!=to_id));
CREATE INDEX IF NOT EXISTS player_waves_to ON player_waves(to_id,seen,created_at);
CREATE INDEX IF NOT EXISTS player_waves_from ON player_waves(from_id,created_at)`,
});
const ready = new WeakSet();
function ensureWavesSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, WAVES_SCHEMA);
  ready.add(db);
}

const validPlayerId = (value) =>
  typeof value === "string" && /^player_[a-f0-9-]{36}$/.test(value);
// Test-world bots (TEST_SEED=1, server/test-seed) walk the map with "seed-"
// ids. Their card is the same dialog, labelled "demo-bot"; no block. A wave to
// a bot is answered at once with a wave back, so the guided tour's wave step
// always works (docs/GUIDED-TOUR.md).
export const isDemoBot = (value) =>
  typeof value === "string" && /^seed-[a-z0-9-]{1,60}$/.test(value);

function sharing(db, player, now) {
  return db
    .prepare(
      "SELECT arena FROM presence WHERE player_id=? AND expires_at>? AND updated_at>?",
    )
    .get(player, now, now - PRESENCE_FRESH_MS);
}

/**
 * The card another explorer may see. `appearance` is the same reduced public
 * look the map uses (colors only). No wallet address, account or inventory.
 */
export function playerCard(db, viewer, target, appearance, now = Date.now()) {
  assert(validPlayerId(target) || isDemoBot(target), "Invalid explorer.", 400);
  const self = viewer === target;
  const demoBot = isDemoBot(target);
  const theirs = sharing(db, target, now);
  // The profile is public (Lubos, 10 Nov 2026): visible without sharing the
  // position, never with it. A block hides it both ways.
  assert(
    self || !isSocialBlocked(db, viewer, target),
    "This explorer's profile is not available.",
    404,
  );
  const row = db
    .prepare("SELECT id,name,xp,created_at FROM players WHERE id=?")
    .get(target);
  assert(row, "This explorer's profile is not available.", 404);
  const { level, availableXp } = demoProgression(db, target, row);
  const original = profileOriginal(db, target, now);
  const worn = wornWearables(db, target, now);
  const mine = !self && !demoBot && sharing(db, viewer, now);
  const count = (sql) => {
    try {
      return db.prepare(sql).get(target)?.n || 0;
    } catch {
      return 0; // table not created yet on this database
    }
  };
  return {
    id: row.id,
    name: row.name,
    level,
    xp: availableXp,
    demoBot,
    joinedAt: row.created_at,
    badges:
      count("SELECT COUNT(*) AS n FROM place_badge_awards WHERE player_id=?") +
      count("SELECT COUNT(*) AS n FROM user_badge_claims WHERE player_id=?"),
    stats: {
      finds: count("SELECT COUNT(*) AS n FROM coins WHERE claimant=?"),
      quests: count("SELECT COUNT(*) AS n FROM quest_claims WHERE player_id=?"),
      monsters: count("SELECT COUNT(*) AS n FROM actor_challenges WHERE player_id=? AND state='won'"),
      wearables: count("SELECT COUNT(*) AS n FROM wearable_clones WHERE player_id=? AND source='find'"),
    },
    self,
    wearables: worn,
    slots: profileSlots(worn, original),
    auras: {
      above: appearance?.above || null,
      below: appearance?.below || null,
    },
    original: !!(appearance?.skinTokenId || original),
    // Changes when the outfit does, so the avatar art is fetched again.
    look: outfitVersion(original?.outfit),
    // Own profile only: whether slots dress the gotchi, and which differ from its real gear.
    dress: self
      ? {
          gotchi: !!original,
          dressed: PROFILE_SLOTS.filter((_, i) => Object.hasOwn(original?.outfit || {}, String(i))),
        }
      : null,
    // Name and rarity score of the worn original; never the token's wallet.
    gotchi: original ? { name: original.name, brs: original.brs } : null,
    canWave: demoBot ? !self && !!sharing(db, viewer, now) : !self && !!mine && mine.arena === theirs?.arena,
    waveHint: self || demoBot
      ? null
      : mine
        ? mine.arena === theirs?.arena
          ? null
          : "You are in a different realm."
        : "Share your position to wave.",
    phrases: Object.entries(WAVE_PHRASES).map(([key, text]) => ({ key, text })),
  };
}

// Equipment slots in Aavegotchi order (equippedWearables indexes 0-6).
export const PROFILE_SLOTS = ["body", "face", "eyes", "head", "handLeft", "handRight", "pet"];

/** What sits in each slot: the worn original's own gear, else worn clones. */
export function profileSlots(worn, original) {
  const slots = Object.fromEntries(PROFILE_SLOTS.map((slot) => [slot, null]));
  if (original) {
    PROFILE_SLOTS.forEach((slot, index) => {
      const item = WEARABLES.get(original.equipped?.[index]);
      if (!item) return;
      // Real gear is the gotchi's own; an outfit item is gold only when the wallet holds it.
      const dressed = Object.hasOwn(original.outfit || {}, String(index));
      const verified = !dressed || !!original.verified?.has(item.id);
      slots[slot] = { ...publicWearable(item), verified, source: verified ? "original" : "clone" };
    });
  } else {
    for (const w of worn) {
      const slot = w.slot === "hand" ? (slots.handRight ? "handLeft" : "handRight") : w.slot;
      if (slot in slots && !slots[slot]) slots[slot] = { ...w, source: "clone" };
    }
  }
  return PROFILE_SLOTS.map((slot) => ({ slot, item: slots[slot] }));
}

/**
 * The original Aavegotchi an explorer wears, for their public profile: read
 * from an ownership snapshot at most a day old (the same window as verified
 * wearables), so the profile shows it while they are offline too.
 */
export function profileOriginal(db, player, now = Date.now()) {
  try {
    const row = db.prepare("SELECT appearance FROM players WHERE id=?").get(player);
    const appearance = JSON.parse(row?.appearance || "{}");
    if (!/^\d{1,24}$/.test(appearance.originTokenId || "")) return null;
    const link = db
      .prepare("SELECT data FROM external_links WHERE player_id=? AND address=? AND verified_at>=?")
      .get(player, appearance.address, now - VERIFIED_FOR_MS);
    const g = link && JSON.parse(link.data).gotchis?.find((x) => x.tokenId === appearance.originTokenId);
    if (!g || typeof g.svg !== "string" || g.svg.length > 200000) return null;
    const outfit = ownedOutfit(db, player, appearance.outfit, now);
    return {
      name: String(g.name || "").slice(0, 40),
      brs: Number.isFinite(g.brs) ? g.brs : null,
      svg: g.svg,
      equipped: outfitEquipped(g, outfit),
      gotchi: g,
      outfit,
      verified: verifiedItemIds(db, player, now),
    };
  } catch {
    return null;
  }
}

export function sendWave(db, from, to, phrase, now = Date.now()) {
  ensureWavesSchema(db);
  const bot = isDemoBot(to);
  assert((validPlayerId(to) || bot) && to !== from, "Invalid explorer.", 400);
  assert(
    typeof phrase === "string" && Object.hasOwn(WAVE_PHRASES, phrase),
    "Pick one of the ready phrases.",
    400,
  );
  const mine = sharing(db, from, now);
  assert(mine, "Share your position to wave.", 403);
  if (bot) {
    assert(db.prepare("SELECT 1 FROM players WHERE id=?").get(to), "This explorer's profile is not available.", 404);
  } else {
    const theirs = sharing(db, to, now);
    assert(
      theirs && theirs.arena === mine.arena && !isSocialBlocked(db, from, to),
      "This explorer is no longer sharing their position.",
      404,
    );
  }
  db.prepare("DELETE FROM player_waves WHERE created_at<?").run(
    now - WAVE_LIMITS.keepMs,
  );
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  assert(
    !count(
      "SELECT COUNT(*) AS n FROM player_waves WHERE from_id=? AND to_id=? AND created_at>?",
      from,
      to,
      now - WAVE_LIMITS.pairMs,
    ),
    "You just waved. Give them a minute.",
    429,
  );
  assert(
    count(
      "SELECT COUNT(*) AS n FROM player_waves WHERE from_id=? AND created_at>?",
      from,
      now - 3600_000,
    ) < WAVE_LIMITS.perSenderHour,
    "That is a lot of waves. Try again later.",
    429,
  );
  assert(
    count(
      "SELECT COUNT(*) AS n FROM player_waves WHERE to_id=? AND created_at>?",
      to,
      now - 3600_000,
    ) < WAVE_LIMITS.perReceiverHour,
    "This explorer has had many waves. Try again later.",
    429,
  );
  db.prepare(
    "INSERT INTO player_waves(id,from_id,to_id,phrase,created_at,seen) VALUES(?,?,?,?,?,0)",
  ).run(id("wave"), from, to, phrase, now);
  if (!bot) return { sent: true, phrase: WAVE_PHRASES[phrase] };
  // The bot waves back right away; it is shown on the card, so it is stored as seen.
  const back = phrase === "thanks" ? "see-you" : phrase === "hello" ? "hello" : "thanks";
  db.prepare(
    "INSERT INTO player_waves(id,from_id,to_id,phrase,created_at,seen) VALUES(?,?,?,?,?,1)",
  ).run(id("wave"), to, from, back, now);
  return { sent: true, phrase: WAVE_PHRASES[phrase], reply: { key: back, text: WAVE_PHRASES[back] } };
}

/** Unseen waves for a sharing explorer; reading marks them seen. */
export function takeWaves(db, player, now = Date.now()) {
  ensureWavesSchema(db);
  if (!sharing(db, player, now)) return [];
  const rows = db
    .prepare(
      `SELECT w.id,w.from_id,w.phrase,w.created_at,p.name FROM player_waves w JOIN players p ON p.id=w.from_id
       WHERE w.to_id=? AND w.seen=0 AND w.created_at>? ORDER BY w.created_at LIMIT 5`,
    )
    .all(player, now - WAVE_LIMITS.keepMs);
  if (!rows.length) return [];
  const mark = db.prepare("UPDATE player_waves SET seen=1 WHERE id=?");
  for (const row of rows) mark.run(row.id);
  return rows
    .filter((row) => !isSocialBlocked(db, player, row.from_id))
    .map((row) => ({
      from: row.from_id,
      name: row.name,
      phrase: Object.hasOwn(WAVE_PHRASES, row.phrase) ? row.phrase : "hello",
      text: WAVE_PHRASES[row.phrase] || WAVE_PHRASES.hello,
      at: row.created_at,
    }));
}
