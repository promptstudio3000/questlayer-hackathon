import {
  booleanPointInPolygon,
  booleanValid,
  feature,
  point as geoPoint,
} from "@turf/turf";
import { assert, hash } from "../domain.mjs";
import { atomic } from "../database.mjs";
import {
  registerModuleSchema,
  ensureModuleVersion,
} from "../schema-compatibility.mjs";

export const PLACE_SAFETY_SCHEMA = registerModuleSchema({
  name: "system-place-safety",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS system_place_closures(city_id TEXT NOT NULL,candidate_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('open','closed')),version INTEGER NOT NULL CHECK(version>0),reason TEXT NOT NULL,geometry TEXT NOT NULL,source_hash TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(city_id,candidate_id));
CREATE TABLE IF NOT EXISTS system_place_operations(actor TEXT NOT NULL,operation_id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(actor,operation_id));
`,
});
const key = (s) => typeof s === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(s);
const present = (db) =>
  !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='system_place_closures'",
    )
    .get();
const origins = new WeakMap();
/** The registry pack a derived (effective or per-day) pack was built from. */
export function baseCityPack(city) {
  return origins.get(city) || city;
}
/** Record that a derived pack came from base, so later derivations start clean. */
export function rememberCityOrigin(derived, base) {
  origins.set(derived, baseCityPack(base));
  return derived;
}
export function closedPlaces(db, cityId) {
  if (!present(db) || !cityId) return [];
  return db
    .prepare(
      "SELECT candidate_id,geometry,version FROM system_place_closures WHERE city_id=? AND state='closed' ORDER BY candidate_id",
    )
    .all(cityId)
    .map((r) => ({
      id: r.candidate_id,
      geometry: JSON.parse(r.geometry),
      version: r.version,
    }));
}
export function pointClosed(places, p) {
  return places.some((place) =>
    booleanPointInPolygon(geoPoint([p.lng, p.lat]), feature(place.geometry)),
  );
}
export function effectiveCityPack(db, city) {
  city = origins.get(city) || city;
  const closed = closedPlaces(db, city.id);
  if (!closed.length) return city;
  const ids = new Set(closed.map((p) => p.id));
  const effective = {
    ...city,
    candidates: city.candidates.filter((c) => !ids.has(c.id)),
    exclusions: [
      ...(city.exclusions || []),
      ...closed.map((p) => ({ id: `operator:${p.id}`, geometry: p.geometry })),
    ],
    systemPlacePolicy: {
      version: 1,
      closed: closed.map(({ id, version }) => ({ id, version })),
    },
  };
  origins.set(effective, city);
  return effective;
}
export function placeClosed(places, sourceId, p) {
  return (
    places.some((c) => c.id === sourceId) || (!!p && pointClosed(places, p))
  );
}
export function assertPlaceOpen(places, sourceId, p) {
  assert(
    !placeClosed(places, sourceId, p),
    "This place is temporarily closed. Choose another discovery.",
    409,
    "PLACE_CLOSED",
  );
}
export function assertNativePlaceOpen(db, manifest, index, p) {
  const closed = closedPlaces(db, manifest.cityId);
  if (!closed.length) return;
  const row = db
    .prepare(
      "SELECT body,body_hash FROM world_blueprints WHERE city_id=? AND day=? AND source_hash=?",
    )
    .get(manifest.cityId, manifest.day, manifest.sourceHash);
  assert(
    row && hash(row.body) === row.body_hash,
    "The published location needs verification before another visit.",
    503,
    "PLACE_UNVERIFIED",
  );
  const plan = JSON.parse(row.body);
  if (index !== null) assertPlaceOpen(closed, plan.zones[index]?.sourceId, p);
  else {
    assertPlaceOpen(closed, null, p);
    for (const z of plan.zones)
      if (
        closed.some((c) => c.id === z.sourceId) &&
        booleanPointInPolygon(geoPoint([p.lng, p.lat]), feature(z.geometry))
      )
        assertPlaceOpen(closed, z.sourceId);
  }
}
export function placeSafetyAudit(db, { limit = 50 } = {}) {
  assert(
    Number.isSafeInteger(limit) && limit > 0 && limit <= 100,
    "Use an audit limit between 1 and 100.",
  );
  if (!present(db)) return { places: [], operations: [] };
  return {
    places: db
      .prepare(
        "SELECT city_id AS cityId,candidate_id AS candidateId,state,version,reason,updated_at AS updatedAt FROM system_place_closures ORDER BY updated_at DESC,city_id,candidate_id LIMIT ?",
      )
      .all(limit),
    operations: db
      .prepare(
        "SELECT actor,operation_id AS operationId,receipt FROM system_place_operations ORDER BY created_at DESC,rowid DESC LIMIT ?",
      )
      .all(limit)
      .map((r) => ({ ...r, receipt: JSON.parse(r.receipt) })),
  };
}
// No HTTP mutation route. A separately trusted local operator supplies authority.
export function changeSystemPlace(
  db,
  city,
  input,
  { isOperator = () => false, clock = Date.now } = {},
) {
  city = origins.get(city) || city;
  assert(
    isOperator(input?.actor) === true,
    "System place operations require trusted operator authority.",
    403,
  );
  const fields = [
    "actor",
    "operationId",
    "candidateId",
    "action",
    "reason",
    "expectedVersion",
  ];
  assert(
    input &&
      Object.keys(input).length === fields.length &&
      Object.keys(input).every((k) => fields.includes(k)),
    "Supply exact place-operation fields.",
  );
  assert(
    key(input.actor) &&
      key(input.operationId) &&
      key(input.candidateId) &&
      ["close", "reopen"].includes(input.action) &&
      Number.isSafeInteger(input.expectedVersion) &&
      input.expectedVersion >= 0,
    "Invalid place operation.",
  );
  assert(
    typeof input.reason === "string" &&
      input.reason.trim().length >= 3 &&
      input.reason.length <= 300 &&
      !/[\x00-\x1f]/.test(input.reason),
    "Supply a short operator reason.",
  );
  const candidate = city.candidates.find((c) => c.id === input.candidateId);
  ensureModuleVersion(db, PLACE_SAFETY_SCHEMA);
  const digest = hash(
    JSON.stringify([city.id, ...fields.map((k) => input[k])]),
  );
  return atomic(db, () => {
    const previous = db
      .prepare(
        "SELECT digest,receipt FROM system_place_operations WHERE actor=? AND operation_id=?",
      )
      .get(input.actor, input.operationId);
    if (previous) {
      assert(
        previous.digest === digest,
        "This operation id already has different terms.",
        409,
      );
      return JSON.parse(previous.receipt);
    }
    const row = db
      .prepare(
        "SELECT * FROM system_place_closures WHERE city_id=? AND candidate_id=?",
      )
      .get(city.id, input.candidateId);
    const geometry =
      candidate?.geometry ||
      (input.action === "reopen" && row ? JSON.parse(row.geometry) : null);
    assert(
      geometry?.type === "Polygon" && booleanValid(feature(geometry)),
      "Select a known candidate with valid geometry.",
      404,
    );
    assert(
      (row?.version || 0) === input.expectedVersion,
      "The place changed. Review its current version first.",
      409,
      "STALE_PLACE_VERSION",
    );
    assert(
      input.action !== "reopen" || row?.state === "closed",
      "Only a closed place can be reopened.",
      409,
    );
    const at = clock(),
      version = (row?.version || 0) + 1,
      state = input.action === "close" ? "closed" : "open";
    db.prepare(
      "INSERT INTO system_place_closures VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(city_id,candidate_id) DO UPDATE SET state=excluded.state,version=excluded.version,reason=excluded.reason,geometry=excluded.geometry,source_hash=excluded.source_hash,updated_at=excluded.updated_at",
    ).run(
      city.id,
      input.candidateId,
      state,
      version,
      input.reason.trim(),
      JSON.stringify(geometry),
      hash(JSON.stringify(city)),
      at,
    );
    const receipt = {
      cityId: city.id,
      candidateId: input.candidateId,
      state,
      version,
      reason: input.reason.trim(),
      at,
    };
    db.prepare("INSERT INTO system_place_operations VALUES(?,?,?,?,?)").run(
      input.actor,
      input.operationId,
      digest,
      JSON.stringify(receipt),
      at,
    );
    return receipt;
  });
}
