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
import { wornWearables } from "./gotchi-wearables.mjs";
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
  assert(validPlayerId(target), "Invalid explorer.", 400);
  const self = viewer === target;
  const theirs = sharing(db, target, now);
  assert(
    self || (theirs && !isSocialBlocked(db, viewer, target)),
    "This explorer is no longer sharing their position.",
    404,
  );
  const row = db.prepare("SELECT id,name,xp FROM players WHERE id=?").get(target);
  assert(row, "This explorer is no longer sharing their position.", 404);
  const { level } = demoProgression(db, target, row);
  const mine = !self && sharing(db, viewer, now);
  return {
    id: row.id,
    name: row.name,
    level,
    self,
    wearables: wornWearables(db, target, now),
    auras: {
      above: appearance?.above || null,
      below: appearance?.below || null,
    },
    original: !!appearance?.skinTokenId,
    canWave: !self && !!mine && mine.arena === theirs?.arena,
    waveHint: self
      ? null
      : mine
        ? mine.arena === theirs?.arena
          ? null
          : "You are in a different realm."
        : "Share your position to wave.",
    phrases: Object.entries(WAVE_PHRASES).map(([key, text]) => ({ key, text })),
  };
}

export function sendWave(db, from, to, phrase, now = Date.now()) {
  ensureWavesSchema(db);
  assert(validPlayerId(to) && to !== from, "Invalid explorer.", 400);
  assert(
    typeof phrase === "string" && Object.hasOwn(WAVE_PHRASES, phrase),
    "Pick one of the ready phrases.",
    400,
  );
  const mine = sharing(db, from, now),
    theirs = sharing(db, to, now);
  assert(mine, "Share your position to wave.", 403);
  assert(
    theirs && theirs.arena === mine.arena && !isSocialBlocked(db, from, to),
    "This explorer is no longer sharing their position.",
    404,
  );
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
  return { sent: true, phrase: WAVE_PHRASES[phrase] };
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
