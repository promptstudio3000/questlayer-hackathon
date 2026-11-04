import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import {
  changeDayAdjustment,
  changePlace,
  changeWorldPause,
  dayCityPack,
  operatorAudit,
  worldHealthReport,
} from "../server/operator/world-controls.mjs";
import {
  getOrPrepareCityPlan,
  worldPreparationStatus,
} from "../server/world-planner.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { claimCoin, claimQuest } from "../server/game.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z"); // 2026-11-02 in Prague
const authority = { isOperator: () => true, clock: () => NOW };
const pause = (extra = {}) => ({
  actor: "qa-operator",
  operationId: "qa-pause",
  cityId: PLZEN.id,
  day: "2026-11-02",
  zone: null,
  action: "pause",
  reason: "Street festival blocks the centre",
  expectedVersion: 0,
  ...extra,
});
const adjust = (extra = {}) => ({
  actor: "qa-operator",
  operationId: "qa-adjust",
  cityId: PLZEN.id,
  day: "2026-11-05",
  action: "set",
  excludeCandidates: [],
  reason: "Park maintenance that day",
  expectedVersion: 0,
  ...extra,
});

test("a day pause needs operator authority, blocks new pickups, hides coins and is audited with replayable receipts", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Explorer", NOW);
    const world = await ensureWorld(db, HOME, true, NOW);
    assert.throws(() => changeWorldPause(db, pause()), /trusted operator/);
    const receipt = changeWorldPause(db, pause(), authority);
    assert.equal(receipt.state, "paused");
    assert.deepEqual(changeWorldPause(db, pause(), authority), receipt);
    assert.throws(
      () => changeWorldPause(db, pause({ reason: "other terms" }), authority),
      /different terms/,
    );
    const view = worldView(db, world.id, player, { now: NOW });
    assert.equal(view.coins.length, 0);
    assert.equal(view.operatorPause.reason, "Street festival blocks the centre");
    assert.ok(view.zones.every((z) => z.placeStatus === "closed"));
    const coin = db
      .prepare("SELECT * FROM coins WHERE world_id=? LIMIT 1")
      .get(world.id);
    assert.throws(
      () => claimCoin(db, player, coin.id, coin, NOW),
      (e) => e.code === "WORLD_PAUSED",
    );
    // Pausing never rewrites the stored world.
    const manifest = db
      .prepare("SELECT manifest FROM worlds WHERE id=?")
      .get(world.id).manifest;
    assert.throws(
      () =>
        changeWorldPause(
          db,
          pause({ operationId: "qa-resume", action: "resume" }),
          authority,
        ),
      /current version/,
    );
    changeWorldPause(
      db,
      pause({ operationId: "qa-resume", action: "resume", expectedVersion: 1 }),
      authority,
    );
    assert.equal(claimCoin(db, player, coin.id, coin, NOW).value, coin.value_u);
    assert.equal(
      db.prepare("SELECT manifest FROM worlds WHERE id=?").get(world.id)
        .manifest,
      manifest,
    );
    assert.deepEqual(
      operatorAudit(db).map((a) => a.kind),
      ["resume", "pause"],
    );
  } finally {
    db.close();
  }
});

test("a zone pause closes only that zone's discoveries", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Explorer", NOW);
    const world = await ensureWorld(db, HOME, true, NOW);
    const view = worldView(db, world.id, player, { now: NOW });
    const q = view.quests.find((q) => q.tier === 1 && q.kind === "visit"),
      zone = world.zones.find((z) => z.id === q.zone_id);
    changeWorldPause(db, pause({ zone: zone.slot }), authority);
    const after = worldView(db, world.id, player, { now: NOW });
    const zones = new Map(after.zones.map((z) => [z.slot, z]));
    assert.equal(zones.get(zone.slot).placeStatus, "closed");
    assert.ok(zones.get(zone.slot).operatorPause);
    assert.ok(after.coins.length > 0);
    assert.ok(
      [...zones.values()]
        .filter((z) => z.slot !== zone.slot)
        .every((z) => z.placeStatus === "open"),
    );
    assert.throws(
      () => claimQuest(db, player, q.id, q, NOW),
      (e) => e.code === "WORLD_PAUSED",
    );
    assert.throws(
      () =>
        changeWorldPause(
          db,
          pause({ operationId: "old", day: "2026-11-01" }),
          authority,
        ),
      /today or a future day/,
    );
  } finally {
    db.close();
  }
});

test("a future day can be adjusted until it is published, and the adjustment reaches its plan", async () => {
  const db = openDatabase(":memory:");
  try {
    const day = "2026-11-05";
    const original = getOrPrepareCityPlan(db, PLZEN, day, NOW);
    const swapped = original.zones[0].sourceId;
    const input = adjust({ excludeCandidates: [swapped] });
    const preview = await changeDayAdjustment(db, input, {
      ...authority,
      preview: true,
    });
    assert.equal(preview.preview, true);
    assert.ok(preview.zones.every((z) => z.sourceId !== swapped));
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='world_day_adjustments'").get(),
      undefined,
    );
    await assert.rejects(
      changeDayAdjustment(db, adjust({ day: "2026-11-02" }), authority),
      /future day/,
    );
    await assert.rejects(
      changeDayAdjustment(db, adjust({ excludeCandidates: ["nope"] }), authority),
      /Unknown candidate/,
    );
    const receipt = await changeDayAdjustment(db, input, authority);
    assert.equal(receipt.state, "active");
    const plan = getOrPrepareCityPlan(db, PLZEN, day, NOW);
    assert.notEqual(plan.id, original.id);
    assert.ok(plan.zones.every((z) => z.sourceId !== swapped));
    assert.equal(plan.coverage.shortfall, 0);
    assert.deepEqual(plan.diagnostics.operatorAdjustment.excludeCandidates, [
      swapped,
    ]);
    // Other days and the stored original stay as they were.
    assert.equal(dayCityPack(db, PLZEN, "2026-11-06").dayAdjustment, undefined);
    assert.equal(
      db.prepare("SELECT 1 FROM world_blueprints WHERE id=?").get(original.id)
        ? 1
        : 0,
      1,
    );
    // Once the day is live it can no longer be changed.
    const dayNoon = Date.parse("2026-11-05T11:00:00Z");
    await ensureWorld(db, HOME, true, dayNoon);
    await assert.rejects(
      changeDayAdjustment(
        db,
        adjust({
          operationId: "late-clear",
          action: "clear",
          expectedVersion: 1,
        }),
        authority,
      ),
      (e) => e.code === "DAY_PUBLISHED",
    );
    const world = db
      .prepare("SELECT manifest FROM worlds WHERE id LIKE '%2026-11-05%'")
      .get();
    assert.ok(
      JSON.parse(world.manifest).zones.every((z) => z.sourceId !== swapped),
    );
  } finally {
    db.close();
  }
});

test("adjusted tomorrow is what the planner prepares and reports", async () => {
  const db = openDatabase(":memory:");
  try {
    const tomorrow = "2026-11-03";
    const base = getOrPrepareCityPlan(db, PLZEN, tomorrow, NOW);
    await changeDayAdjustment(
      db,
      adjust({ day: tomorrow, excludeCandidates: [base.zones[2].sourceId] }),
      authority,
    );
    const status = worldPreparationStatus(db, NOW);
    assert.equal(status.days[1].state, "pending");
    const plan = getOrPrepareCityPlan(db, PLZEN, tomorrow, NOW);
    assert.ok(plan.zones.every((z) => z.sourceId !== base.zones[2].sourceId));
    assert.equal(worldPreparationStatus(db, NOW).days[1].state, "ready");
  } finally {
    db.close();
  }
});

test("the health report covers worlds, pauses, adjustments, places, treasury and audit", async () => {
  const db = openDatabase(":memory:");
  try {
    createPlayer(db, "Explorer", NOW);
    await ensureWorld(db, HOME, true, NOW);
    changeWorldPause(db, pause({ zone: 1 }), authority);
    changePlace(
      db,
      PLZEN,
      {
        actor: "qa-operator",
        operationId: "qa-close",
        candidateId: PLZEN.candidates[0].id,
        action: "close",
        reason: "Fence repair",
        expectedVersion: 0,
      },
      authority,
    );
    const report = await worldHealthReport(db, {
      now: NOW,
      chain: {
        contractId: "rewards.testnet",
        view: async (method) =>
          method === "get_config"
            ? { paused: false }
            : { coins: { available: "1" }, zones: { available: "2" } },
      },
    });
    const city = report.cities.find((c) => c.cityId === PLZEN.id);
    assert.equal(city.today, "2026-11-02");
    assert.equal(city.worlds.length, 1);
    assert.ok(city.worlds[0].coins.total > 0);
    assert.equal(city.pauses[0].scope, "zone:1");
    assert.equal(city.closedPlaces.length, 1);
    assert.deepEqual(
      report.treasury.demo.buckets.map((b) => b.bucket),
      ["coins", "zones"],
    );
    assert.equal(report.treasury.native.paused, false);
    assert.deepEqual(
      report.audit.map((a) => a.kind),
      ["place-close", "pause"],
    );
    assert.equal(report.status, "attention");
    assert.ok(report.warnings.some((w) => w.includes("zone:1 paused")));
  } finally {
    db.close();
  }
});

test("operator CLI reports read only and mutates only with an input file and --apply", () => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-world-cli-")),
    file = join(dir, "qa.sqlite"),
    inputFile = join(dir, "pause.json");
  let db;
  try {
    db = openDatabase(file);
    db.close();
    db = null;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: PLZEN.timezone,
    }).format(Date.now());
    writeFileSync(inputFile, JSON.stringify(pause({ day: today })));
    const run = (...args) =>
      execFileSync(
        process.execPath,
        ["scripts/world-operator.mjs", ...args, "--database", file],
        { encoding: "utf8", stdio: "pipe" },
      );
    assert.throws(() => run("pause", "--input", inputFile));
    assert.throws(() => run("resume", "--input", inputFile, "--apply"));
    assert.equal(
      JSON.parse(run("pause", "--input", inputFile, "--apply")).state,
      "paused",
    );
    const report = JSON.parse(run("report"));
    assert.equal(report.cities[0].pauses[0].scope, "day");
    assert.equal(JSON.parse(run("audit"))[0].kind, "pause");
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
