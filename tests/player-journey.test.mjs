import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { claimCoin } from "../server/game.mjs";
import { playerJourney } from "../server/player-journey.mjs";

const now = Date.now();

test("the explorer's story counts finds and earnings and lists them newest first", async () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const empty = playerJourney(db, a);
  assert.equal(empty.stats.finds, 0);
  assert.equal(empty.stats.goldEarnedU, 0);
  assert.ok(empty.timeline.some((e) => e.kind === "welcome"), "the welcome row starts the story");

  const w = await ensureWorld(db, HOME, true, now);
  const coins = worldView(db, w.id).coins.filter((c) => !c.wearable).slice(0, 2);
  let earned = 0;
  for (const coin of coins) earned += claimCoin(db, a, coin.id, coin, now + 1000).value;
  // A spending row never counts as earned and stays out of the story.
  db.prepare("INSERT INTO history VALUES (?,?,?,?,?,?,?)").run("e-spend", a, "escrow", "Escrow: x", -500, "{}", now + 2000);

  const j = playerJourney(db, a, { placeBadgeName: () => "Sněžka" });
  assert.equal(j.stats.finds, coins.length);
  assert.equal(j.stats.goldEarnedU, earned);
  assert.ok(!j.timeline.some((e) => e.kind === "escrow"));
  assert.ok(j.timeline[0].at >= j.timeline.at(-1).at, "newest first");
  assert.equal(j.joinedAt, now);
});

test("another explorer's story stays separate", async () => {
  const db = openDatabase(":memory:");
  const a = createPlayer(db, "Alice", now);
  const b = createPlayer(db, "Bob", now);
  const w = await ensureWorld(db, HOME, true, now);
  const coin = worldView(db, w.id).coins.find((c) => !c.wearable);
  claimCoin(db, a, coin.id, coin, now + 1000);
  assert.equal(playerJourney(db, b).stats.finds, 0);
  assert.ok(!playerJourney(db, b).timeline.some((e) => e.kind === "coin" || e.kind === "find"));
});
