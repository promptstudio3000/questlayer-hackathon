import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureModuleVersion } from "../server/schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../server/actors/schema.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { loadCityActors } from "../server/actors/definitions.mjs";
import { planSpawns, LURKER_FIND_RADIUS_M } from "../server/actors/spawns.mjs";
import { distance } from "../server/domain.mjs";
import { createHuntRewards, CRAFT_SHARDS, DAILY_SHARD_CAP, ALTAR_ACCOUNT, ALTAR_RECIPES } from "../server/actors/hunt/rewards.mjs";
import { createChestGuard } from "../server/actors/hunt/guardians.mjs";
import { createBossService, weekIdFor, hitDamage, BOSS_HIT_COOLDOWN_MS } from "../server/actors/hunt/boss.mjs";
import { createRhythm, scoreRhythm, MINIGAMES } from "../server/actors/challenges/minigames.mjs";

const DAY = "2026-11-02";

function setup() {
  const db = openDatabase(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  return db;
}
function addAura(db, player, rarity = "common", name = "Moss Ring") {
  const id = `aura_${Math.random().toString(36).slice(2)}`;
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, player, "aura", name, rarity, "below", "#888", 0, 1, Date.now());
  return id;
}
const win = (player, archetype, actorId, extra = {}) => ({
  player,
  actorId,
  archetype,
  outcome: "won",
  dayId: DAY,
  element: "frost",
  name: "Brute Lickquidator",
  finishedAt: Date.now(),
  ...extra,
});

test("ISO weeks and boss damage come from level and skill only", () => {
  assert.equal(weekIdFor("2026-11-01"), "2026-W44");
  assert.equal(weekIdFor("2026-11-02"), "2026-W45");
  assert.equal(weekIdFor("2027-01-01"), "2026-W53");
  assert.equal(hitDamage(1, { won: false, score: 0, max: 8 }), 0);
  assert.ok(hitDamage(5, { won: true, score: 8, max: 8 }) > hitDamage(5, { won: true, score: 6, max: 8 }));
  assert.ok(hitDamage(20, { won: true, score: 8, max: 8 }) === hitDamage(50, { won: true, score: 8, max: 8 }), "level is capped");
  assert.ok(hitDamage(5, { won: false, score: 4, max: 8 }) < hitDamage(5, { won: true, score: 6, max: 8 }));
});

test("lurkers hide next to today's street finds", () => {
  const city = loadCityActors("plzen");
  const finds = [
    { id: "w:coin:1", lat: 49.74745, lng: 13.3774 },
    { id: "w:coin:2", lat: 49.74799, lng: 13.3819 },
    { id: "w:coin:3", lat: 49.74499, lng: 13.37484 },
    { id: "w:coin:4", lat: 49.7426, lng: 13.3713 },
  ];
  const a = planSpawns(city, PLZEN, "seed", DAY, { finds });
  assert.deepEqual(a, planSpawns(city, PLZEN, "seed", DAY, { finds }));
  const lurkers = a.filter((s) => s.def.archetype === "lurker");
  assert.ok(lurkers.length >= 1);
  for (const l of lurkers) {
    const f = finds.find((x) => x.id === l.near.findId);
    assert.ok(distance(l.home, f) <= LURKER_FIND_RADIUS_M, l.id);
  }
  // Without finds they still spawn on path points.
  assert.ok(planSpawns(city, PLZEN, "seed", DAY).some((s) => s.def.archetype === "lurker" && !s.near));
});

test("wins pay XP, shards and roll tickets once, with a daily shard cap", () => {
  const db = setup();
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Hunter");
  const xp0 = db.prepare("SELECT xp FROM players WHERE id=?").get(p).xp;
  const g = rewards.onChallengeResult(win(p, "guardian", "lick-brute-1", { guards: { zoneId: "z1" } }));
  assert.deepEqual(g.shards, { element: "frost", count: 2 });
  assert.deepEqual(g.unlocks, { zoneId: "z1" });
  assert.equal(rewards.onChallengeResult(win(p, "guardian", "lick-brute-1")).xp, 0, "replay pays nothing");
  const l = rewards.onChallengeResult(win(p, "lurker", "pocket-wisp-1", { element: "ember" }));
  assert.equal(l.rollTicket, true);
  assert.equal(rewards.onChallengeResult({ ...win(p, "roamer", "x"), outcome: "lost" }), null);
  assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(p).xp, xp0 + 40 + 25);
  for (let i = 0; i < 20; i++) rewards.onChallengeResult(win(p, "roamer", `lickquidator-${i}`, { element: "storm" }));
  const s = rewards.summary(p, DAY);
  assert.equal(s.shardsToday, DAILY_SHARD_CAP);
  assert.equal(s.shardTotal, DAILY_SHARD_CAP);
  assert.equal(s.rollTickets, 1);
  assert.equal(s.guardianWins, 1);
});

test("crafting turns 10 shards and a common Aura into Wardbreaker Horns", () => {
  const db = setup();
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Crafter");
  assert.throws(() => rewards.craft(p, { dayId: DAY }), (e) => e.code === "CRAFT_GUARDIAN");
  rewards.onChallengeResult(win(p, "guardian", "lick-brute-1"));
  assert.throws(() => rewards.craft(p, { dayId: DAY }), (e) => e.code === "CRAFT_SHARDS");
  for (let i = 0; i < 8; i++) rewards.onChallengeResult(win(p, "roamer", `lickquidator-${i}`, { element: "storm" }));
  assert.equal(rewards.summary(p, DAY).shardTotal, CRAFT_SHARDS);
  assert.throws(() => rewards.craft(p, { dayId: DAY }), (e) => e.code === "CRAFT_AURA");
  addAura(db, p, "rare", "Rare Thing");
  const common = addAura(db, p);
  assert.equal(rewards.summary(p, DAY).craft.ready, true);
  const out = rewards.craft(p, { dayId: DAY });
  assert.equal(out.item.name, "Wardbreaker Horns");
  assert.equal(out.offered.id, common);
  assert.equal(db.prepare("SELECT player_id FROM inventory WHERE id=?").get(common).player_id, ALTAR_ACCOUNT);
  assert.equal(rewards.summary(p, DAY).shardTotal, 0);
  // One from the first guardian win (once per player), one from the altar.
  assert.equal(db.prepare("SELECT minted FROM editions WHERE name='Wardbreaker Horns'").get().minted, 2);
});

test("altar recipes sink element shards and common Auras into existing native editions", () => {
  const db = setup();
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Alchemist");
  const catalog = JSON.parse(readFileSync(new URL("../server/data/aura-catalog.json", import.meta.url), "utf8"));
  assert.ok(ALTAR_RECIPES.length >= 4);
  for (const r of ALTAR_RECIPES) assert.equal(catalog.editions.find((e) => e.id === r.edition)?.native, true, r.id);
  // Frost recipe: frost shards only, no guardian needed.
  for (let i = 0; i < 5; i++) rewards.onChallengeResult(win(p, "roamer", `lickquidator-s${i}`, { element: "storm" }));
  for (let i = 0; i < 5; i++) rewards.onChallengeResult(win(p, "roamer", `lickquidator-f${i}`, { element: "frost" }));
  addAura(db, p);
  let frost = rewards.summary(p, DAY).altar.recipes.find((r) => r.id === "frost-lights");
  assert.deepEqual(frost.needs, ["shards"]);
  assert.throws(() => rewards.craft(p, { dayId: DAY, recipe: "frost-lights" }), (e) => e.code === "CRAFT_SHARDS");
  rewards.onChallengeResult(win(p, "roamer", "lickquidator-f5", { element: "frost" }));
  frost = rewards.summary(p, DAY).altar.recipes.find((r) => r.id === "frost-lights");
  assert.equal(frost.ready, true);
  const out = rewards.craft(p, { dayId: DAY, recipe: "frost-lights" });
  assert.equal(out.item.name, "Northern Lights");
  assert.deepEqual(out.spent, { frost: 6 });
  assert.equal(rewards.shardsOf(p).storm, 5);
  // Shared daily limit across recipes.
  assert.throws(() => rewards.craft(p, { dayId: DAY, recipe: "frost-lights" }), (e) => e.code === "CRAFT_DAILY");
  assert.throws(() => rewards.craft(p, { dayId: DAY, recipe: "nope" }), (e) => e.code === "CRAFT_RECIPE");
});

test("epic altar recipes need a guardian win and two common Auras", () => {
  const db = setup();
  const rewards = createHuntRewards(db);
  const p = createPlayer(db, "Stormcaller");
  const NEXT = "2026-11-03";
  for (let i = 0; i < 8; i++) rewards.onChallengeResult(win(p, "roamer", `lickquidator-${i}`, { element: "storm" }));
  const one = addAura(db, p);
  assert.throws(() => rewards.craft(p, { dayId: NEXT, recipe: "storm-crown" }), (e) => e.code === "CRAFT_GUARDIAN");
  rewards.onChallengeResult(win(p, "guardian", "lick-brute-1", { element: "void" }));
  assert.throws(() => rewards.craft(p, { dayId: NEXT, recipe: "storm-crown" }), (e) => e.code === "CRAFT_AURA");
  const two = addAura(db, p);
  const out = rewards.craft(p, { dayId: NEXT, recipe: "storm-crown", itemId: two });
  assert.equal(out.item.name, "Stormcrown");
  assert.deepEqual(out.offeredAll.map((a) => a.id), [two, one]);
  for (const id of [one, two]) assert.equal(db.prepare("SELECT player_id FROM inventory WHERE id=?").get(id).player_id, ALTAR_ACCOUNT);
  assert.equal(rewards.shardsOf(p).storm, 0);
  assert.equal(rewards.shardsOf(p).void, 2);
});

test("a guardian on duty locks its zone chest until you beat it", () => {
  const db = new DatabaseSync(":memory:");
  ensureModuleVersion(db, ACTORS_SCHEMA);
  db.exec("CREATE TABLE worlds(id TEXT PRIMARY KEY, manifest TEXT); CREATE TABLE quests(id TEXT PRIMARY KEY, world_id TEXT, kind TEXT, zone_id TEXT); CREATE TABLE quest_claims(quest_id TEXT, player_id TEXT, claimed_at INTEGER)");
  db.prepare("INSERT INTO worlds VALUES('w1',?)").run(JSON.stringify({ id: "w1", day: DAY, cityId: "plzen" }));
  db.prepare("INSERT INTO quests VALUES('chest1','w1','chest','z1'),('visit1','w1','visit','z1'),('chest2','w1','chest','z2')").run();
  const t = 1_000_000;
  const guardian = { id: "lick-brute-1", def: { archetype: "guardian", name: "Brute Lickquidator", model: "lick-brute" }, guards: { zoneId: "z1" }, segments: [{ from: t - 10, to: t + 10, path: [[13.37, 49.74]], dwell: true }] };
  const actors = { planFor: () => ({ instances: [guardian] }) };
  const chests = createChestGuard(db, actors, { clock: () => t });
  // A newcomer's first chest is free, guarded or not.
  chests.assertOpen("p1", "chest1");
  chests.assertOpen("p2", "chest1");
  db.prepare("INSERT INTO quest_claims VALUES('chest2','p1',1),('chest2','p2',1)").run();
  assert.throws(() => chests.assertOpen("p1", "chest1"), (e) => e.code === "GUARDED" && e.status === 423);
  chests.assertOpen("p1", "visit1");
  chests.assertOpen("p1", "chest2");
  // Off duty: never stuck.
  chests.assertOpen("p1", "chest1", t + 60_000);
  db.prepare("INSERT INTO actor_progress(player_id,actor_id,day_id,attempts,defeats,updated_at) VALUES('p1','lick-brute-1',?,1,1,0)").run(DAY);
  chests.assertOpen("p1", "chest1");
  assert.throws(() => chests.assertOpen("p2", "chest1"), (e) => e.code === "GUARDED");
  assert.deepEqual(chests.status("p1", { day: DAY }, "z1"), { actorId: "lick-brute-1", name: "Brute Lickquidator", model: "lick-brute", defeated: true });
});

function humanTaps(beats) {
  return beats.map((b, i) => b + (i % 2 ? 40 : -45));
}

test("the weekly boss shares one HP pool and rewards 3+ hitters with Bossbane", async () => {
  const db = setup();
  const rewards = createHuntRewards(db);
  let now = 5_000_000;
  const players = [createPlayer(db, "A"), createPlayer(db, "B")];
  const encounters = {
    requireEncounter: ({ player, actorId }) => ({ actor: { id: actorId, archetype: actorId === "lick-boss" ? "boss" : "roamer" }, dayId: DAY, cityId: "plzen", player }),
  };
  const boss = createBossService(db, { encounters, levelOf: () => 10, rewards, maxHp: 200, now: () => now, secret: "s" });
  await assert.rejects(boss.start({ player: players[0], actorId: "lickquidator-1", encounter: "e" }), (e) => e.code === "NOT_A_BOSS");

  async function swing(player, good = true) {
    const { hit } = await boss.start({ player, actorId: "lick-boss", encounter: "e" });
    assert.ok(MINIGAMES.includes(hit.format));
    now += 20_000;
    let input;
    if (hit.format === "rhythm") input = { taps: good ? humanTaps(hit.beats) : [] };
    else if (hit.format === "memory") input = { taps: good ? hit.sequence.map((pad, i) => ({ pad, t: hit.showEndsMs + 400 + i * 350 })) : [] };
    else input = { samples: [] };
    return { hit, out: boss.submit({ player, actorId: "lick-boss", hitId: hit.id, input }) };
  }

  const first = await swing(players[0]);
  await assert.rejects(boss.start({ player: players[0], actorId: "lick-boss", encounter: "e" }), (e) => e.code === "BOSS_COOLDOWN");
  assert.throws(() => boss.submit({ player: players[0], actorId: "lick-boss", hitId: first.hit.id, input: {} }), (e) => e.code === "HIT_NOT_FOUND");
  let last = first.out;
  for (let i = 0; i < 40 && !last.defeated; i++) {
    now += BOSS_HIT_COOLDOWN_MS;
    last = (await swing(players[i % 2 ? 1 : 0], i % 2 === 0 || i > 6)).out;
  }
  assert.equal(last.defeated, true);
  assert.equal(last.event.hp, 0);
  assert.equal(last.event.state, "defeated");
  const ev = boss.current("plzen", DAY, players[0]);
  assert.equal(ev.state, "defeated");
  assert.ok(ev.leaderboard.length >= 1 && ev.leaderboard[0].hits >= 1);
  const landed = (p) => db.prepare("SELECT COUNT(*) AS n FROM monster_boss_hits WHERE player_id=? AND state='landed'").get(p).n;
  for (const p of players) {
    const has = !!db.prepare("SELECT 1 FROM inventory WHERE player_id=? AND name='Bossbane Fangring'").get(p);
    assert.equal(has, landed(p) >= 3, `bossbane for ${p}`);
  }
  now += BOSS_HIT_COOLDOWN_MS;
  await assert.rejects(boss.start({ player: players[1], actorId: "lick-boss", encounter: "e" }), (e) => e.code === "BOSS_DEFEATED");
});

test("rhythm bots gain nothing on the boss either", () => {
  const r = createRhythm("boss-seed");
  const human = scoreRhythm(r, { taps: humanTaps(r.beats) });
  const bot = scoreRhythm(r, { taps: r.beats.slice() });
  assert.equal(hitDamage(10, human), hitDamage(10, bot));
});
