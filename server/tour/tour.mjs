// Guided tour of the Test Layer (docs/GUIDED-TOUR.md). Helper Pip walks a new
// explorer through every quest type, encounter and zone, then through using
// what they earned, so every kind of transaction happens once.
//
// A step is done when the game's own records show it: ledger actions
// (chain_actions), sponsored transactions (relay_jobs), GOLD burns, waves,
// listings, tasks. Nothing is ticked from the client, so the tour can never
// claim a transaction that did not happen. The client picks the map target
// for the current step from the world it already holds.
import { registerModuleSchema, ensureModuleVersion } from "../schema-compatibility.mjs";
import { assert } from "../domain.mjs";

export const TOUR_SCHEMA = registerModuleSchema({
  name: "guided-tour",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS tour_progress(player_id TEXT PRIMARY KEY REFERENCES players(id),started_at INTEGER NOT NULL,skipped TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(skipped)),hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),finished_at INTEGER,updated_at INTEGER NOT NULL)`,
});

// Moments that leave no other record: a chat with a demo bot stores no text,
// so the tour notes only that it happened.
export const TOUR_MARKS_SCHEMA = registerModuleSchema({
  name: "guided-tour-marks",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS tour_marks(player_id TEXT NOT NULL REFERENCES players(id),step TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(player_id,step))`,
});

const ready = new WeakSet();
function ensure(db) {
  if (ready.has(db)) return;
  ensureModuleVersion(db, TOUR_SCHEMA);
  ensureModuleVersion(db, TOUR_MARKS_SCHEMA);
  ready.add(db);
}

/** Notes that the explorer did `step` where no other record shows it. */
export function tourMark(db, player, step, now = Date.now()) {
  ensure(db);
  db.prepare("INSERT OR IGNORE INTO tour_marks(player_id,step,at) VALUES(?,?,?)").run(player, step, now);
}
const mark = (step) => (db, p) => one(db, "SELECT 1 FROM tour_marks WHERE player_id=? AND step=?", p, step);

const tableExists = (db, name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const one = (db, sql, ...args) => {
  try {
    return !!db.prepare(sql).get(...args);
  } catch {
    return false; // a module that is not configured on this server has no table
  }
};
const action = (kinds) => (db, p) =>
  one(db, `SELECT 1 FROM chain_actions WHERE player_id=? AND kind IN (${kinds.map(() => "?").join(",")}) LIMIT 1`, p, ...kinds);
const relay = (methods, like = null) => (db, p) =>
  one(
    db,
    `SELECT 1 FROM relay_jobs WHERE player_id=? AND state!='failed' AND method_name IN (${methods.map(() => "?").join(",")})${like ? " AND call LIKE ?" : ""} LIMIT 1`,
    p,
    ...methods,
    ...(like ? [like] : []),
  );
const burn = (kinds) => (db, p) =>
  one(db, `SELECT 1 FROM gold_burns WHERE player_id=? AND kind IN (${kinds.map(() => "?").join(",")}) LIMIT 1`, p, ...kinds);
const any = (...checks) => (db, p) => checks.some((c) => c(db, p));
// The history feed records the same moments where the on-chain ledger is not
// configured (local runs); the ledger stays the first source.
const hist = (kind, where = "", ...args) => (db, p) =>
  one(db, `SELECT 1 FROM history WHERE player_id=? AND kind=?${where} LIMIT 1`, p, kind, ...args);

// Chapters follow the ring of demo zones around náměstí Republiky
// (docs/DEMO-ZONES.md), so the next spot is always the nearest one.
// `target` tells the client what to point at: a quest kind, an actor role or a place.
export const TOUR_STEPS = Object.freeze([
  { id: "coin", chapter: "start", target: { kind: "coin" }, say: "Grab the gold coin.", next: "Coins go straight to your QGOLD." , done: any(action(["coin"]), hist("coin", " AND title=?", "Street coin")) },
  { id: "find", chapter: "start", target: { kind: "find" }, say: "Open the sparkle nearby.", next: "Street finds give XP and sometimes an item.", done: any(action(["find"]), hist("coin", " AND title=?", "Street find")) },
  { id: "visit", chapter: "start", target: { kind: "quest", quest: "visit" }, say: "Visit this place.", next: "Place quests are everywhere on the map.", done: any(action(["quest"]), hist("quest")) },
  { id: "chest", chapter: "start", target: { kind: "quest", quest: "chest" }, say: "Open the zone chest.", next: "Chests give an Aura.", done: any(action(["chest"]), hist("quest", " AND json_extract(meta,'$.item') IS NOT NULL")) },
  { id: "wear", chapter: "start", target: { kind: "screen", screen: "inventory" }, say: "Try your Aura on.", next: "Everyone on the map sees what you wear.", done: any(relay(["equip_aura"]), (db, p) => one(db, "SELECT 1 FROM inventory WHERE player_id=? AND equipped=1 AND kind!='avatar' LIMIT 1", p)) },
  { id: "secure", chapter: "start", target: { kind: "screen", screen: "inventory" }, say: "Secure your Aura on NEAR.", next: "Now it's an NFT in your own account.", done: any(relay(["redeem_aura"]), (db, p) => one(db, "SELECT 1 FROM native_awards WHERE player_id=? AND state='minted' LIMIT 1", p)) },
  { id: "errand", chapter: "npcs", target: { kind: "actor", role: "quest-giver" }, say: "Ráda has an errand. Do it.", hint: "Show me marks her on the map. Walk up and tap her.", next: "Characters give quest lines with an Aura at the end.", done: any(action(["errand"]), hist("npc-quest")) },
  { id: "clue", chapter: "npcs", target: { kind: "quest", quest: "clue" }, say: "Solve the landmark clue.", next: "Clues are riddles about real places.", done: action(["clue"]) },
  { id: "monster", chapter: "monsters", target: { kind: "actor", role: "monster" }, say: "Beat the Lickquidator.", hint: "Show me marks it on the map. Walk up and tap it.", next: "Skill wins, never money. Losing costs only time.", done: any(action(["monster", "boss"]), hist("monster")) },
  // Pocket Wisps (lurkers) hide at street finds and show within 60 m; a quiz win gives a roll ticket.
  { id: "ticket", chapter: "monsters", target: { kind: "find" }, say: "Beat a Pocket Wisp for a roll ticket.", hint: "Wisps hide at sparkles and show within 60 m. Win their quiz.", next: "You won a roll ticket. A roll is free.", done: (db, p) => one(db, "SELECT 1 FROM monster_rewards WHERE player_id=? AND kind='roll' LIMIT 1", p) },
  { id: "roll", chapter: "monsters", target: { kind: "screen", screen: "rolls" }, say: "Roll your ticket at the wisp.", hint: "Inventory › Secured on NEAR › Roll at the wisp.", next: "The draw ran on NEAR, anyone can check it.", done: relay(["start_roll"]) },
  { id: "sell", chapter: "trade", target: { kind: "screen", screen: "market" }, say: "Sell an Aura on the market.", next: "A buyer picks it up in under a minute.", done: any(relay(["nft_transfer_call"], '%market%'), (db, p) => one(db, "SELECT 1 FROM listings WHERE seller=? LIMIT 1", p)) },
  { id: "trade", chapter: "trade", target: { kind: "actor", role: "trader" }, say: "Trade with Vojtěch.", hint: "Show me marks him on the map. Walk up and tap him.", next: "He trades through NEAR Intents.", done: relay(["add_public_key", "ft_transfer_call", "nft_transfer_call"], '%intents%') },
  { id: "shop", chapter: "trade", target: { kind: "screen", screen: "shop" }, say: "Buy an emote with QGOLD.", next: "Spending burns QGOLD, which backs everyone else's.", done: burn(["emote", "cosmetic", "gear", "lure"]) },
  { id: "note", chapter: "community", target: { kind: "action", action: "note" }, say: "Leave a note on the map.", next: "Notes stay for others to find.", done: any(relay(["set"], '%notes%'), (db, p) => one(db, "SELECT 1 FROM messages WHERE player_id=? LIMIT 1", p)) },
  { id: "shout", chapter: "community", target: { kind: "action", action: "shout" }, say: "Shout something on the map.", next: "Shouts show as a bubble here for a day.", done: burn(["shout"]) },
  { id: "topic", chapter: "community", target: { kind: "action", action: "topic" }, say: "Start a topic at this place.", next: "Others can reply to it here.", done: burn(["topic"]) },
  { id: "task", chapter: "community", target: { kind: "action", action: "task" }, say: "Post a task with a QGOLD reward.", next: "The reward waits in escrow until it's done.", done: (db, p) => one(db, "SELECT 1 FROM mk_tasks WHERE poster=? LIMIT 1", p) },
  { id: "wave", chapter: "people", target: { kind: "actor", role: "companion" }, say: "Wave at Ondra, who walks with you.", next: "Waves are quick hellos between explorers.", done: (db, p) => one(db, "SELECT 1 FROM player_waves WHERE from_id=? LIMIT 1", p) },
  { id: "message", chapter: "people", target: { kind: "actor", role: "companion" }, say: "Send Ondra a message.", next: "Between real explorers, messages are encrypted on NEAR.", done: any(relay(["set"], '%inbox%'), mark("message")) },
  { id: "stake", chapter: "stake", target: { kind: "actor", role: "keeper" }, say: "Stake at the Gate Keeper.", hint: "Show me marks him on the map. Walk up and tap him.", next: "Your stake earns a share of the daily yield.", done: relay(["create_position", "deposit_and_stake"]) },
  { id: "vote", chapter: "stake", target: { kind: "screen", screen: "treasury" }, say: "Vote on the treasury mix.", next: "Stakers decide where the treasury earns.", done: relay(["act_proposal"]) },
]);
export const TOUR_CHAPTERS = Object.freeze(["start", "npcs", "monsters", "trade", "community", "people", "stake"]);

function row(db, player) {
  ensure(db);
  return db.prepare("SELECT * FROM tour_progress WHERE player_id=?").get(player) ?? null;
}

/** Every transaction the explorer made: ledger records plus sponsored calls. */
export function tourTransactions(db, player, limit = 60) {
  const out = [];
  if (tableExists(db, "chain_actions") && tableExists(db, "chain_records"))
    for (const r of db
      .prepare(
        "SELECT a.kind, r.tx, r.status, a.at FROM chain_actions a LEFT JOIN chain_records r ON r.id=a.record_id WHERE a.player_id=? ORDER BY a.at LIMIT ?",
      )
      .all(player, limit))
      out.push({ kind: r.kind, tx: r.tx || null, state: r.status || "queued", at: r.at });
  if (tableExists(db, "relay_jobs"))
    for (const r of db
      .prepare(
        "SELECT method_name, receiver_id, transaction_hash, state, created_at FROM relay_jobs WHERE player_id=? AND state!='failed' ORDER BY seq LIMIT ?",
      )
      .all(player, limit))
      out.push({ kind: r.method_name || "create_account", contract: r.receiver_id, tx: r.transaction_hash || null, state: r.state, at: r.created_at });
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}

/** The tour as the helper shows it. */
export function tourState(db, player, { enabled }) {
  if (!enabled) return { enabled: false };
  const r = row(db, player);
  const skipped = new Set(r ? JSON.parse(r.skipped) : []);
  const steps = TOUR_STEPS.map((s) => {
    let done = false;
    try {
      done = s.done(db, player);
    } catch {
      done = false;
    }
    return { id: s.id, chapter: s.chapter, done, skipped: !done && skipped.has(s.id) };
  });
  const current = r ? TOUR_STEPS.find((s, i) => !steps[i].done && !steps[i].skipped) ?? null : null;
  const doneCount = steps.filter((s) => s.done).length;
  const transactions = r ? tourTransactions(db, player) : [];
  return {
    enabled: true,
    started: !!r,
    hidden: !!r?.hidden,
    finished: !!r && !current,
    done: doneCount,
    total: steps.length,
    steps,
    current: current
      ? { id: current.id, chapter: current.chapter, say: current.say, ...(current.hint ? { hint: current.hint } : {}), next: current.next, target: current.target }
      : null,
    // What just happened: the newest finished step, for the helper's first line.
    last: (() => {
      const i = steps.map((s) => s.done).lastIndexOf(true);
      return i >= 0 ? { id: TOUR_STEPS[i].id, next: TOUR_STEPS[i].next } : null;
    })(),
    transactions: { count: transactions.length, kinds: [...new Set(transactions.map((t) => t.kind))].length, list: transactions },
  };
}

const STEP_IDS = new Set(TOUR_STEPS.map((s) => s.id));
/** start | skip <step> | hide | show | restart */
export function tourAction(db, player, input, now = Date.now()) {
  ensure(db);
  const act = String(input?.action || "");
  const r = row(db, player);
  if (act === "start" || act === "restart") {
    db.prepare(
      "INSERT INTO tour_progress(player_id,started_at,skipped,hidden,updated_at) VALUES(?,?,'[]',0,?) ON CONFLICT(player_id) DO UPDATE SET skipped='[]',hidden=0,finished_at=NULL,updated_at=excluded.updated_at",
    ).run(player, now, now);
    return;
  }
  assert(r, "Start the tour first.", 409, "TOUR_NOT_STARTED");
  if (act === "skip") {
    const step = String(input?.step || "");
    assert(STEP_IDS.has(step), "Unknown tour step.", 400, "TOUR_STEP");
    const skipped = new Set(JSON.parse(r.skipped));
    skipped.add(step);
    db.prepare("UPDATE tour_progress SET skipped=?,updated_at=? WHERE player_id=?").run(JSON.stringify([...skipped]), now, player);
    return;
  }
  if (act === "hide" || act === "show") {
    db.prepare("UPDATE tour_progress SET hidden=?,updated_at=? WHERE player_id=?").run(act === "hide" ? 1 : 0, now, player);
    return;
  }
  assert(false, "Unknown tour action.", 400, "TOUR_ACTION");
}
