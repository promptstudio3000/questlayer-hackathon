import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, demoProgression } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import { createActorService } from "../server/actors/service.mjs";
import { createHuntRewards } from "../server/actors/hunt/rewards.mjs";
import { dailyBoardSettings, DEFAULT_BONUS_XP } from "../server/daily-board/config.mjs";
import { createDailyBoard } from "../server/daily-board/service.mjs";
import { createDailyBoardRoutes } from "../server/daily-board/routes.mjs";
import { createTestSeed } from "../server/test-seed/seed.mjs";
import { SEED_BOARD_FINISHERS } from "../server/test-seed/content.mjs";

const now = Date.parse("2026-11-02T12:00:00Z");

async function setup({ env = {}, actors = true } = {}) {
  const db = openDatabase(":memory:");
  if (actors) {
    createActorService(db);
    createHuntRewards(db);
  }
  const player = createPlayer(db, "Alice", now);
  const w = await ensureWorld(db, HOME, true, now);
  const manifest = JSON.parse(db.prepare("SELECT manifest FROM worlds WHERE id=?").get(w.id).manifest);
  const board = createDailyBoard(db, dailyBoardSettings(env), { actorsOn: () => actors, now: () => now });
  return { db, player, manifest, board, w };
}

function collect(db, player, worldId, count) {
  const coins = worldView(db, worldId).coins.filter((c) => !c.claimant).slice(0, count);
  for (const c of coins) claimCoin(db, player, c.id, c, now);
  return coins.length;
}

function beatMonster(db, player, day, n = 1) {
  for (let i = 0; i < n; i++)
    db.prepare(
      "INSERT INTO monster_rewards(player_id,source,kind,amount,day_id,data,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(player, `win:monster-${i}:${day}`, "xp", 20, day, "{}", now);
}

function talk(db, player, actor, at = now, outcome = "template") {
  db.prepare(
    "INSERT INTO ai_npc_requests(id,player_id,actor_id,provider,outcome,facts_hash,attested,created_at) VALUES(?,?,?,?,?,?,0,?)",
  ).run(`ainpc_${actor}_${at}_${outcome}`, player, actor, "template", outcome, "x", at);
}

test("settings: defaults, overrides, validation and mainnet off by default", () => {
  const d = dailyBoardSettings({});
  assert.equal(d.enabled, true);
  assert.deepEqual(d.goals, [
    { kind: "coins", target: 10 },
    { kind: "monster", target: 1 },
    { kind: "npc", target: 1 },
  ]);
  assert.equal(d.size, 3);
  assert.equal(d.bonusXp, DEFAULT_BONUS_XP);
  assert.equal(dailyBoardSettings({}, "mainnet").enabled, false);
  assert.equal(dailyBoardSettings({ DAILY_BOARD: "1" }, "mainnet").enabled, true);
  assert.equal(dailyBoardSettings({ DAILY_BOARD: "0" }).enabled, false);
  const custom = dailyBoardSettings({ DAILY_BOARD_GOALS: "quest:2, boss:1", DAILY_BOARD_SIZE: "2", DAILY_BOARD_BONUS_XP: "75" });
  assert.deepEqual(custom.goals, [
    { kind: "quest", target: 2 },
    { kind: "boss", target: 1 },
  ]);
  assert.equal(custom.size, 2);
  assert.equal(custom.bonusXp, 75);
  assert.throws(() => dailyBoardSettings({ DAILY_BOARD_GOALS: "dance:1" }), /unknown goal/);
  assert.throws(() => dailyBoardSettings({ DAILY_BOARD_GOALS: "coins:0" }), /1–500/);
  assert.throws(() => dailyBoardSettings({ DAILY_BOARD_BONUS_XP: "-1" }), /0–1000/);
  assert.throws(() => dailyBoardSettings({ DAILY_BOARD: "yes" }), /0 or 1/);
});

test("three goals from today's world, progress from real play, bonus paid once", async () => {
  const { db, player, manifest, board, w } = await setup();
  let view = board.view(player, manifest);
  assert.deepEqual(
    view.goals.map((g) => [g.kind, g.target, g.progress, g.done]),
    [
      ["coins", 10, 0, false],
      ["monster", 1, 0, false],
      ["npc", 1, 0, false],
    ],
  );
  assert.equal(view.streak, false);
  assert.equal(view.resetsAt, manifest.endsAt);
  assert.throws(() => board.claim(player, manifest), (e) => e.code === "BOARD_INCOMPLETE");

  assert.equal(collect(db, player, w.id, 10), 10);
  beatMonster(db, player, manifest.day);
  talk(db, player, "npc-a", now, "limited"); // a refused talk doesn't count
  view = board.view(player, manifest);
  assert.equal(view.done, 2);
  assert.equal(view.goals[0].progress, 10);
  talk(db, player, "npc-a");
  view = board.view(player, manifest);
  assert.equal(view.complete, true);
  assert.equal(view.claimed, false);

  const before = demoProgression(db, player).earnedXp;
  const claimed = board.claim(player, manifest);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.finishedToday, 1);
  assert.equal(demoProgression(db, player).earnedXp, before + DEFAULT_BONUS_XP);
  const again = board.claim(player, manifest);
  assert.equal(again.alreadyClaimed, true);
  assert.equal(demoProgression(db, player).earnedXp, before + DEFAULT_BONUS_XP);
  assert.equal(
    db.prepare("SELECT count(*) n FROM history WHERE player_id=? AND kind='daily-board'").get(player).n,
    1,
  );
  db.close();
});

test("an NPC talk from yesterday doesn't count, and a missed day costs nothing", async () => {
  const { db, player, manifest, board } = await setup();
  talk(db, player, "npc-b", manifest.endsAt - 86_400_000 - 1000);
  assert.equal(board.view(player, manifest).goals.find((g) => g.kind === "npc").progress, 0);
  // A different day id is a fresh board: nothing carries over, nothing is lost.
  const tomorrow = { ...manifest, day: "2099-01-01", endsAt: manifest.endsAt + 86_400_000 };
  const view = board.view(player, tomorrow);
  assert.equal(view.done, 0);
  assert.equal(view.claimed, false);
  db.close();
});

test("without monsters and NPCs the board fills up from the fallback goals", async () => {
  const { db, player, manifest, board } = await setup({ actors: false });
  const kinds = board.view(player, manifest).goals.map((g) => g.kind);
  assert.equal(kinds.length, 3);
  assert.equal(kinds[0], "coins");
  assert.ok(!kinds.includes("monster") && !kinds.includes("npc"));
  db.close();
});

test("a claimed board keeps its goals when the settings change", async () => {
  const { db, player, manifest, w } = await setup();
  const small = createDailyBoard(db, dailyBoardSettings({ DAILY_BOARD_GOALS: "coins:1", DAILY_BOARD_SIZE: "1", DAILY_BOARD_BONUS_XP: "10" }), {
    actorsOn: () => true,
  });
  collect(db, player, w.id, 1);
  small.claim(player, manifest);
  const later = createDailyBoard(db, dailyBoardSettings({}), { actorsOn: () => true });
  const view = later.view(player, manifest);
  assert.deepEqual(view.goals.map((g) => g.kind), ["coins"]);
  assert.equal(view.bonusXp, 10);
  assert.equal(view.claimed, true);
  db.close();
});

test("routes answer disabled, need sign-in and a known world", async () => {
  const { db, player, manifest, board } = await setup();
  const call = async (routes, path, { method = "GET", who = player, input = {} } = {}) => {
    let out = null;
    const assertFn = (ok, message, status = 400, code) => {
      if (!ok) throw Object.assign(new Error(message), { status, code });
    };
    const handled = await routes.handle({ method }, null, new URL(`http://x${path}`), {
      player: who,
      body: async () => input,
      respond: (_res, body) => (out = body),
      assert: assertFn,
    });
    return { handled, out };
  };
  assert.deepEqual((await call(createDailyBoardRoutes(null, db), "/api/daily-board")).out, { enabled: false });
  const routes = createDailyBoardRoutes(board, db);
  assert.equal((await call(routes, "/api/other")).handled, false);
  await assert.rejects(call(routes, `/api/daily-board?worldId=${manifest.id}`, { who: null }), (e) => e.code === "AUTH");
  await assert.rejects(call(routes, "/api/daily-board?worldId=nope"), (e) => e.code === "WORLD_NOT_FOUND");
  const { out } = await call(routes, `/api/daily-board?worldId=${encodeURIComponent(manifest.id)}`);
  assert.equal(out.total, 3);
  await assert.rejects(
    call(routes, "/api/daily-board/claim", { method: "POST", input: { worldId: manifest.id } }),
    (e) => e.code === "BOARD_INCOMPLETE",
  );
  db.close();
});

test("TEST_SEED explorers finish the board on schedule and purge removes them", async () => {
  const db = openDatabase(":memory:");
  createActorService(db);
  let clock = now;
  const seed = createTestSeed(db, { clock: () => clock });
  const w = await ensureWorld(db, HOME, true, now);
  const manifest = JSON.parse(db.prepare("SELECT manifest FROM worlds WHERE id=?").get(w.id).manifest);
  const dayStart = manifest.endsAt - 86_400_000;
  clock = dayStart + 1000;
  seed.apply();
  assert.equal(seed.status().boards, 0);
  clock = manifest.endsAt - 1000;
  seed.tickBoards();
  assert.equal(seed.status().boards, SEED_BOARD_FINISHERS.length);
  const board = createDailyBoard(db, dailyBoardSettings({}), { actorsOn: () => true });
  const alice = createPlayer(db, "Alice", now);
  assert.equal(board.view(alice, manifest).finishedToday, SEED_BOARD_FINISHERS.length);
  seed.purge();
  assert.equal(db.prepare("SELECT count(*) n FROM daily_board_claims").get().n, 0);
  db.close();
});
