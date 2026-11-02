import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, HOME } from "../server/world.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { createHuntRewards } from "../server/actors/hunt/rewards.mjs";
import { seasonSettings, DEFAULT_GOAL } from "../server/season/config.mjs";
import { createSeason, seasonRank } from "../server/season/service.mjs";
import { createSeasonRoutes } from "../server/season/routes.mjs";

const now = Date.parse("2026-11-05T12:00:00Z");

async function setup({ env = {}, at = now } = {}) {
  const db = openDatabase(":memory:");
  createActorService(db);
  createHuntRewards(db);
  const alice = createPlayer(db, "Alice", now);
  const bob = createPlayer(db, "Bob", now);
  const w = await ensureWorld(db, HOME, true, now);
  let clock = at;
  const season = createSeason(db, seasonSettings(env), { now: () => clock });
  return { db, alice, bob, w, season, setClock: (t) => (clock = t) };
}

function hunt(db, player, n, at = now) {
  for (let i = 0; i < n; i++)
    db.prepare(
      "INSERT INTO monster_rewards(player_id,source,kind,amount,day_id,data,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(player, `win:m-${i}-${at}`, "xp", 20, "d", "{}", at);
}
function bossHit(db, player, state = "landed", at = now) {
  db.prepare(
    "INSERT INTO monster_boss_hits(id,event_id,player_id,format,seed,state,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(`hit-${player}-${at}-${state}-${Math.random()}`, "boss-1", player, "tap", "s", state, at);
}
function visit(db, player, worldId, n, at = now) {
  const quests = db.prepare("SELECT id FROM quests WHERE world_id=? LIMIT ?").all(worldId, n);
  for (const q of quests)
    db.prepare("INSERT INTO quest_progress(quest_id,player_id,checkpoint,updated_at) VALUES(?,?,?,?)").run(q.id, player, 1, at);
  return quests.length;
}
function line(db, player, n, { at = now, kind = "quest", state = "completed" } = {}) {
  for (let i = 0; i < n; i++)
    db.prepare(
      "INSERT INTO actor_offers(id,actor_id,player_id,encounter_id,kind,terms,menu_hash,state,expires_at,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(`offer-${player}-${i}-${at}-${kind}-${state}-${Math.random()}`, "npc-1", player, "enc", kind, "{}", "h", state, at + 1000, at, state === "completed" ? at : null);
}
function trade(db, player) {
  // Money activity that must never count.
  db.prepare("UPDATE players SET gold_u=gold_u+999999 WHERE id=?").run(player);
  line(db, player, 3, { kind: "trade_buy" });
}

test("settings: defaults, overrides, validation and mainnet off by default", () => {
  const d = seasonSettings({});
  assert.equal(d.enabled, true);
  assert.equal(d.id, "hackathon-2026");
  assert.equal(new Date(d.endsAt).toISOString(), "2026-11-14T23:59:59.000Z");
  assert.equal(d.goal, DEFAULT_GOAL);
  assert.deepEqual({ ...d.points }, { hunt: 1, visit: 2, line: 3 });
  assert.equal(d.potTarget, (10n ** 24n).toString());
  assert.equal(seasonSettings({}, "mainnet").enabled, false);
  assert.equal(seasonSettings({ SEASON: "1" }, "mainnet").enabled, true);
  assert.equal(seasonSettings({ SEASON_POINTS: "hunt:5" }).points.hunt, 5);
  assert.equal(seasonSettings({ SEASON_POT_TARGET_NEAR: "0.5" }).potTarget, (5n * 10n ** 23n).toString());
  assert.throws(() => seasonSettings({ SEASON: "yes" }), /SEASON must be 0 or 1/);
  assert.throws(() => seasonSettings({ SEASON_POINTS: "gold:1" }), /unknown action/);
  assert.throws(() => seasonSettings({ SEASON_ENDS_AT: "2026-10-01T00:00:00Z" }), /after/);
  assert.throws(() => seasonSettings({ SEASON_ID: "Bad Id" }), /SEASON_ID/);
  assert.throws(() => seasonSettings({ SEASON_POT_TARGET_NEAR: "0" }), /above zero/);
});

test("standings count hunts, visits and NPC lines inside the window, never money", async () => {
  const { db, alice, bob, w, season } = await setup();
  hunt(db, alice, 2);
  bossHit(db, alice);
  bossHit(db, alice, "missed");
  const visits = visit(db, alice, w.id, 2);
  assert.equal(visits, 2);
  line(db, alice, 1);
  line(db, alice, 1, { kind: "chapter" });
  line(db, alice, 1, { state: "accepted" });
  // Before the season and money activity do not count.
  hunt(db, bob, 5, Date.parse("2026-10-20T00:00:00Z"));
  trade(db, bob);
  hunt(db, bob, 1);
  const a = season.standing(alice);
  assert.deepEqual(a, { hunts: 3, visits: 2, lines: 2, points: 3 * 1 + 2 * 2 + 2 * 3 });
  assert.deepEqual(season.standing(bob), { hunts: 1, visits: 0, lines: 0, points: 1 });
  const v = season.view(alice);
  assert.equal(v.cosmetic, true);
  assert.equal(v.streak, false);
  assert.equal(v.phase, "live");
  assert.deepEqual(
    v.leaderboard.map((r) => [r.place, r.name, r.points, r.you]),
    [
      [1, "Alice", 13, true],
      [2, "Bob", 1, false],
    ],
  );
  assert.ok(!("id" in v.leaderboard[0]), "player ids are not published");
  assert.equal(v.me.place, 1);
  assert.equal(v.me.reached, false);
  assert.equal(season.view(null).me, null);
});

test("claim: goal required, once per explorer, season mark recorded, closed after the end", async () => {
  const { db, alice, bob, season, setClock } = await setup({ env: { SEASON_GOAL: "6" } });
  hunt(db, alice, 3);
  assert.throws(() => season.claim(alice), (e) => e.code === "SEASON_GOAL");
  line(db, alice, 1);
  const v = season.claim(alice);
  assert.equal(v.me.claimed, true);
  assert.equal(v.me.reached, true);
  assert.equal(v.finishers, 1);
  // No season edition in the catalog yet: the mark is recorded, no Aura.
  assert.equal(v.aura, null);
  assert.equal(v.me.aura, null);
  const again = season.claim(alice);
  assert.equal(again.finishers, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM history WHERE player_id=? AND kind='season'").get(alice).n, 1);
  // XP is untouched: the season pays nothing but the cosmetic mark.
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(alice).xp, 0);
  hunt(db, bob, 6);
  setClock(Date.parse("2026-11-15T00:00:01Z"));
  assert.throws(() => season.claim(bob), (e) => e.code === "SEASON_ENDED");
  const ended = season.view(bob);
  assert.equal(ended.phase, "ended");
  // Activity after the end does not move the frozen standings.
  hunt(db, bob, 10, Date.parse("2026-11-15T00:00:00Z"));
  assert.equal(season.standing(bob).hunts, 6);
});

test("ranks are cosmetic titles that scale with the goal", () => {
  assert.equal(seasonRank(0, 30).rank, 0);
  assert.equal(seasonRank(1, 30).title, "Explorer");
  assert.equal(seasonRank(30, 30).title, "Season finisher");
  assert.equal(seasonRank(60, 30).title, "Trailblazer");
  assert.equal(seasonRank(90, 30).title, "Season legend");
});

test("pot meter sums published season days by funding source and shows trader sweeps beside it", async () => {
  const { db, season } = await setup({ env: { SEASON_POT_TARGET_NEAR: "1" } });
  db.exec(
    "CREATE TABLE IF NOT EXISTS native_days(id TEXT PRIMARY KEY,day TEXT NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'prepared',transaction_hash TEXT,updated_at INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS npc_trader_sweeps(id TEXT PRIMARY KEY,trader TEXT NOT NULL,amount TEXT NOT NULL,receipt_id TEXT NOT NULL UNIQUE,tx_hash TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL)",
  );
  const day = (id, d, state, body) =>
    db.prepare("INSERT INTO native_days(id,day,body,hash,state,updated_at) VALUES(?,?,?,?,?,?)").run(id, d, JSON.stringify(body), "h", state, now);
  const tenth = (10n ** 23n).toString();
  day("a", "2026-11-02", "published", { coinUnit: "1000", coins: [1, 2], quests: [{ reward: tenth }, { reward: "0" }] });
  day("b", "2026-11-03", "closed", { coinUnit: "0", coins: [], quests: [{ reward: tenth }], funding: "realized_yield" });
  day("c", "2026-11-04", "prepared", { coinUnit: "5", coins: [1], quests: [{ reward: tenth }] });
  day("d", "2026-10-30", "published", { coinUnit: "5", coins: [1], quests: [{ reward: tenth }] });
  db.prepare("INSERT INTO npc_trader_sweeps VALUES(?,?,?,?,?,?,?)").run("s1", "t", "777", "r1", null, "done", now);
  db.prepare("INSERT INTO npc_trader_sweeps VALUES(?,?,?,?,?,?,?)").run("s2", "t", "888", "r2", null, "pending", now);
  const p = season.pot();
  assert.equal(p.publishedDays, 2);
  assert.equal(p.fromSponsors, (10n ** 23n + 2000n).toString());
  assert.equal(p.fromYield, tenth);
  assert.equal(p.total, (2n * 10n ** 23n + 2000n).toString());
  assert.equal(p.traderSweeps, "777");
  assert.equal(p.fillBps, 2000);
});

test("routes: public view, claim needs sign-in, disabled season answers enabled:false", async () => {
  const { season, alice } = await setup();
  const out = [];
  const respond = (_res, body) => out.push(body);
  const assertFn = (ok, message, status, code) => {
    if (!ok) throw Object.assign(new Error(message), { status, code });
  };
  const routes = createSeasonRoutes(season);
  const url = (p) => new URL(`http://x${p}`);
  assert.equal(await routes.handle({ method: "GET" }, {}, url("/api/season"), { player: null, respond, assert: assertFn }), true);
  assert.equal(out.at(-1).enabled, true);
  assert.equal(out.at(-1).me, null);
  await assert.rejects(
    routes.handle({ method: "POST" }, {}, url("/api/season/claim"), { player: null, respond, assert: assertFn }),
    (e) => e.code === "AUTH",
  );
  await routes.handle({ method: "GET" }, {}, url("/api/season"), { player: alice, respond, assert: assertFn });
  assert.equal(out.at(-1).me.points, 0);
  assert.equal(await routes.handle({ method: "GET" }, {}, url("/api/other"), { player: alice, respond, assert: assertFn }), false);
  await createSeasonRoutes(null).handle({ method: "GET" }, {}, url("/api/season"), { player: null, respond, assert: assertFn });
  assert.deepEqual(out.at(-1), { enabled: false });
});
