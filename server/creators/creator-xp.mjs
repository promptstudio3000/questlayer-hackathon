// XP the game gives quest creators (owner decision, 11 Nov 2026).
//
// A creator earns XP, never QGOLD, for building quests: once when a quest is
// first published after moderator review (by its type and size, table in
// server/data/creator-xp.json), and again for every accepted completion by
// another explorer, up to a daily cap. Each award is written once per
// (quest, kind, participant) so retries never pay twice. QGOLD only reaches a
// creator through QGOLD they put into the quest themselves.
import { readFileSync } from "node:fs";
import { history } from "../database.mjs";
import { recordChainAction } from "../chain-ledger/service.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";

const DAY_MS = 86_400_000;
const table = JSON.parse(
  readFileSync(new URL("../data/creator-xp.json", import.meta.url), "utf8"),
);
export const CREATOR_XP = Object.freeze({
  publish: Object.freeze({ ...table.publish }),
  trailStopBonus: table.trailStopBonus,
  completion: table.completion,
  completionsPerDay: table.completionsPerDay,
});

export const CREATOR_XP_SCHEMA = registerModuleSchema({
  name: "creator-xp",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS creator_xp_awards(quest_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('publish','completion')),participant TEXT NOT NULL DEFAULT '',author TEXT NOT NULL,xp INTEGER NOT NULL CHECK(xp>0),created_at INTEGER NOT NULL,PRIMARY KEY(quest_id,kind,participant));
CREATE INDEX IF NOT EXISTS creator_xp_awards_author ON creator_xp_awards(author,created_at)`,
});
const ready = new WeakSet();
export function ensureCreatorXpSchema(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, CREATOR_XP_SCHEMA);
  ready.add(db);
}

/** The quest type the XP table uses: a place template, or "story" without a place. */
export function creatorQuestKind(place) {
  const template = place?.template;
  return Object.hasOwn(CREATOR_XP.publish, template) && template !== "story"
    ? template
    : "story";
}
/** XP a creator gets when this quest is first published. */
export function publishXp(place) {
  const kind = creatorQuestKind(place);
  const stops = Array.isArray(place?.points) ? place.points.length : 0;
  return (
    CREATOR_XP.publish[kind] +
    (kind === "trail" ? Math.max(0, stops - 2) * CREATOR_XP.trailStopBonus : 0)
  );
}

function grant(db, { questId, kind, participant = "", author, xp, title, now }) {
  ensureCreatorXpSchema(db);
  if (!(xp > 0)) return 0;
  const fresh = db
    .prepare(
      "INSERT OR IGNORE INTO creator_xp_awards(quest_id,kind,participant,author,xp,created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(questId, kind, participant, author, xp, now).changes;
  if (!fresh) return 0;
  if (!db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(xp, author).changes)
    return 0;
  history(db, author, "creator", title, 0, { questId, xp, source: `creator-${kind}` });
  if (!author.startsWith("seed-"))
    recordChainAction(db, {
      player: author,
      kind: "quest",
      xp,
      ref: `creator-${kind}:${questId}${participant ? `:${participant}` : ""}`,
      evidence: { source: `creator-${kind}`, questId },
      now,
    });
  return xp;
}

/** First publication of a quest. Call inside the review transaction. */
export function awardPublishXp(db, { questId, author, place, title, now = Date.now() }) {
  return grant(db, {
    questId,
    kind: "publish",
    author,
    xp: publishXp(place),
    title: `Quest published: ${title || "your quest"}`,
    now,
  });
}

/** Another explorer's accepted completion. Call inside the review transaction. */
export function awardCompletionXp(db, { questId, author, participant, title, now = Date.now() }) {
  if (!participant || participant === author) return 0;
  ensureCreatorXpSchema(db);
  const today = db
    .prepare(
      "SELECT COUNT(*) AS n FROM creator_xp_awards WHERE author=? AND kind='completion' AND created_at>?",
    )
    .get(author, now - DAY_MS).n;
  if (today >= CREATOR_XP.completionsPerDay) return 0;
  return grant(db, {
    questId,
    kind: "completion",
    participant,
    author,
    xp: CREATOR_XP.completion,
    title: `Explorer finished your quest: ${title || "your quest"}`,
    now,
  });
}

/** XP a creator earned from their quests so far. */
export function creatorXpEarned(db, author) {
  // Read only: a database without any award yet has no table.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_xp_awards'").get())
    return 0;
  return db
    .prepare("SELECT COALESCE(SUM(xp),0) AS n FROM creator_xp_awards WHERE author=?")
    .get(author).n;
}
