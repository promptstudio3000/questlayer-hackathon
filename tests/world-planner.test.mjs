import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/database.mjs";
import { PLZEN } from "../server/spatial/city-pack.mjs";
import { ensureWorld, HOME } from "../server/world.mjs";
import { localDateBounds, shiftDate } from "../server/spatial/calendar.mjs";
import {
  buildCityPlan,
  enqueueCityPlans,
  runWorldJobs,
  worldPreparationStatus,
} from "../server/world-planner.mjs";
const now = Date.parse("2026-10-31T12:00:00Z");
function balances(db) {
  return db.prepare("SELECT * FROM treasury ORDER BY bucket").all();
}
test("local calendar boundaries preserve short and long DST days and calendar rotation", () => {
  const spring = localDateBounds("2026-03-29", "Europe/Prague"),
    fall = localDateBounds("2026-10-25", "Europe/Prague");
  assert.equal(spring.endsAt - spring.startsAt, 23 * 3600000);
  assert.equal(fall.endsAt - fall.startsAt, 25 * 3600000);
  assert.equal(shiftDate("2026-12-31"), "2027-01-01");
  assert.equal(
    buildCityPlan(PLZEN, "2026-10-25").zones.find((z) => z.tier === 3).opensAt,
    Date.parse("2026-10-25T17:00:00Z"),
  );
});
test("durable preparation is deterministic, idempotent and reserves no money or future loot", async () => {
  const db = openDatabase(":memory:");
  try {
    const before = balances(db);
    enqueueCityPlans(db, now);
    enqueueCityPlans(db, now);
    assert.equal(db.prepare("SELECT count(*) AS n FROM world_jobs").get().n, 2);
    assert.equal(await runWorldJobs(db, { clock: () => now }), 2);
    assert.equal(await runWorldJobs(db, { clock: () => now }), 0);
    assert.deepEqual(balances(db), before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM worlds").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM coins").get().n, 0);
    assert.deepEqual(
      worldPreparationStatus(db, now).days.map((d) => d.state),
      ["ready", "ready"],
    );
    const rows = db
      .prepare("SELECT body FROM world_blueprints ORDER BY day")
      .all();
    assert.deepEqual(
      JSON.parse(rows[0].body),
      buildCityPlan(PLZEN, "2026-10-31"),
    );
    assert.notDeepEqual(
      JSON.parse(rows[0].body).zones,
      JSON.parse(rows[1].body).zones,
    );
    const status = JSON.stringify(worldPreparationStatus(db, now));
    assert.ok(!status.includes("coordinates"));
    assert.ok(!status.includes("targets"));
  } finally {
    db.close();
  }
});
test("failed preparations back off and recover without duplicate reservations", async () => {
  const db = openDatabase(":memory:");
  try {
    let time = now;
    const before = balances(db);
    enqueueCityPlans(db, time);
    await runWorldJobs(db, {
      clock: () => time,
      maxJobs: 1,
      build: () => {
        throw Error("Pack unavailable");
      },
    });
    const failed = db
      .prepare("SELECT * FROM world_jobs WHERE state='failed'")
      .get();
    assert.equal(failed.attempts, 1);
    assert.ok(failed.run_after > time);
    await runWorldJobs(db, { clock: () => time });
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM world_jobs WHERE state='ready'")
        .get().n,
      1,
    );
    time = failed.run_after;
    await runWorldJobs(db, { clock: () => time });
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM world_jobs WHERE state='ready'")
        .get().n,
      2,
    );
    assert.deepEqual(balances(db), before);
  } finally {
    db.close();
  }
});
test("an expired preparation lease can be reclaimed and its stale worker cannot overwrite completion", async () => {
  const db = openDatabase(":memory:");
  try {
    let time = now,
      release;
    enqueueCityPlans(db, time);
    const old = runWorldJobs(db, {
      clock: () => time,
      maxJobs: 1,
      leaseMs: 100,
      build: async (city, day) => {
        await new Promise((r) => {
          release = r;
        });
        return buildCityPlan(city, day);
      },
    });
    time += 101;
    assert.equal(await runWorldJobs(db, { clock: () => time, maxJobs: 1 }), 1);
    release();
    assert.equal(await old, 0);
    const job = db
      .prepare("SELECT * FROM world_jobs ORDER BY day LIMIT 1")
      .get();
    assert.equal(job.state, "ready");
    assert.equal(job.attempts, 2);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM world_blueprints").get().n,
      1,
    );
  } finally {
    db.close();
  }
});
test("a new local day immediately recovers uncollected backing before publishing its next world", async () => {
  const db = openDatabase(":memory:");
  try {
    const before = balances(db),
      today = await ensureWorld(db, HOME, true, now),
      first = balances(db);
    const next = await ensureWorld(db, HOME, true, today.endsAt + 1);
    assert.equal(next.day, "2026-11-01");
    assert.notEqual(next.id, today.id);
    assert.deepEqual(balances(db), first);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM coins WHERE world_id=?")
        .get(next.id).n,
      6000,
    );
    for (const row of balances(db)) {
      const original = before.find((b) => b.bucket === row.bucket);
      assert.equal(
        row.available_u + row.reserved_u + row.paid_u,
        original.available_u + original.reserved_u + original.paid_u,
      );
    }
  } finally {
    db.close();
  }
});

test("a restarted process resumes persisted SQLite work without touching treasury", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "questlayer-world-restart-")),
    file = join(dir, "world.sqlite");
  let db;
  try {
    db = openDatabase(file);
    const before = balances(db);
    enqueueCityPlans(db, now);
    db.prepare(
      "UPDATE world_jobs SET state='running',lease_owner='interrupted-process',lease_until=?,attempts=1",
    ).run(now + 100);
    db.close();
    db = openDatabase(file);
    assert.equal(await runWorldJobs(db, { clock: () => now + 101 }), 2);
    assert.deepEqual(
      worldPreparationStatus(db, now).days.map((d) => d.state),
      ["ready", "ready"],
    );
    assert.deepEqual(balances(db), before);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
