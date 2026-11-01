import { atomic } from "./database.mjs";
import { dayKey, hash, id, assert } from "./domain.mjs";
import { PLZEN, buildCityZones } from "./spatial/city-pack.mjs";
import { shiftDate, localDateBounds } from "./spatial/calendar.mjs";
import { effectiveCityPack } from "./spatial/place-safety.mjs";
import {
  QUEST_POLICY,
  QUEST_POLICY_START_DAY,
  zoneQuestTemplates,
} from "./quest-templates.mjs";
export const PLAN_VERSION = 1;
function validateCities(cities) {
  assert(
    Array.isArray(cities) &&
      cities.length <= 32 &&
      new Set(cities.map((c) => c.id)).size === cities.length,
    "Use a bounded registry with one pack per city.",
  );
}
export function planDescriptor(city, day) {
  const sourceHash = hash(JSON.stringify(city));
  return {
    id: `city-plan:${city.id}:${day}:v${PLAN_VERSION}:${sourceHash.slice(0, 16)}`,
    cityId: city.id,
    day,
    sourceHash,
  };
}
export function buildCityPlan(city, day) {
  const rejected = [];
  const descriptor = planDescriptor(city, day),
    { startsAt, endsAt } = localDateBounds(day, city.timezone),
    base = buildCityZones(city, day, {
      onRejected: (reason) => rejected.push(reason),
    }),
    timedTier2 = base.find((z) => z.tier === 2)?.slot;
  const zones = base.map((z) => {
    const hours =
      z.tier === 3 ? 1 : z.tier === 2 && z.slot === timedTier2 ? 3 : 0;
    const opensAt = hours
      ? endsAt - (24 - (z.tier === 3 ? 18 : 12)) * 3600000
      : startsAt;
    const zone = {
      ...z,
      opensAt,
      closesAt: hours ? Math.min(endsAt, opensAt + hours * 3600000) : endsAt,
    };
    // Stored plans are read before this builder and never updated in place.
    // Native v1 publication deliberately ignores this demo content extension.
    if (day >= QUEST_POLICY_START_DAY)
      zone.questActivities = zoneQuestTemplates(zone, { cityId: city.id, day });
    return zone;
  });
  // Six slots are requested. A reviewed candidate shortfall publishes fewer
  // zones with an explicit reason instead of inventing a site or failing the day.
  assert(zones.length <= 6, "City preparation cannot exceed six zones.");
  return {
    ...descriptor,
    version: PLAN_VERSION,
    coverage: {
      requestedZones: 6,
      acceptedZones: zones.length,
      shortfall: 6 - zones.length,
      reason: zones.length === 6 ? null : "not-enough-safe-candidates",
    },
    diagnostics: {
      candidateCount: city.candidates.length,
      rejected,
      routing: city.pedestrianGraph ? "mapped-connectivity" : "not-verified",
      fieldReview: city.fieldReview || "pending",
    },
    timezone: city.timezone,
    startsAt,
    endsAt,
    zones,
    ...(day >= QUEST_POLICY_START_DAY ? { questPolicy: QUEST_POLICY } : {}),
  };
}
function readPlan(db, descriptor) {
  const row = db
    .prepare("SELECT body,body_hash FROM world_blueprints WHERE id=?")
    .get(descriptor.id);
  if (!row) return null;
  assert(
    hash(row.body) === row.body_hash,
    "Stored city preparation failed integrity verification.",
    503,
  );
  const plan = JSON.parse(row.body);
  assert(
    plan.id === descriptor.id &&
      plan.cityId === descriptor.cityId &&
      plan.sourceHash === descriptor.sourceHash &&
      plan.day === descriptor.day &&
      plan.version === PLAN_VERSION,
    "Stored city preparation is incompatible.",
    503,
  );
  return plan;
}
function storePlan(db, descriptor, plan, now) {
  assert(
    plan.id === descriptor.id &&
      plan.cityId === descriptor.cityId &&
      plan.version === PLAN_VERSION &&
      plan.sourceHash === descriptor.sourceHash &&
      plan.day === descriptor.day,
    "Prepared city source changed.",
    503,
  );
  const body = JSON.stringify(plan);
  db.prepare(
    "INSERT OR IGNORE INTO world_blueprints VALUES(?,?,?,?,?,?,?)",
  ).run(
    descriptor.id,
    descriptor.cityId,
    descriptor.day,
    descriptor.sourceHash,
    body,
    hash(body),
    now,
  );
  return readPlan(db, descriptor);
}
// Preparing geography never reserves coins, mints rewards or modifies treasury.
export function getOrPrepareCityPlan(db, city, day, now = Date.now()) {
  city = effectiveCityPack(db, city);
  const descriptor = planDescriptor(city, day),
    existing = readPlan(db, descriptor);
  if (existing) return existing;
  const plan = buildCityPlan(city, day);
  return atomic(db, () => storePlan(db, descriptor, plan, now));
}
export function enqueueCityPlans(db, now = Date.now(), cities = [PLZEN]) {
  validateCities(cities);
  cities = cities.map((city) => effectiveCityPack(db, city));
  return atomic(db, () => {
    for (const city of cities) {
      const today = dayKey(now, city.timezone);
      for (const day of [today, shiftDate(today)]) {
        const d = planDescriptor(city, day);
        db.prepare(
          `INSERT OR IGNORE INTO world_jobs(id,city_id,day,source_hash,state,attempts,run_after,updated_at) VALUES(?,?,?,?,'queued',0,?,?)`,
        ).run(d.id, city.id, day, d.sourceHash, now, now);
      }
    }
  });
}
export async function runWorldJobs(
  db,
  {
    clock = Date.now,
    cities = [PLZEN],
    build = buildCityPlan,
    leaseMs = 30000,
    maxJobs = 2,
  } = {},
) {
  validateCities(cities);
  if (!cities.length) return 0;
  assert(
    Number.isSafeInteger(maxJobs) &&
      maxJobs >= 0 &&
      maxJobs <= 64 &&
      Number.isFinite(leaseMs) &&
      leaseMs > 0,
    "Invalid world preparation bounds.",
  );
  let completed = 0;
  for (let n = 0; n < maxJobs; n++) {
    const now = clock(),
      lease = id("world-lease"),
      activeIds = cities.flatMap((base) => {
        const city = effectiveCityPack(db, base);
        const today = dayKey(now, city.timezone);
        return [today, shiftDate(today)].map(
          (day) => planDescriptor(city, day).id,
        );
      });
    const job = atomic(db, () => {
      const row = db
        .prepare(
          `SELECT * FROM world_jobs WHERE id IN (${activeIds.map(() => "?").join(",")}) AND ((state IN ('queued','failed') AND run_after<=?) OR (state='running' AND lease_until<=?)) ORDER BY day,id LIMIT 1`,
        )
        .get(...activeIds, now, now);
      if (!row) return null;
      db.prepare(
        `UPDATE world_jobs SET state='running',attempts=attempts+1,lease_owner=?,lease_until=?,updated_at=? WHERE id=?`,
      ).run(lease, now + leaseMs, now, row.id);
      return row;
    });
    if (!job) break;
    try {
      const base = cities.find((c) => c.id === job.city_id),
        city = base && effectiveCityPack(db, base);
      assert(city, "City pack is unavailable.");
      const descriptor = planDescriptor(city, job.day);
      assert(
        descriptor.id === job.id,
        "City pack changed; this job is obsolete.",
      );
      const plan = await build(city, job.day),
        finished = clock();
      atomic(db, () => {
        const owned = db
          .prepare(
            `SELECT 1 FROM world_jobs WHERE id=? AND state='running' AND lease_owner=? AND lease_until>?`,
          )
          .get(job.id, lease, finished);
        assert(owned, "City preparation lease expired.");
        assert(
          planDescriptor(effectiveCityPack(db, base), job.day).id ===
            descriptor.id,
          "Place safety changed during preparation; retry its new version.",
        );
        storePlan(db, descriptor, plan, finished);
        db.prepare(
          `UPDATE world_jobs SET state='ready',lease_owner=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND lease_owner=?`,
        ).run(finished, job.id, lease);
      });
      completed++;
    } catch (error) {
      const finished = clock();
      db.prepare(
        `UPDATE world_jobs SET state='failed',run_after=?,lease_owner=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND lease_owner=?`,
      ).run(
        finished + Math.min(1800000, 5000 * 2 ** Math.min(job.attempts, 9)),
        String(error.message || "Preparation failed.").slice(0, 300),
        finished,
        job.id,
        lease,
      );
    }
  }
  return completed;
}
export function worldPreparationStatus(db, now = Date.now(), city = PLZEN) {
  city = effectiveCityPack(db, city);
  const today = dayKey(now, city.timezone);
  return {
    cityId: city.id,
    timezone: city.timezone,
    version: PLAN_VERSION,
    financialMode: "demo",
    days: [today, shiftDate(today)].map((day) => {
      const d = planDescriptor(city, day),
        job = db
          .prepare(
            "SELECT state,attempts,updated_at FROM world_jobs WHERE id=?",
          )
          .get(d.id),
        stored = db
          .prepare("SELECT 1 FROM world_blueprints WHERE id=?")
          .get(d.id);
      let plan = null;
      if (stored) {
        try {
          plan = readPlan(db, d);
        } catch {
          // Presence alone cannot advertise corrupt preparation as ready.
        }
      }
      return {
        day,
        state: plan ? "ready" : stored ? "failed" : job?.state || "pending",
        attempts: job?.attempts || 0,
        updatedAt: job?.updated_at || null,
        coverage: plan?.coverage || null,
        reason: stored && !plan ? "stored-plan-unavailable" : null,
      };
    }),
  };
}
export function startWorldPlanner(
  db,
  {
    intervalMs = 60000,
    clock = Date.now,
    cities = [PLZEN],
    maxJobs = 2,
    afterPreparation = async () => {},
  } = {},
) {
  let running = null,
    stopped = false;
  async function tick() {
    if (stopped || running) return running;
    running = (async () => {
      enqueueCityPlans(db, clock(), cities);
      await runWorldJobs(db, { clock, cities, maxJobs });
      await afterPreparation();
      // A local-day cutoff belongs to its own pack. Another city's timezone
      // must not retire this city's preparations early.
      atomic(db, () => {
        const nativeReferences = !!db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_days'",
          )
          .get();
        for (const city of cities) {
          const cutoff = shiftDate(dayKey(clock(), city.timezone), -14);
          db.prepare(
            `DELETE FROM world_blueprints WHERE city_id=? AND day<? AND id NOT IN(SELECT id FROM world_jobs WHERE state='running' AND lease_until>?)
             AND id NOT IN(SELECT json_extract(manifest,'$.blueprintId') FROM worlds WHERE json_valid(manifest) AND json_extract(manifest,'$.blueprintId') IS NOT NULL)
             ${nativeReferences ? `AND NOT EXISTS(SELECT 1 FROM native_days n WHERE json_valid(n.body) AND json_extract(n.body,'$.cityId')=world_blueprints.city_id AND json_extract(n.body,'$.day')=world_blueprints.day AND json_extract(n.body,'$.sourceHash')=world_blueprints.source_hash)` : ""}`,
          ).run(city.id, cutoff, clock());
          db.prepare(
            `DELETE FROM world_jobs WHERE city_id=? AND day<? AND (state!='running' OR lease_until<=?)`,
          ).run(city.id, cutoff, clock());
        }
      });
    })().finally(() => {
      running = null;
    });
    return running;
  }
  const timer = setInterval(
    () =>
      void tick().catch((e) =>
        console.error("World preparation failed:", e.name),
      ),
    intervalMs,
  );
  timer.unref();
  void tick().catch((e) => console.error("World preparation failed:", e.name));
  return {
    tick,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running?.catch(() => {});
    },
  };
}
