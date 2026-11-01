import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import {
  changeSystemPlace,
  closedPlaces,
  effectiveCityPack,
  placeSafetyAudit,
} from "../server/spatial/place-safety.mjs";
import {
  getOrPrepareCityPlan,
  enqueueCityPlans,
  runWorldJobs,
  worldPreparationStatus,
} from "../server/world-planner.mjs";
import { ensureWorld, HOME, worldView } from "../server/world.mjs";
import { claimQuest, advanceRoute } from "../server/game.mjs";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const authority = { isOperator: () => true, clock: () => NOW };
const input = (candidateId, extra = {}) => ({
  actor: "qa-operator",
  operationId: "qa-close",
  candidateId,
  action: "close",
  reason: "Access closed for inspection",
  expectedVersion: 0,
  ...extra,
});

test("place operations deny untrusted callers, retain exact receipts and require the current version to reopen", () => {
  const db = openDatabase(":memory:");
  try {
    const op = input(PLZEN.candidates[0].id);
    assert.throws(() => changeSystemPlace(db, PLZEN, op), /trusted operator/);
    assert.equal(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='system_place_closures'",
        )
        .get(),
      undefined,
    );
    const receipt = changeSystemPlace(db, PLZEN, op, authority);
    assert.deepEqual(changeSystemPlace(db, PLZEN, op, authority), receipt);
    assert.throws(
      () =>
        changeSystemPlace(
          db,
          PLZEN,
          { ...op, reason: "different terms" },
          authority,
        ),
      /different terms/,
    );
    assert.throws(
      () =>
        changeSystemPlace(
          db,
          PLZEN,
          { ...op, operationId: "reopen", action: "reopen" },
          authority,
        ),
      /current version/,
    );
    assert.equal(closedPlaces(db, PLZEN.id).length, 1);
    changeSystemPlace(
      db,
      PLZEN,
      { ...op, operationId: "reopen", action: "reopen", expectedVersion: 1 },
      authority,
    );
    assert.equal(closedPlaces(db, PLZEN.id).length, 0);
    assert.equal(placeSafetyAudit(db).operations.length, 2);
  } finally {
    db.close();
  }
});
test("closing an active site stops new completions while old results, equipment and frozen geography remain intact", async () => {
  const db = openDatabase(":memory:");
  try {
    const player = createPlayer(db, "Original explorer", NOW),
      other = createPlayer(db, "Later explorer", NOW);
    const world = await ensureWorld(db, HOME, true, NOW),
      view = worldView(db, world.id, player);
    const q = view.quests.find((q) => q.tier === 1 && q.kind === "visit"),
      zone = world.zones.find((z) => z.id === q.zone_id);
    const result = claimQuest(db, player, q.id, q, NOW);
    const before = db
      .prepare("SELECT manifest FROM worlds WHERE id=?")
      .get(world.id).manifest;
    changeSystemPlace(db, PLZEN, input(zone.sourceId), authority);
    assert.throws(
      () => claimQuest(db, other, q.id, q, NOW),
      (e) => e.code === "PLACE_CLOSED",
    );
    assert.equal(
      claimQuest(db, player, q.id, q, NOW).result.id,
      result.result.id,
    );
    assert.equal(
      db.prepare("SELECT manifest FROM worlds WHERE id=?").get(world.id)
        .manifest,
      before,
    );
    const next = getOrPrepareCityPlan(db, PLZEN, "2026-11-03", NOW);
    assert.ok(next.zones.every((z) => z.sourceId !== zone.sourceId));
    assert.equal(
      effectiveCityPack(db, effectiveCityPack(db, PLZEN)).candidates.length,
      PLZEN.candidates.length - 1,
    );
    const route = view.quests.find(
      (r) => r.zone_id === zone.id && r.kind === "route",
    );
    assert.throws(
      () => advanceRoute(db, other, route.id, route.nextPoint, 0, NOW),
      (e) => e.code === "PLACE_CLOSED",
    );
  } finally {
    db.close();
  }
});
test("safety changes during an asynchronous preparation cannot store a plan using the obsolete safety version", async () => {
  const db = openDatabase(":memory:");
  try {
    enqueueCityPlans(db, NOW);
    let release;
    const pending = runWorldJobs(db, {
      clock: () => NOW,
      maxJobs: 1,
      build: async (city, day) => {
        await new Promise((r) => {
          release = r;
        });
        return (await import("../server/world-planner.mjs")).buildCityPlan(
          city,
          day,
        );
      },
    });
    changeSystemPlace(db, PLZEN, input(PLZEN.candidates[0].id), authority);
    release();
    assert.equal(await pending, 0);
    enqueueCityPlans(db, NOW);
    await runWorldJobs(db, { clock: () => NOW });
    assert.ok(
      worldPreparationStatus(db, NOW).days.every((d) => d.state === "ready"),
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM world_blueprints").get().n,
      2,
    );
  } finally {
    db.close();
  }
});
test("operator CLI requires explicit database/input/apply and safety history survives reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "questlayer-place-cli-")),
    file = join(dir, "qa.sqlite"),
    inputFile = join(dir, "operation.json");
  let db;
  try {
    db = openDatabase(file);
    db.close();
    db = null;
    writeFileSync(inputFile, JSON.stringify(input(PLZEN.candidates[0].id)));
    const args = [
      "scripts/place-operator.mjs",
      "close",
      "--database",
      file,
      "--input",
      inputFile,
    ];
    assert.throws(() =>
      execFileSync(process.execPath, args, { stdio: "pipe" }),
    );
    const result = JSON.parse(
      execFileSync(process.execPath, [...args, "--apply"], {
        encoding: "utf8",
      }),
    );
    assert.equal(result.state, "closed");
    const audit = JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/place-operator.mjs", "audit", "--database", file],
        { encoding: "utf8" },
      ),
    );
    assert.equal(audit.places[0].reason, "Access closed for inspection");
    db = openDatabase(file);
    assert.equal(closedPlaces(db, PLZEN.id).length, 1);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
