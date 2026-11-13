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
  startWorldPlanner,
  getOrPrepareCityPlan,
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
    // Yesterday's coins went back before today's cell drop reserved its own.
    const coins = (id) =>
      db.prepare("SELECT count(*) n,COALESCE(SUM(value_u),0) v FROM coins WHERE world_id=?").get(id);
    assert.ok(coins(next.id).n > 0);
    // Map coins are backed by the on-chain day budget: the DB treasury
    // reserves nothing for them.
    assert.ok(coins(next.id).v > 0);
    assert.equal(balances(db).find((b) => b.bucket === "coins").reserved_u, first.find((b) => b.bucket === "coins").reserved_u);
    assert.equal(balances(db).find((b) => b.bucket === "zones").reserved_u, first.find((b) => b.bucket === "zones").reserved_u);
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

test("a sector without safe candidates publishes fewer zones with an explicit shortfall instead of failing", async () => {
  const { PLZEN } = await import("../server/spatial/city-pack.mjs");
  const { buildCityPlan } = await import("../server/world-planner.mjs");
  const reduced = {
    ...PLZEN,
    candidates: PLZEN.candidates.filter((c) => c.sector !== "west"),
  };
  const plan = buildCityPlan(reduced, "2026-11-03");
  assert.equal(plan.zones.length, 5);
  assert.deepEqual(plan.coverage, {
    requestedZones: 6,
    acceptedZones: 5,
    shortfall: 1,
    reason: "not-enough-safe-candidates",
  });
  const full = buildCityPlan(PLZEN, "2026-11-03");
  assert.equal(full.zones.length, 6);
  assert.equal(full.coverage.shortfall, 0);
  const sparse = buildCityPlan(
    {
      ...PLZEN,
      candidates: PLZEN.candidates.filter((c) => c.sector === "central"),
    },
    "2026-11-03",
  );
  assert.equal(sparse.zones.length, 1);
  assert.equal(sparse.coverage.shortfall, 5);
  const empty = buildCityPlan({ ...PLZEN, candidates: [] }, "2026-11-03");
  assert.deepEqual(empty.zones, []);
  assert.equal(empty.coverage.shortfall, 6);
});

test("bad candidates produce diagnostic shortfalls without breaking other sectors or advertising verified access", () => {
  const broken = {
    ...PLZEN,
    candidates: PLZEN.candidates.map((c) =>
      c.sector === "west" ? { ...c, geometry: null } : c,
    ),
  };
  const plan = buildCityPlan(broken, "2026-11-03");
  assert.equal(plan.zones.length, 5);
  assert.ok(plan.diagnostics.rejected.some((r) => r.sector === "west"));
  assert.ok(plan.diagnostics.rejected.every((r) => r.reason && r.candidateId));
  assert.equal(plan.diagnostics.routing, "not-verified");
});

test("readiness checks stored integrity and exposes counts without future coordinates", async () => {
  const db = openDatabase(":memory:");
  try {
    enqueueCityPlans(db, now);
    await runWorldJobs(db, { clock: () => now });
    const good = worldPreparationStatus(db, now);
    assert.equal(good.days[0].coverage.acceptedZones, 6);
    db.prepare("UPDATE world_blueprints SET body_hash='tampered'").run();
    const bad = worldPreparationStatus(db, now);
    assert.ok(
      bad.days.every((d) => d.state === "failed" && d.coverage === null),
    );
    assert.ok(bad.days.every((d) => d.reason === "stored-plan-unavailable"));
    assert.doesNotMatch(JSON.stringify(bad), /targets|coordinates|candidateId/);
  } finally {
    db.close();
  }
});

test("the running planner respects its explicit city registry and retains published map geometry", async () => {
  const db = openDatabase(":memory:");
  // Synthetic fixture only: this is not a reviewed second city.
  const city = { ...PLZEN, id: "qa-city", timezone: "America/New_York" };
  const instant = Date.parse("2026-11-01T01:00:00Z");
  let worker;
  try {
    const oldWorld = await ensureWorld(db, HOME, true, now - 20 * 86400000);
    const nativePlan = getOrPrepareCityPlan(db, PLZEN, "2026-10-10", now);
    const unused = getOrPrepareCityPlan(db, PLZEN, "2026-10-09", now);
    db.exec("CREATE TABLE native_days(body TEXT)");
    db.prepare("INSERT INTO native_days VALUES(?)").run(
      JSON.stringify(nativePlan),
    );
    enqueueCityPlans(db, now - 20 * 86400000);
    db.prepare(
      "UPDATE world_jobs SET state='running',lease_owner='dead-process',lease_until=?",
    ).run(now - 19 * 86400000);
    worker = startWorldPlanner(db, {
      clock: () => instant,
      cities: [PLZEN, city],
      maxJobs: 4,
    });
    await worker.tick();
    assert.deepEqual(
      worldPreparationStatus(db, instant, city).days.map((d) => d.day),
      ["2026-10-31", "2026-11-01"],
    );
    assert.ok(
      worldPreparationStatus(db, instant, city).days.every(
        (d) => d.state === "ready",
      ),
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM world_blueprints WHERE id=?")
        .get(oldWorld.blueprintId),
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM world_blueprints WHERE id=?")
        .get(nativePlan.id),
    );
    assert.equal(
      db.prepare("SELECT 1 FROM world_blueprints WHERE id=?").get(unused.id),
      undefined,
    );
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM world_jobs WHERE day<'2026-10-18'")
        .get().n,
      0,
    );
  } finally {
    await worker?.stop();
    db.close();
  }
});

test("obsolete source jobs and yesterday's retries cannot starve the current city dates", async () => {
  const db = openDatabase(":memory:");
  try {
    enqueueCityPlans(db, now - 2 * 86400000);
    enqueueCityPlans(db, now, [{ ...PLZEN, version: "obsolete-fixture" }]);
    enqueueCityPlans(db, now);
    assert.equal(await runWorldJobs(db, { clock: () => now, maxJobs: 2 }), 2);
    assert.ok(
      worldPreparationStatus(db, now).days.every((d) => d.state === "ready"),
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM world_blueprints").get().n,
      2,
    );
    assert.throws(
      () => enqueueCityPlans(db, now, [PLZEN, PLZEN]),
      /one pack per city/,
    );
  } finally {
    db.close();
  }
});
