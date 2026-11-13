// POI safety filter v1 (docs/WORLDS-PLAN.md C.2.3, docs/POI-SAFETY.md).
// Hard exclusions by tag and by surrounding area, path snapping of the
// check-in target to a mapped public path within 40 m, a `review` state, and
// operator closures from `system-place-safety` that survive a re-import.
// Pure and deterministic apart from the closure helpers that touch the DB.

import { changeSystemPlace } from "../spatial/place-safety.mjs";
import { poiCategory } from "./taxonomy.mjs";
import {
  Grid,
  bboxOf,
  containsPoint,
  distanceM,
  distanceToArea,
  metresPerDegree,
  nearestOnSegment,
  padBbox,
  round7,
} from "./geo.mjs";

export const POI_SAFETY_VERSION = "poi-safety-v2";
export const MAX_SNAP_M = 40;
export const CHILD_BUFFER_M = 25;
export const MIN_OVERTURE_CONFIDENCE = 0.5;
/** city_id used in system_place_closures for POIs outside reviewed cities. */
export const POI_CLOSURE_SCOPE = "poi";

/** Every reason code a POI can carry. Codes are stable; add, never rename. */
export const SAFETY_REASONS = {
  school: "School or college grounds (children).",
  kindergarten: "Kindergarten or childcare (children).",
  playground: "Playground (children).",
  hospital: "Hospital or clinic.",
  "care-home": "Care home or social facility.",
  prison: "Prison.",
  military: "Military land.",
  "worship-exterior": "Place of worship: exterior landmark only, needs review.",
  cemetery: "Cemetery: needs review.",
  "sensitive-memorial":
    "Personal memorial such as a Stolperstein: needs review.",
  "private-access": "Private or customers-only access.",
  railway: "Railway land.",
  motorway: "Motorway or trunk road.",
  quarry: "Quarry.",
  construction: "Construction site.",
  embassy: "Embassy or diplomatic site.",
  police: "Police station.",
  bar: "Bar, pub or nightclub as a quest target.",
  "adult-venue": "Adult or gambling venue.",
  disused: "Disused or abandoned feature.",
  aerodrome: "Airport or airfield.",
  "category-review": "Category needs review before use (e.g. skate park).",
  unnamed: "Unnamed feature of a kind that needs a name to be found.",
  uncategorised: "Not a game place category.",
  "low-confidence": "Overture confidence below the import threshold.",
  "no-public-path": "No mapped public path within 40 m.",
  "water-no-path": "Water body or bank without a mapped path within 40 m.",
  "target-excluded": "Every nearby path point lies in excluded grounds.",
  "operator-closure": "Closed by an operator (system-place-safety).",
};
const INSIDE = (code) => `inside-${code}`;
for (const code of [
  "school",
  "kindergarten",
  "playground",
  "hospital",
  "care-home",
  "prison",
  "military",
  "worship-exterior",
  "cemetery",
  "private-access",
  "railway",
  "quarry",
  "construction",
  "embassy",
  "police",
  "aerodrome",
])
  SAFETY_REASONS[INSIDE(code)] = `Inside ${code} grounds.`;
Object.freeze(SAFETY_REASONS);

const any =
  (...values) =>
  (v) =>
    values.includes(v);
const set = (v) => v !== undefined && v !== "" && v !== "no";
const WORSHIP_BUILDINGS = any(
  "church",
  "chapel",
  "cathedral",
  "mosque",
  "synagogue",
  "temple",
  "shrine",
  "basilica",
);
const PRIVATE = any(
  "no",
  "private",
  "customers",
  "permit",
  "delivery",
  "staff",
  "employees",
  "members",
  "residents",
  "students",
  "military",
  "official",
  "restricted",
);

// Names that say a place is closed to the public even when the mapper left
// out an access tag, e.g. "Pusat Sumber (Untuk Kakitangan Sahaja)" (Malay:
// staff only). Phrases only: a bare "Private" or "Staff" is usually a shop or
// company name. Matched case-insensitively against name and every name:*.
const WHO = String.raw`(?:staff|employees?|personnel|members?|residents?|students?|officials?|authori[sz]ed(?: personnel| persons?| staff)?)`;
const RESTRICTED_NAME = [
  new RegExp(String.raw`\b${WHO} only\b`, "iu"),
  new RegExp(String.raw`\b(?:for|reserved for) ${WHO}(?: use)? only\b`, "iu"),
  /\b(?:no public access|not open to the public|closed to the public|private (?:property|residence|area|road|grounds))\b/iu,
  /\bstaff (?:quarters|housing|residen(?:ce|ces|ts)|house|entrance|car ?park|parking)\b/iu,
  /\b(?:untuk|khas untuk) (?:kakitangan|pekerja|ahli|penghuni|pelajar)\b|\b(?:kakitangan|pekerja|ahli|penghuni) sahaja\b/iu,
  /\bkhusus (?:karyawan|pegawai|staf|anggota|penghuni)\b/iu,
  /\bnur f(?:ü|ue)r (?:personal|mitarbeiter|mitglieder|bewohner|anlieger|befugte)\b/iu,
  /\br(?:é|e)serv(?:é|e)e? (?:au personnel|aux membres|aux r(?:é|e)sidents|aux employ(?:é|e)s)\b/iu,
  /\bs(?:ó|o)lo (?:personal|empleados|socios|residentes|miembros)\b/iu,
  /\b(?:apenas|somente|s(?:ó|o)) (?:funcion(?:á|a)rios|s(?:ó|o)cios|moradores)\b/iu,
  /\balleen (?:personeel|leden|bewoners)\b/iu,
  /関係者以外|関係者専用|職員専用|社員専用|員工專用|员工专用|职工专用|職工專用|직원 ?전용|관계자 ?외|เฉพาะเจ้าหน้าที่/u,
];

/** Whether a name says the place is for staff, members or residents only. */
export function restrictedName(name) {
  if (typeof name !== "string" || !name) return false;
  return RESTRICTED_NAME.some((re) => re.test(name));
}
const namesOf = (tags) =>
  Object.entries(tags)
    .filter(([k]) => k === "name" || k.startsWith("name:") || k === "official_name" || k === "alt_name")
    .map(([, v]) => v);

/**
 * Tag rules. `level` is excluded or review. `area: true` means a polygon with
 * these tags is grounds that a check-in target must stay out of.
 * `child: true` grounds also get a CHILD_BUFFER_M margin.
 */
export const TAG_RULES = Object.freeze([
  {
    code: "school",
    level: "excluded",
    area: true,
    child: true,
    when: { amenity: any("school", "college") },
  },
  {
    code: "kindergarten",
    level: "excluded",
    area: true,
    child: true,
    when: { amenity: any("kindergarten", "childcare") },
  },
  {
    code: "playground",
    level: "excluded",
    area: true,
    child: true,
    when: { leisure: any("playground") },
  },
  {
    code: "hospital",
    level: "excluded",
    area: true,
    when: { amenity: any("hospital", "clinic") },
  },
  {
    code: "hospital",
    level: "excluded",
    area: true,
    when: { healthcare: any("hospital", "clinic") },
  },
  {
    code: "care-home",
    level: "excluded",
    area: true,
    when: { amenity: any("nursing_home", "social_facility") },
  },
  {
    code: "care-home",
    level: "excluded",
    area: true,
    when: { social_facility: set },
  },
  {
    code: "prison",
    level: "excluded",
    area: true,
    when: { amenity: any("prison") },
  },
  {
    code: "military",
    level: "excluded",
    area: true,
    when: { landuse: any("military") },
  },
  { code: "military", level: "excluded", area: true, when: { military: set } },
  {
    code: "worship-exterior",
    level: "review",
    area: true,
    when: { amenity: any("place_of_worship") },
  },
  {
    code: "worship-exterior",
    level: "review",
    area: false,
    when: { building: WORSHIP_BUILDINGS },
  },
  {
    code: "cemetery",
    level: "review",
    area: true,
    when: { landuse: any("cemetery") },
  },
  {
    code: "cemetery",
    level: "review",
    area: true,
    when: { amenity: any("grave_yard") },
  },
  {
    code: "sensitive-memorial",
    level: "review",
    when: {
      memorial: any("stolperstein", "stolpersteine", "grave", "ghost_bike"),
    },
  },
  {
    code: "private-access",
    level: "excluded",
    area: true,
    when: {
      access: PRIVATE,
      foot: (v) => !any("yes", "designated", "permissive")(v),
    },
  },
  {
    code: "private-access",
    level: "excluded",
    area: true,
    when: { foot: any("no", "private") },
  },
  {
    code: "railway",
    level: "excluded",
    area: true,
    when: { landuse: any("railway") },
  },
  {
    code: "railway",
    level: "excluded",
    area: false,
    when: {
      railway: (v) => set(v) && !any("abandoned", "disused", "razed")(v),
    },
  },
  {
    code: "motorway",
    level: "excluded",
    when: { highway: any("motorway", "trunk", "motorway_link", "trunk_link") },
  },
  {
    code: "quarry",
    level: "excluded",
    area: true,
    when: { landuse: any("quarry") },
  },
  {
    code: "construction",
    level: "excluded",
    area: true,
    when: { landuse: any("construction") },
  },
  {
    code: "construction",
    level: "excluded",
    area: true,
    when: { construction: set },
  },
  {
    code: "construction",
    level: "excluded",
    area: true,
    when: { building: any("construction") },
  },
  {
    code: "construction",
    level: "excluded",
    when: { highway: any("construction") },
  },
  {
    code: "embassy",
    level: "excluded",
    area: true,
    when: { amenity: any("embassy") },
  },
  {
    code: "embassy",
    level: "excluded",
    area: true,
    when: { office: any("diplomatic") },
  },
  { code: "embassy", level: "excluded", area: true, when: { diplomatic: set } },
  {
    code: "police",
    level: "excluded",
    area: true,
    when: { amenity: any("police") },
  },
  {
    code: "aerodrome",
    level: "excluded",
    area: true,
    when: { aeroway: any("aerodrome", "airstrip", "heliport") },
  },
  {
    code: "bar",
    level: "excluded",
    when: { amenity: any("bar", "pub", "nightclub", "biergarten") },
  },
  {
    code: "adult-venue",
    level: "excluded",
    when: {
      amenity: any("stripclub", "casino", "gambling", "brothel", "swingerclub"),
    },
  },
  {
    code: "adult-venue",
    level: "excluded",
    when: { shop: any("erotic", "adult") },
  },
  { code: "disused", level: "excluded", when: { disused: any("yes") } },
  { code: "disused", level: "excluded", when: { abandoned: any("yes") } },
]);

/** Overture categories that trigger a safety reason. */
export const OVERTURE_SAFETY_MAP = Object.freeze({
  school: "school",
  elementary_school: "school",
  middle_school: "school",
  high_school: "school",
  college_university: "school",
  preschool: "kindergarten",
  kindergarten: "kindergarten",
  day_care_preschool: "kindergarten",
  child_care_and_day_care: "kindergarten",
  playground: "playground",
  hospital: "hospital",
  emergency_room: "hospital",
  medical_center: "hospital",
  nursing_home: "care-home",
  retirement_home: "care-home",
  assisted_living_facility: "care-home",
  prison: "prison",
  jail_and_prison: "prison",
  correctional_facility: "prison",
  military: "military",
  military_base: "military",
  church: "worship-exterior",
  church_cathedral: "worship-exterior",
  religious_organization: "worship-exterior",
  place_of_worship: "worship-exterior",
  mosque: "worship-exterior",
  synagogue: "worship-exterior",
  temple: "worship-exterior",
  buddhist_temple: "worship-exterior",
  hindu_temple: "worship-exterior",
  cemetery: "cemetery",
  bar: "bar",
  pub: "bar",
  cocktail_bar: "bar",
  beer_bar: "bar",
  wine_bar: "bar",
  sports_bar: "bar",
  lounge: "bar",
  night_club: "bar",
  beer_garden: "bar",
  adult_entertainment: "adult-venue",
  strip_club: "adult-venue",
  casino: "adult-venue",
  embassy: "embassy",
  police_department: "police",
  police_station: "police",
  quarry: "quarry",
  railway_station: "railway",
  train_station: "railway",
});
const REVIEW_CODES = new Set(
  TAG_RULES.filter((r) => r.level === "review").map((r) => r.code),
);
const CHILD_CODES = new Set(
  TAG_RULES.filter((r) => r.child).map((r) => r.code),
);

function matches(when, tags) {
  for (const [k, test] of Object.entries(when))
    if (typeof test === "function" ? !test(tags[k]) : tags[k] !== test)
      return false;
  return true;
}
const uniq = (list) => [...new Set(list)];

/** Safety reason codes from a feature's own OSM tags, in rule order. */
export function tagReasons(tags = {}) {
  const codes = TAG_RULES.filter((r) => matches(r.when, tags)).map(
    (r) => r.code,
  );
  if (
    Object.keys(tags).some(
      (k) => k.startsWith("disused:") || k.startsWith("abandoned:"),
    )
  )
    codes.push("disused");
  if (namesOf(tags).some(restrictedName)) codes.push("private-access");
  return uniq(codes);
}

/** The grounds code for an OSM polygon, or null when it is not grounds. */
export function areaRule(tags = {}) {
  for (const r of TAG_RULES)
    if (r.area && matches(r.when, tags))
      return { code: r.code, level: r.level, child: !!r.child };
  return null;
}

export function overtureReasons(categories = {}) {
  return uniq(
    [categories.primary, ...(categories.alternate || [])]
      .map((c) => OVERTURE_SAFETY_MAP[c])
      .filter(Boolean),
  );
}

export const levelOf = (code) =>
  code === "category-review" ||
  REVIEW_CODES.has(code) ||
  REVIEW_CODES.has(code.replace(/^inside-/, ""))
    ? "review"
    : "excluded";

/**
 * ok | excluded from a list of reason codes. Since poi-safety-v2 nobody reviews
 * places by hand: a review-level reason (cemetery, church exterior, memorial,
 * skate park...) excludes the place just like a hard reason. `levelOf` still
 * tells the two kinds apart for reports. The `review` state stays valid in the
 * file schema so older releases still load.
 */
export function safetyOf(reasons) {
  return reasons.length ? "excluded" : "ok";
}

const ROAD_WITH_SIDEWALK = any("primary", "secondary", "tertiary");
const FOOT_HIGHWAYS = any(
  "footway",
  "path",
  "pedestrian",
  "living_street",
  "residential",
  "cycleway",
  "steps",
  "bridleway",
  "track",
  "unclassified",
);
const FOOT_ALLOWED = any("yes", "designated", "permissive");

/**
 * Whether an OSM way is a mapped public path a player may stand on. Roads
 * need a mapped sidewalk; motorways, trunks, tunnels and private ways never
 * qualify.
 */
export function isPublicPath(tags = {}) {
  const h = tags.highway;
  if (!h) return false;
  if (any("no", "private")(tags.foot)) return false;
  if (PRIVATE(tags.access) && !FOOT_ALLOWED(tags.foot)) return false;
  if (tags.tunnel && tags.tunnel !== "no") return false;
  if (tags.indoor === "yes") return false;
  if (any("motorway", "trunk", "motorway_link", "trunk_link")(h)) return false;
  if (h === "cycleway" && tags.foot === "no") return false;
  if (FOOT_HIGHWAYS(h)) return true;
  if (h === "service") return FOOT_ALLOWED(tags.foot) || set(tags.sidewalk);
  if (ROAD_WITH_SIDEWALK(h))
    return (
      any("both", "left", "right", "yes")(tags.sidewalk) ||
      FOOT_ALLOWED(tags.foot)
    );
  return false;
}

/**
 * Spatial context for one bounded region (an H3 res-5 tile on the Mac).
 * paths: [{id, coordinates: [[lng,lat],...]}] already filtered to public paths.
 * areas: [{id, code, level, child, geometry}] grounds from areaRule().
 */
export function createSafetyContext({
  paths = [],
  areas = [],
  maxSnapM = MAX_SNAP_M,
  childBufferM = CHILD_BUFFER_M,
} = {}) {
  const segments = new Grid();
  for (const p of [...paths].sort((a, b) => cmp(a.id, b.id)))
    for (let i = 1; i < p.coordinates.length; i++) {
      const a = p.coordinates[i - 1],
        b = p.coordinates[i];
      segments.insert(
        [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ],
        { pathId: p.id, a, b },
      );
    }
  const grounds = new Grid();
  const areaList = [...areas]
    .sort((a, b) => cmp(a.id, b.id))
    .map((a) => ({ ...a, bbox: bboxOf(a.geometry) }));
  for (const a of areaList)
    grounds.insert(a.child ? padBbox(a.bbox, childBufferM) : a.bbox, a);
  return { segments, grounds, maxSnapM, childBufferM };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Grounds containing p (child grounds include their buffer). */
export function groundsAt(ctx, p, { buffer = true } = {}) {
  return ctx.grounds
    .query([p[0], p[1], p[0], p[1]])
    .filter((a) =>
      a.child && buffer
        ? distanceToArea(a.geometry, p) <= ctx.childBufferM
        : containsPoint(a.geometry, p),
    );
}

function sample(list, max) {
  if (list.length <= max) return list;
  const step = list.length / max;
  return Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
}

/** Anchor points, label point and polygon (if any) of a POI geometry. */
export function shapeOf(geometry) {
  const t = geometry?.type;
  if (t === "Point")
    return { label: geometry.coordinates, anchors: [geometry.coordinates] };
  if (t === "LineString") {
    const c = geometry.coordinates;
    return { label: c[Math.floor(c.length / 2)], anchors: sample(c, 32) };
  }
  if (t === "Polygon" || t === "MultiPolygon") {
    const outer =
      t === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0][0];
    const ring = outer.slice(0, -1);
    const label = [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
    return { label, anchors: [label, ...sample(ring, 32)], area: geometry };
  }
  throw Error("POI geometry must be a Point, LineString or (Multi)Polygon.");
}

/**
 * Snap a POI to the best public path point within ctx.maxSnapM that is not
 * inside excluded grounds. Polygon POIs prefer path points inside the polygon.
 * Returns { target, reasons } where target is null when nothing qualifies.
 */
export function snapTarget(ctx, geometry) {
  const { label, anchors, area } = shapeOf(geometry);
  const box = padBbox(
    bboxOf({ type: "MultiPoint", coordinates: anchors }),
    ctx.maxSnapM,
  );
  const options = [];
  const consider = (point, distance, pathId) => {
    if (distance <= ctx.maxSnapM)
      options.push({
        point,
        distance,
        pathId,
        labelM: distanceM(label, point),
      });
  };
  for (const s of ctx.segments.query(box)) {
    if (area) {
      if (containsPoint(area, s.a)) consider(s.a, 0, s.pathId);
      if (containsPoint(area, s.b)) consider(s.b, 0, s.pathId);
    }
    for (const anchor of anchors) {
      const n = nearestOnSegment(anchor, s.a, s.b);
      consider(
        n.point,
        area && containsPoint(area, n.point) ? 0 : n.distanceM,
        s.pathId,
      );
    }
  }
  options.sort(
    (x, y) =>
      x.distance - y.distance ||
      x.labelM - y.labelM ||
      cmp(x.pathId, y.pathId) ||
      x.point[0] - y.point[0] ||
      x.point[1] - y.point[1],
  );
  if (!options.length) return { target: null, reasons: ["no-public-path"] };
  let reviewed = null;
  for (const o of options) {
    const at = groundsAt(ctx, o.point);
    if (at.some((a) => a.level === "excluded")) continue;
    const target = {
      lng: round7(o.point)[0],
      lat: round7(o.point)[1],
      pathId: o.pathId,
      distanceM: Math.round(o.distance * 10) / 10,
    };
    const reviewCodes = uniq(at.map((a) => INSIDE(a.code)));
    if (!reviewCodes.length) return { target, reasons: [] };
    reviewed ||= { target, reasons: reviewCodes };
  }
  return reviewed || { target: null, reasons: ["target-excluded"] };
}

/** Grounds that enclose the POI itself (a node inside, or a polygon fully inside). */
export function enclosingGrounds(ctx, poi) {
  const { label, anchors, area } = shapeOf(poi.geometry);
  const probe = area ? anchors.slice(1, 17) : [label];
  const box = bboxOf({ type: "MultiPoint", coordinates: probe });
  return ctx.grounds
    .query(box)
    .filter(
      (a) =>
        a.id !== poi.id && probe.every((p) => containsPoint(a.geometry, p)),
    );
}

/**
 * Evaluate one normalised POI against a context. Returns reasons (sorted
 * as: own tags, grounds, path), safety and the check-in target.
 */
export function evaluatePoi(ctx, poi) {
  const reasons = [...(poi.reasons || [])];
  if (restrictedName(poi.name)) reasons.push("private-access");
  for (const a of enclosingGrounds(ctx, poi)) reasons.push(INSIDE(a.code));
  const snap = snapTarget(ctx, poi.geometry);
  if (!snap.target) {
    const water = poi.category === "river_walk" || poi.category === "lake_walk";
    reasons.push(
      ...snap.reasons.map((r) =>
        r === "no-public-path" && water ? "water-no-path" : r,
      ),
    );
  } else reasons.push(...snap.reasons);
  const list = uniq(reasons);
  return { reasons: list, safety: safetyOf(list), target: snap.target };
}

// ---------------------------------------------------------------------------
// Operator closures (system-place-safety). Closures are keyed by POI id and
// carry a polygon, so they still match after a re-import that changes tags,
// names or nudges the target point.

const closureTablePresent = (db) =>
  !!db
    ?.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='system_place_closures'",
    )
    .get();

/** Every closed place in every scope; closures are geometric so they apply anywhere. */
export function loadPoiClosures(db) {
  if (!closureTablePresent(db)) return [];
  return db
    .prepare(
      "SELECT city_id,candidate_id,geometry,version FROM system_place_closures WHERE state='closed' ORDER BY city_id,candidate_id",
    )
    .all()
    .map((r) => ({
      scope: r.city_id,
      id: r.candidate_id,
      geometry: JSON.parse(r.geometry),
      version: r.version,
    }));
}

/** The closure that applies to a POI record, or null. */
export function closureFor(closures, record) {
  const points = [
    record.target && [record.target.lng, record.target.lat],
    [record.lng, record.lat],
  ].filter(Boolean);
  return (
    closures.find((c) => c.id === record.id) ||
    closures.find((c) => points.some((p) => containsPoint(c.geometry, p))) ||
    null
  );
}

/** Apply operator closures to classified records (returns new records). */
export function applyClosures(records, closures = []) {
  if (!closures.length) return records;
  return records.map((r) => {
    const c = closureFor(closures, r);
    if (!c) return r;
    const reasons = uniq([...r.reasons, "operator-closure"]);
    return {
      ...r,
      reasons,
      safety: "excluded",
      closure: { scope: c.scope, id: c.id, version: c.version },
    };
  });
}

/** A small square (default 30 m across) around a point, as a GeoJSON Polygon. */
export function squareAround({ lat, lng }, sizeM = 30) {
  const m = metresPerDegree(lat),
    dx = sizeM / 2 / m.lng,
    dy = sizeM / 2 / m.lat;
  const ring = [
    [lng - dx, lat - dy],
    [lng + dx, lat - dy],
    [lng + dx, lat + dy],
    [lng - dx, lat + dy],
    [lng - dx, lat - dy],
  ].map(round7);
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Close or reopen a POI outside reviewed cities through the same operator
 * flow as city places (trusted local operator only, versioned, idempotent).
 * input: { actor, operationId, candidateId: record.id, action, reason, expectedVersion }
 */
export function changePoiPlace(db, record, input, options) {
  const at = record.target || { lat: record.lat, lng: record.lng };
  const scope = {
    id: POI_CLOSURE_SCOPE,
    candidates: [{ id: record.id, geometry: squareAround(at) }],
  };
  return changeSystemPlace(db, scope, input, options);
}

// ---------------------------------------------------------------------------
// Adapter used by the POI import (W3, scripts/poi/), which does its own path
// and grounds lookup in SQLite and passes the results in.

export const SAFETY_VERSION = POI_SAFETY_VERSION;
const EXCLUSION_KINDS = { care_home: "care-home" };

/**
 * poi: { id, category, name, tags } (tags {} for Overture)
 * nearestPath: { lat, lng, distanceM, wayId } | null, already within 40 m
 * exclusion: { kind, id } | null when that path point lies in forbidden grounds
 * closures: Set of closed POI ids (loadPoiClosures(db).map(c => c.id))
 * Returns { safety, reason, reasons, target }. reason is the first blocking
 * code (or the first review code), null when ok.
 */
export function assessPoi(
  poi,
  { nearestPath = null, exclusion = null, closures = new Set() } = {},
) {
  const reasons = [...tagReasons(poi.tags || {})];
  if (restrictedName(poi.name)) reasons.push("private-access");
  const meta = poi.category ? poiCategory(poi.category) : null;
  if (!meta) reasons.push("uncategorised");
  else {
    if (meta.requiresName && !poi.name) reasons.push("unnamed");
    if (meta.review) reasons.push("category-review");
  }
  if (exclusion) {
    const code = EXCLUSION_KINDS[exclusion.kind] || exclusion.kind;
    reasons.push(
      SAFETY_REASONS[INSIDE(code)] ? INSIDE(code) : "target-excluded",
    );
  }
  const water = poi.category === "river_walk" || poi.category === "lake_walk";
  const tooFar =
    !nearestPath ||
    !Number.isFinite(nearestPath.distanceM) ||
    nearestPath.distanceM > MAX_SNAP_M;
  if (tooFar) reasons.push(water ? "water-no-path" : "no-public-path");
  if (closures?.has?.(poi.id)) reasons.push("operator-closure");
  const list = uniq(reasons);
  const safety = safetyOf(list);
  const reason = list.find((r) => levelOf(r) === "excluded") || list[0] || null;
  return {
    safety,
    reason,
    reasons: list,
    target:
      tooFar || safety === "excluded"
        ? null
        : { lat: nearestPath.lat, lng: nearestPath.lng },
  };
}
