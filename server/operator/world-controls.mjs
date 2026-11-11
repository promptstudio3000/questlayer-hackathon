// Operator world controls (W11): pause a city day or one of its zones, adjust a
// future day before anything is published for it, and read world and treasury
// health in one report. Every mutation is audited with an idempotent receipt.
//
// There is deliberately no HTTP mutation route. Authority comes from the local
// operator CLI (scripts/world-operator.mjs), which needs OS access to the
// protected database, exactly like place closures and note moderation.
//
// Boundaries:
// - Published days are never rewritten. A pause only stops new visits and
//   pickups from being accepted while it lasts; stored manifests, native
//   commitments on chain, already accepted receipts and payouts are untouched.
// - A day adjustment only applies to a future local date that has no world and
//   no native manifest yet. It changes which reviewed places that date uses;
//   it never changes tiers, rewards, budgets or treasury.
import { assert, dayKey, hash } from "../domain.mjs";
import { atomic } from "../database.mjs";
import { shiftDate } from "../spatial/calendar.mjs";
import { DEFAULT_CITY, LIVE_CITIES } from "../spatial/city-pack.mjs";
import { withDemoZones } from "../demo-zones.mjs";
import {
  baseCityPack,
  changeSystemPlace,
  closedPlaces,
  effectiveCityPack,
  placeSafetyAudit,
  rememberCityOrigin,
} from "../spatial/place-safety.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const WORLD_CONTROLS_SCHEMA = registerModuleSchema({
  name: "world-operator-controls",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS world_pauses(city_id TEXT NOT NULL,day TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope='day' OR scope GLOB 'zone:[0-9]'),state TEXT NOT NULL CHECK(state IN('paused','active')),version INTEGER NOT NULL CHECK(version>0),reason TEXT NOT NULL,actor TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(city_id,day,scope));
CREATE TABLE IF NOT EXISTS world_day_adjustments(city_id TEXT NOT NULL,day TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('active','cleared')),version INTEGER NOT NULL CHECK(version>0),body TEXT NOT NULL CHECK(json_valid(body)),reason TEXT NOT NULL,actor TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(city_id,day));
CREATE TABLE IF NOT EXISTS world_operator_audit(seq INTEGER PRIMARY KEY,actor TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL CHECK(json_valid(receipt)),created_at INTEGER NOT NULL,UNIQUE(actor,operation_id));
`,
});

export const MAX_ADJUST_AHEAD_DAYS = 14;
const key = (s) => typeof s === "string" && /^[A-Za-z0-9:_.@-]{1,100}$/.test(s);
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const tableExists = (db, name) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
const present = (db) => tableExists(db, "world_pauses");

function exactFields(input, fields) {
  assert(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).length === fields.length &&
      Object.keys(input).every((k) => fields.includes(k)),
    `Supply exactly these fields: ${fields.join(", ")}.`,
  );
}
function checkCommon(input, isOperator) {
  assert(
    isOperator(input?.actor) === true,
    "World operations require trusted operator authority.",
    403,
  );
  assert(
    key(input.actor) && key(input.operationId),
    "Use a simple actor and operation id.",
  );
  assert(
    typeof input.reason === "string" &&
      input.reason.trim().length >= 3 &&
      input.reason.length <= 300 &&
      !/[\x00-\x1f]/.test(input.reason),
    "Supply a short operator reason.",
  );
  assert(
    Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0,
    "Supply expectedVersion from the current report.",
  );
}
function cityFrom(cities, cityId) {
  const city = cities.find((c) => c.id === cityId);
  assert(city, "Select a live city.", 404);
  return city;
}
// One audit row per (actor, operationId). A retry with the same terms returns
// the first receipt; different terms under the same id are refused.
function replay(db, actor, operationId, digest) {
  const previous = db
    .prepare(
      "SELECT digest,receipt FROM world_operator_audit WHERE actor=? AND operation_id=?",
    )
    .get(actor, operationId);
  if (!previous) return null;
  assert(
    previous.digest === digest,
    "This operation id already has different terms.",
    409,
  );
  return JSON.parse(previous.receipt);
}
function audit(db, actor, operationId, kind, digest, receipt, at) {
  db.prepare(
    "INSERT INTO world_operator_audit(actor,operation_id,kind,digest,receipt,created_at) VALUES(?,?,?,?,?,?)",
  ).run(actor, operationId, kind, digest, JSON.stringify(receipt), at);
}

// ---------------------------------------------------------------- pauses

/** Active pauses for one city day: { day: row|null, zones: Map(slot,row) }. */
export function pauseState(db, cityId, day) {
  const state = { day: null, zones: new Map() };
  if (!cityId || !day || !present(db)) return state;
  for (const r of db
    .prepare(
      "SELECT scope,version,reason,updated_at FROM world_pauses WHERE city_id=? AND day=? AND state='paused'",
    )
    .all(cityId, day)) {
    const view = { reason: r.reason, version: r.version, since: r.updated_at };
    if (r.scope === "day") state.day = view;
    else state.zones.set(Number(r.scope.slice(5)), view);
  }
  return state;
}
/** The pause that blocks this discovery, or null. Coins only follow day pauses. */
export function pauseFor(state, slot = null) {
  return (
    state.day ||
    (Number.isInteger(slot) ? state.zones.get(slot) || null : null)
  );
}
export function assertWorldActive(db, cityId, day, slot = null) {
  assert(
    !pauseFor(pauseState(db, cityId, day), slot),
    slot === null
      ? "Operators paused today's world for a moment. Your progress is safe; try again later."
      : "Operators paused this area for now. Choose another discovery.",
    423,
    "WORLD_PAUSED",
  );
}

export function changeWorldPause(
  db,
  input,
  { isOperator = () => false, clock = Date.now, cities = LIVE_CITIES } = {},
) {
  const fields = [
    "actor",
    "operationId",
    "cityId",
    "day",
    "zone",
    "action",
    "reason",
    "expectedVersion",
  ];
  checkCommon(input, isOperator);
  exactFields(input, fields);
  assert(["pause", "resume"].includes(input.action), "Use pause or resume.");
  assert(
    input.zone === null ||
      (Number.isInteger(input.zone) && input.zone >= 0 && input.zone <= 5),
    "Use zone null for the whole day or a zone slot 0-5.",
  );
  const city = cityFrom(cities, input.cityId);
  assert(isDay(input.day), "Use a local date YYYY-MM-DD.");
  const today = dayKey(clock(), city.timezone);
  assert(
    input.action === "resume" || input.day >= today,
    "Only today or a future day can be paused.",
  );
  assert(
    input.day <= shiftDate(today, MAX_ADJUST_AHEAD_DAYS),
    `Pause at most ${MAX_ADJUST_AHEAD_DAYS} days ahead.`,
  );
  const scope = input.zone === null ? "day" : `zone:${input.zone}`;
  const digest = hash(
    JSON.stringify(["pause", ...fields.map((k) => input[k] ?? null)]),
  );
  ensureModuleVersion(db, WORLD_CONTROLS_SCHEMA);
  return atomic(db, () => {
    const replayed = replay(db, input.actor, input.operationId, digest);
    if (replayed) return replayed;
    const row = db
      .prepare(
        "SELECT state,version FROM world_pauses WHERE city_id=? AND day=? AND scope=?",
      )
      .get(city.id, input.day, scope);
    assert(
      (row?.version || 0) === input.expectedVersion,
      "The pause changed. Review its current version first.",
      409,
      "STALE_PAUSE_VERSION",
    );
    assert(
      input.action === "pause"
        ? row?.state !== "paused"
        : row?.state === "paused",
      input.action === "pause"
        ? "This is already paused."
        : "Only a paused day or zone can be resumed.",
      409,
    );
    const at = clock(),
      version = (row?.version || 0) + 1,
      state = input.action === "pause" ? "paused" : "active",
      reason = input.reason.trim();
    db.prepare(
      "INSERT INTO world_pauses VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(city_id,day,scope) DO UPDATE SET state=excluded.state,version=excluded.version,reason=excluded.reason,actor=excluded.actor,updated_at=excluded.updated_at",
    ).run(city.id, input.day, scope, state, version, reason, input.actor, at);
    const receipt = {
      kind: "pause",
      cityId: city.id,
      day: input.day,
      scope,
      state,
      version,
      reason,
      actor: input.actor,
      at,
    };
    audit(db, input.actor, input.operationId, input.action, digest, receipt, at);
    return receipt;
  });
}

// ------------------------------------------------------- day adjustments

export function dayAdjustment(db, cityId, day) {
  if (!present(db)) return null;
  const row = db
    .prepare(
      "SELECT body,version,reason FROM world_day_adjustments WHERE city_id=? AND day=? AND state='active'",
    )
    .get(cityId, day);
  return row ? { ...JSON.parse(row.body), version: row.version } : null;
}
/**
 * The pack a given local date is planned from: place closures plus that date's
 * operator adjustment. The adjustment is part of the pack, so it changes the
 * plan's sourceHash and therefore its id; an earlier stored plan is never
 * updated in place.
 */
export function dayCityPack(db, city, day) {
  const base = baseCityPack(city),
    // DEMO_ZONES swaps in the compact demo candidates (server/demo-zones.mjs);
    // closures and day adjustments still apply on top of them.
    effective = withDemoZones(effectiveCityPack(db, base)),
    adjustment = isDay(day) ? dayAdjustment(db, base.id, day) : null;
  if (!adjustment) return effective;
  const excluded = new Set(adjustment.excludeCandidates);
  return rememberCityOrigin(
    {
      ...effective,
      candidates: effective.candidates.filter((c) => !excluded.has(c.id)),
      dayAdjustment: {
        day,
        version: adjustment.version,
        excludeCandidates: [...excluded].sort(),
      },
    },
    base,
  );
}
/** Why a date can no longer be adjusted, or null when it still can. */
export function dayPublication(db, cityId, day) {
  const world = db
    .prepare(
      "SELECT id FROM worlds WHERE json_valid(manifest) AND json_extract(manifest,'$.cityId')=? AND json_extract(manifest,'$.day')=? LIMIT 1",
    )
    .get(cityId, day);
  if (world) return { kind: "world", id: world.id };
  if (tableExists(db, "native_days")) {
    const native = db
      .prepare(
        "SELECT id,state FROM native_days WHERE day=? AND json_valid(body) AND json_extract(body,'$.cityId')=? LIMIT 1",
      )
      .get(day, cityId);
    if (native) return { kind: "native", id: native.id, state: native.state };
  }
  return null;
}

export async function changeDayAdjustment(
  db,
  input,
  {
    isOperator = () => false,
    clock = Date.now,
    cities = LIVE_CITIES,
    preview = false,
  } = {},
) {
  const fields = [
    "actor",
    "operationId",
    "cityId",
    "day",
    "action",
    "excludeCandidates",
    "reason",
    "expectedVersion",
  ];
  checkCommon(input, isOperator);
  exactFields(input, fields);
  assert(["set", "clear"].includes(input.action), "Use set or clear.");
  const city = cityFrom(cities, input.cityId);
  assert(isDay(input.day), "Use a local date YYYY-MM-DD.");
  const today = dayKey(clock(), city.timezone);
  assert(
    input.day > today && input.day <= shiftDate(today, MAX_ADJUST_AHEAD_DAYS),
    `Adjust a future day, at most ${MAX_ADJUST_AHEAD_DAYS} days ahead.`,
  );
  const list = input.excludeCandidates;
  assert(
    Array.isArray(list) &&
      list.length <= 12 &&
      new Set(list).size === list.length &&
      list.every(key),
    "excludeCandidates is a list of up to 12 distinct candidate ids.",
  );
  if (input.action === "set") {
    assert(list.length > 0, "Exclude at least one place, or use clear.");
    for (const id of list)
      assert(
        baseCityPack(city).candidates.some((c) => c.id === id),
        `Unknown candidate ${id}.`,
        404,
      );
  } else assert(list.length === 0, "clear takes an empty excludeCandidates.");
  const published = dayPublication(db, city.id, input.day);
  assert(
    !published,
    `This day is already ${published?.kind === "native" ? "published natively" : "live"}; published days cannot be adjusted.`,
    409,
    "DAY_PUBLISHED",
  );
  // Prove the adjusted day still fills every slot. Native days require six
  // zones; a shortfall would silently fall back to a demo-only day.
  const { buildCityPlan } = await import("../world-planner.mjs");
  const effective = effectiveCityPack(db, baseCityPack(city)),
    excluded = new Set(list);
  const plan = buildCityPlan(
    input.action === "set"
      ? {
          ...effective,
          candidates: effective.candidates.filter((c) => !excluded.has(c.id)),
        }
      : effective,
    input.day,
  );
  assert(
    plan.coverage.shortfall === 0,
    "This adjustment would leave a slot without a safe place. Exclude fewer places.",
    409,
    "ADJUSTMENT_SHORTFALL",
  );
  const zones = plan.zones.map((z) => ({
    slot: z.slot,
    sector: z.sector,
    name: z.name,
    sourceId: z.sourceId,
    tier: z.tier,
  }));
  const digest = hash(
    JSON.stringify(["adjust", ...fields.map((k) => input[k])]),
  );
  if (preview) return { preview: true, cityId: city.id, day: input.day, zones };
  ensureModuleVersion(db, WORLD_CONTROLS_SCHEMA);
  return atomic(db, () => {
    const replayed = replay(db, input.actor, input.operationId, digest);
    if (replayed) return replayed;
    const again = dayPublication(db, city.id, input.day);
    assert(!again, "This day was published meanwhile.", 409, "DAY_PUBLISHED");
    const row = db
      .prepare(
        "SELECT state,version FROM world_day_adjustments WHERE city_id=? AND day=?",
      )
      .get(city.id, input.day);
    assert(
      (row?.version || 0) === input.expectedVersion,
      "The adjustment changed. Review its current version first.",
      409,
      "STALE_ADJUSTMENT_VERSION",
    );
    assert(
      input.action === "set" || row?.state === "active",
      "There is no active adjustment to clear.",
      409,
    );
    const at = clock(),
      version = (row?.version || 0) + 1,
      state = input.action === "set" ? "active" : "cleared",
      reason = input.reason.trim(),
      body = { excludeCandidates: [...list].sort() };
    db.prepare(
      "INSERT INTO world_day_adjustments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(city_id,day) DO UPDATE SET state=excluded.state,version=excluded.version,body=excluded.body,reason=excluded.reason,actor=excluded.actor,updated_at=excluded.updated_at",
    ).run(
      city.id,
      input.day,
      state,
      version,
      JSON.stringify(body),
      reason,
      input.actor,
      at,
    );
    const receipt = {
      kind: "day-adjustment",
      cityId: city.id,
      day: input.day,
      state,
      version,
      ...body,
      zones,
      reason,
      actor: input.actor,
      at,
    };
    audit(
      db,
      input.actor,
      input.operationId,
      `adjust-${input.action}`,
      digest,
      receipt,
      at,
    );
    return receipt;
  });
}

// ------------------------------------------------- place closures (audited)

/** changeSystemPlace plus a row in the shared operator audit log. */
export function changePlace(db, city, input, options = {}) {
  const receipt = changeSystemPlace(db, city, input, options);
  ensureModuleVersion(db, WORLD_CONTROLS_SCHEMA);
  const digest = hash(JSON.stringify(["place", receipt]));
  atomic(db, () => {
    if (!replay(db, input.actor, input.operationId, digest))
      audit(
        db,
        input.actor,
        input.operationId,
        `place-${input.action}`,
        digest,
        { kind: "place", ...receipt, actor: input.actor },
        receipt.at,
      );
  });
  return receipt;
}

// ----------------------------------------------------------------- report

/** Current versions to send as expectedVersion, for one city day. */
export function controlVersions(db, cityId, day) {
  assert(typeof cityId === "string" && isDay(day), "Select a city and day.");
  const versions = { pauses: {}, adjustment: null, places: {} };
  if (present(db)) {
    for (const r of db
      .prepare(
        "SELECT scope,state,version FROM world_pauses WHERE city_id=? AND day=?",
      )
      .all(cityId, day))
      versions.pauses[r.scope] = { state: r.state, version: r.version };
    const adj = db
      .prepare(
        "SELECT state,version,body FROM world_day_adjustments WHERE city_id=? AND day=?",
      )
      .get(cityId, day);
    if (adj)
      versions.adjustment = {
        state: adj.state,
        version: adj.version,
        ...JSON.parse(adj.body),
      };
  }
  if (tableExists(db, "system_place_closures"))
    for (const r of db
      .prepare(
        "SELECT candidate_id,state,version FROM system_place_closures WHERE city_id=?",
      )
      .all(cityId))
      versions.places[r.candidate_id] = { state: r.state, version: r.version };
  versions.publishedAs = dayPublication(db, cityId, day);
  return versions;
}

export function operatorAudit(db, { limit = 50 } = {}) {
  assert(
    Number.isSafeInteger(limit) && limit > 0 && limit <= 200,
    "Use an audit limit between 1 and 200.",
  );
  if (!present(db)) return [];
  return db
    .prepare(
      "SELECT seq,actor,operation_id AS operationId,kind,receipt,created_at AS at FROM world_operator_audit ORDER BY seq DESC LIMIT ?",
    )
    .all(limit)
    .map((r) => ({ ...r, receipt: JSON.parse(r.receipt) }));
}

function cityHealth(db, city, now, warnings) {
  const today = dayKey(now, city.timezone),
    tomorrow = shiftDate(today);
  const worlds = db
    .prepare(
      "SELECT id,manifest FROM worlds WHERE json_valid(manifest) AND json_extract(manifest,'$.cityId')=? AND json_extract(manifest,'$.day')=? ORDER BY id",
    )
    .all(city.id, today)
    .map((w) => {
      const m = JSON.parse(w.manifest);
      const coins = db
        .prepare(
          "SELECT COUNT(*) total,COALESCE(SUM(claimant IS NOT NULL),0) claimed,COALESCE(SUM(value_u),0) value_u,COALESCE(SUM(CASE WHEN claimant IS NOT NULL THEN value_u END),0) claimed_u FROM coins WHERE world_id=?",
        )
        .get(w.id);
      const quests = db
        .prepare(
          "SELECT COUNT(*) total,(SELECT COUNT(*) FROM quest_claims c JOIN quests q2 ON q2.id=c.quest_id WHERE q2.world_id=?) claims FROM quests WHERE world_id=?",
        )
        .get(w.id, w.id);
      return {
        id: w.id,
        arena: !!m.arena,
        zones: m.zones.length,
        endsAt: m.endsAt,
        coins: {
          total: coins.total,
          claimed: coins.claimed,
          valueU: coins.value_u,
          claimedU: coins.claimed_u,
        },
        quests: { total: quests.total, claims: quests.claims },
      };
    });
  const pauses = present(db)
    ? db
        .prepare(
          "SELECT day,scope,version,reason,actor,updated_at AS since FROM world_pauses WHERE city_id=? AND state='paused' AND day>=? ORDER BY day,scope",
        )
        .all(city.id, today)
    : [];
  const adjustments = present(db)
    ? db
        .prepare(
          "SELECT day,version,body,reason,actor,updated_at AS at FROM world_day_adjustments WHERE city_id=? AND state='active' AND day>=? ORDER BY day",
        )
        .all(city.id, today)
        .map((r) => ({
          ...r,
          body: undefined,
          ...JSON.parse(r.body),
          publishedAs: dayPublication(db, city.id, r.day),
        }))
    : [];
  const nativeDays = tableExists(db, "native_days")
    ? db
        .prepare(
          "SELECT id,day,state,transaction_hash AS tx,updated_at AS updatedAt FROM native_days WHERE day>=? AND json_valid(body) AND json_extract(body,'$.cityId')=? ORDER BY day,id",
        )
        .all(shiftDate(today, -1), city.id)
    : [];
  const preparation = [today, tomorrow].map((day) => {
    const job = db
      .prepare(
        "SELECT state,attempts,last_error AS lastError,updated_at AS updatedAt FROM world_jobs WHERE city_id=? AND day=? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(city.id, day);
    const stored = db
      .prepare(
        "SELECT COUNT(*) n FROM world_blueprints WHERE city_id=? AND day=?",
      )
      .get(city.id, day).n;
    return { day, job: job || null, storedPlans: stored };
  });
  const closed = closedPlaces(db, city.id).map(({ id, version }) => ({
    id,
    version,
  }));
  for (const p of preparation)
    if (p.job?.state === "failed")
      warnings.push(
        `${city.id} ${p.day}: world preparation failed (${p.job.lastError || "unknown"}).`,
      );
  if (!worlds.length)
    warnings.push(`${city.id} ${today}: no live world yet today.`);
  for (const p of pauses)
    warnings.push(
      `${city.id} ${p.day}: ${p.scope === "day" ? "whole day" : p.scope} paused (${p.reason}).`,
    );
  for (const n of nativeDays)
    if (n.day === today && n.state !== "published")
      warnings.push(`${city.id} ${today}: native day ${n.id} is ${n.state}.`);
  for (const a of adjustments)
    if (a.publishedAs)
      warnings.push(
        `${city.id} ${a.day}: adjustment v${a.version} recorded but the day was published as ${a.publishedAs.id}; check it used the adjustment.`,
      );
  return {
    cityId: city.id,
    timezone: city.timezone,
    today,
    worlds,
    preparation,
    pauses,
    adjustments,
    closedPlaces: closed,
    nativeDays,
  };
}

function demoTreasury(db, warnings) {
  const buckets = db
    .prepare(
      "SELECT bucket,available_u AS availableU,reserved_u AS reservedU,paid_u AS paidU FROM treasury ORDER BY bucket",
    )
    .all();
  const funded = db
    .prepare(
      "SELECT COUNT(*) events,COALESCE(SUM(coins_u),0) coinsU,COALESCE(SUM(zones_u),0) zonesU,MAX(created_at) lastAt FROM treasury_events",
    )
    .get();
  for (const b of buckets) {
    const funding = b.bucket === "coins" ? funded.coinsU : funded.zonesU;
    if (funding && b.availableU < funding * 0.05)
      warnings.push(
        `Demo treasury ${b.bucket}: under 5% of funding remains available.`,
      );
  }
  return { currency: "demo GOLD (micro units)", buckets, funding: funded };
}

/**
 * One read-only report of world and treasury health. `chain` is an optional
 * async reader ({ contractId, view(method,args) }) for the native rewards
 * contract; without it the report covers local state only.
 */
export async function worldHealthReport(
  db,
  { now = Date.now(), cities = LIVE_CITIES, chain = null, auditLimit = 20 } = {},
) {
  const warnings = [];
  const report = {
    generatedAt: now,
    defaultCity: DEFAULT_CITY.id,
    cities: cities.map((c) => cityHealth(db, c, now, warnings)),
    treasury: { demo: demoTreasury(db, warnings), native: null },
    places: placeSafetyAudit(db, { limit: 10 }).places,
    audit: operatorAudit(db, { limit: auditLimit }),
    warnings,
  };
  if (chain) {
    try {
      const [treasury, config] = await Promise.all([
        chain.view("get_treasury", {}),
        chain.view("get_config", {}),
      ]);
      report.treasury.native = {
        contractId: chain.contractId,
        treasury,
        paused: config?.paused ?? null,
      };
      if (config?.paused) warnings.push("Native reward contract is paused.");
    } catch (error) {
      report.treasury.native = {
        contractId: chain.contractId,
        error: String(error.message || error).slice(0, 300),
      };
      warnings.push("Native treasury could not be read.");
    }
  }
  report.status = warnings.length ? "attention" : "ok";
  return report;
}

