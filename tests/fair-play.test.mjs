import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, createPlayer, atomic } from "../server/database.mjs";
import {
  capLocationXp,
  ensureFairPlaySchema,
  fairPlayLimits,
  guardTravel,
  travelWaitMs,
  xpCell,
} from "../server/fair-play.mjs";
import { pruneRateWindows } from "../server/http-security.mjs";
import { claimCoin } from "../server/game.mjs";
import { ensureWorld, worldView, HOME } from "../server/world.mjs";
import { distance } from "../server/domain.mjs";

const NOW = Date.parse("2026-11-03T10:00:00Z");
const PRAGUE = { lat: 50.0875, lng: 14.4213 };
const BRNO = { lat: 49.1951, lng: 16.6068 };
const fix = (p, t, accuracy = 5) => ({ ...p, accuracy, timestamp: t });
const limits = fairPlayLimits({});

function setup() {
  const db = openDatabase(":memory:");
  ensureFairPlaySchema(db);
  return { db, player: createPlayer(db, "Fair player") };
}

test("limits default sensibly and ignore invalid overrides", () => {
  assert.equal(limits.maxSpeedMps, 15);
  assert.equal(limits.travelCooldownMaxMs, 7_200_000);
  assert.equal(fairPlayLimits({ FAIR_PLAY_DAILY_XP: "900" }).dailyXp, 900);
  assert.equal(fairPlayLimits({ FAIR_PLAY_DAILY_XP: "-1" }).dailyXp, 3000);
  assert.equal(fairPlayLimits({ FAIR_PLAY_MAX_SPEED_MPS: "fast" }).maxSpeedMps, 15);
  assert.equal(travelWaitMs(0, limits), 0);
  assert.equal(travelWaitMs(1500, limits), 100_000);
  assert.equal(travelWaitMs(5_000_000, limits), 7_200_000);
});

test("a GPS teleport is rejected until the trip could have happened, without moving the anchor", () => {
  const { db, player } = setup();
  try {
    guardTravel(db, player, fix(PRAGUE, NOW), NOW, limits);
    // Walking 40 m in 30 s is fine and moves the anchor.
    const near = { lat: PRAGUE.lat + 0.00036, lng: PRAGUE.lng };
    guardTravel(db, player, fix(near, NOW + 30_000), NOW + 30_000, limits);
    // Brno one minute later: about 185 km.
    assert.throws(
      () => guardTravel(db, player, fix(BRNO, NOW + 90_000), NOW + 90_000, limits),
      (e) => e.code === "IMPLAUSIBLE_MOVE" && e.status === 422 && /min/.test(e.message),
    );
    const anchor = db.prepare("SELECT * FROM fair_play_anchor WHERE player_id=?").get(player);
    assert.ok(distance(anchor, near) < 1, "a rejected fix must not move the anchor");
    // Back home is still fine, so hopping between spoofed places gains nothing.
    guardTravel(db, player, fix(PRAGUE, NOW + 95_000), NOW + 95_000, limits);
    // After the capped wait (2 h) a long real trip is accepted.
    const later = NOW + 95_000 + 7_200_000;
    guardTravel(db, player, fix(BRNO, later), later, limits);
  } finally {
    db.close();
  }
});

test("GPS accuracy is slack, so jitter in place is never a teleport", () => {
  const { db, player } = setup();
  try {
    guardTravel(db, player, fix(PRAGUE, NOW, 30), NOW, limits);
    const jitter = { lat: PRAGUE.lat + 0.0005, lng: PRAGUE.lng }; // ~55 m
    guardTravel(db, player, fix(jitter, NOW + 1000, 30), NOW + 1000, limits);
  } finally {
    db.close();
  }
});

test("location XP is capped per cell, per day and by the number of cells", () => {
  const { db, player } = setup();
  const tight = { ...limits, cellXpPerDay: 100, dailyXp: 250, xpCellsPerDay: 3 };
  const cells = [];
  for (let i = 0; cells.length < 5; i++) {
    const p = { lat: 50 + i * 0.03, lng: 14.4 };
    if (!cells.some((c) => xpCell(c) === xpCell(p))) cells.push(p);
  }
  try {
    const grant = (p, xp, t = NOW) => atomic(db, () => capLocationXp(db, player, xp, p, t, tight));
    assert.deepEqual(grant(cells[0], 60), { xp: 60, cap: null });
    assert.deepEqual(grant(cells[0], 60), { xp: 40, cap: "cell" });
    assert.deepEqual(grant(cells[0], 60), { xp: 0, cap: "cell" });
    assert.deepEqual(grant(cells[1], 100), { xp: 100, cap: null });
    assert.deepEqual(grant(cells[2], 100), { xp: 50, cap: "daily" });
    assert.deepEqual(grant(cells[3], 10), { xp: 0, cap: "cells" });
    // A new local day starts fresh.
    assert.deepEqual(grant(cells[3], 10, NOW + 86_400_000), { xp: 10, cap: null });
    assert.deepEqual(grant(cells[3], 0), { xp: 0, cap: null });
  } finally {
    db.close();
  }
});

test("a GPS coin claim far from the last accepted fix is refused; arena coins skip the travel guard", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Spoofer");
    const gps = await ensureWorld(db, HOME, false, Date.now());
    const coins = worldView(db, gps.id, player).coins;
    const a = coins[0];
    const b = coins.find((c) => distance(c, a) > 500);
    assert.ok(b, "fixture needs two coins at least 500 m apart");
    const t = Date.now();
    claimCoin(db, player, a.id, fix(a, t), t);
    assert.throws(
      () => claimCoin(db, player, b.id, fix(b, t + 2000), t + 2000),
      (e) => e.code === "IMPLAUSIBLE_MOVE",
    );
    const arena = await ensureWorld(db, HOME, true, Date.now());
    const coin = worldView(db, arena.id, player).coins[0];
    const r = claimCoin(db, player, coin.id, fix(coin, t + 3000, 0), t + 3000);
    assert.ok(r.value > 0);
  } finally {
    db.close();
  }
});

test("rate windows prune only finished minutes", () => {
  const minute = Math.floor(NOW / 60_000);
  const rates = new Map([
    [`coin:p1:${minute - 1}`, 5],
    [`coin:p1:${minute}`, 3],
    ["weird-key", 1],
  ]);
  assert.equal(pruneRateWindows(rates, NOW), 1);
  assert.ok(rates.has(`coin:p1:${minute}`));
  const big = new Map(Array.from({ length: 5 }, (_, i) => [`k:${i}:${minute}`, 1]));
  assert.equal(pruneRateWindows(big, NOW, 3), 0);
});
