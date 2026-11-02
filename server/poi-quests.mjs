// POI quests in every H3 street cell (docs/WORLDS-PLAN.md C.3 points 1-6, task
// W6). A street world (`demo:<h3r7>:<day>:v2`, never a city world or the
// arena) gets up to six quests per local day from the checked POI file that
// the W3 worker builds on the VPS. Nothing here calls a model or a map API:
// the file is read locally, read-only, and only when the first player loads
// the cell that day (lazy materialisation, once per world).
//
// Determinism: the choice depends only on (layerId, cell, local date, policy)
// and on the POI ids used in the same cell during the three previous local
// days (72 h rotation). A player's position, wallet, login time or request
// order never changes it.
//
// Rewards: XP only, plus one cosmetic chest per cell and day that mints an
// Aura only while edition supply lasts (the ordinary chest path). Street coins
// are unchanged. No GOLD, no NEAR: gold_u is always 0 here.
import { DatabaseSync } from "node:sqlite";
import { existsSync, realpathSync, statSync } from "node:fs";
import { cellToParent, isValidCell, getResolution } from "h3-js";
import { assert, distance, hash } from "./domain.mjs";
import { atomic } from "./database.mjs";
import { localDateBounds, shiftDate } from "./spatial/calendar.mjs";
import { poiQuestActivity } from "./quest-templates.mjs";
import { DEFAULT_LAYER } from "./worlds/registry.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "./schema-compatibility.mjs";

export const POI_QUEST_POLICY = "poi-quests-v1";
export const DEFAULT_POI_DB = "/var/lib/questlayer-poi/current.sqlite";
export const MAX_POI_QUESTS_PER_CELL = 6;
export const MAX_POI_HUNTS_PER_CELL = 2; // the plan allows up to 3 trails
export const MAX_POI_CHESTS_PER_CELL = 1;
export const MIN_POI_GAP_M = 250;
export const POI_ROTATION_DAYS = 3; // 72 h
export const HUNT_STOPS = 3;
export const POI_TARGET_RADIUS_M = 40;
export const POI_XP = Object.freeze({ visit: 40, hunt: 90, chest: 60 });
const MAX_CELL_POIS = 2000;
const REOPEN_CHECK_MS = 60_000;

// Category hunts only for kinds a player can recognise on the street.
const HUNT_EXCLUDED = new Set(["other_named", "information_board", "bench_with_view"]);

const LABELS = {
  park: ["park", "parks"],
  garden: ["garden", "gardens"],
  plaza: ["square", "squares"],
  viewpoint: ["viewpoint", "viewpoints"],
  fountain: ["fountain", "fountains"],
  monument: ["monument", "monuments"],
  memorial: ["memorial", "memorials"],
  artwork: ["artwork", "artworks"],
  street_art: ["mural", "murals"],
  castle: ["castle", "castles"],
  ruins: ["ruin", "ruins"],
  historic_building: ["historic building", "historic buildings"],
  museum: ["museum", "museums"],
  library: ["library", "libraries"],
  market: ["market", "markets"],
  bridge: ["bridge", "bridges"],
  river_walk: ["riverside walk", "riverside walks"],
  lake_walk: ["lakeside walk", "lakeside walks"],
  trailhead: ["trailhead", "trailheads"],
  nature_reserve: ["nature reserve", "nature reserves"],
  observatory: ["observatory", "observatories"],
  landmark_tower: ["tower", "towers"],
  sculpture: ["sculpture", "sculptures"],
  picnic_site: ["picnic spot", "picnic spots"],
  information_board: ["information board", "information boards"],
  music_venue: ["music venue", "music venues"],
  sports_ground: ["sports ground", "sports grounds"],
  skate_park: ["skate park", "skate parks"],
  bench_with_view: ["bench with a view", "benches with a view"],
  other_named: ["place", "places"],
};
const label = (category, plural = false) =>
  (LABELS[category] || ["place", "places"])[plural ? 1 : 0];

export const POI_HUNT_SCHEMA = registerModuleSchema({
  name: "poi-quests",
  version: 1,
  sql: `CREATE TABLE IF NOT EXISTS poi_hunt_stops(quest_id TEXT NOT NULL REFERENCES quests(id),player_id TEXT NOT NULL REFERENCES players(id),stop INTEGER NOT NULL CHECK(stop>=0),fix_at INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(quest_id,player_id,stop))`,
});
const schemaReady = new WeakSet();
export function ensurePoiQuestSchema(db) {
  if (schemaReady.has(db)) return;
  ensureModuleVersion(db, POI_HUNT_SCHEMA);
  schemaReady.add(db);
}

// ---------------------------------------------------------------------------
// Read-only adapter over the W3 POI file (schema questlayer.poi/1).

function cleanName(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : null;
}

/** Rows are { id, category, name, notability, lat, lng } with lat/lng = the path target. */
export function poiRowsFromFile(db, cell) {
  const rows = db
    .prepare(
      "SELECT id,category,name,notability,path_ref FROM poi WHERE h3r5=? AND h3r7=? AND safety='ok' AND path_ref IS NOT NULL ORDER BY id LIMIT ?",
    )
    .all(cellToParent(cell, 5), cell, MAX_CELL_POIS);
  const out = [];
  for (const r of rows) {
    let target;
    try {
      target = JSON.parse(r.path_ref);
    } catch {
      continue;
    }
    if (
      !Number.isFinite(target?.lat) ||
      !Number.isFinite(target?.lng) ||
      Math.abs(target.lat) > 85 ||
      Math.abs(target.lng) > 180
    )
      continue;
    out.push({
      id: String(r.id),
      category: String(r.category),
      name: cleanName(r.name),
      notability: Math.max(0, Number(r.notability) || 0),
      lat: target.lat,
      lng: target.lng,
    });
  }
  return out;
}

/**
 * A POI source backed by the SQLite file the W3 worker publishes. The file is
 * a symlink swapped atomically on each import; the adapter reopens it when the
 * target changes (checked at most once a minute). A missing or unreadable file
 * reports `available() === false` and never throws on the request path.
 */
export function openPoiFileSource(path = process.env.POI_DB_PATH || DEFAULT_POI_DB, { clock = Date.now } = {}) {
  let db = null,
    opened = null,
    checkedAt = -Infinity,
    version = null;
  function refresh() {
    const now = clock();
    if (now - checkedAt < REOPEN_CHECK_MS && (db || checkedAt > -Infinity)) return db;
    checkedAt = now;
    let real = null;
    try {
      if (existsSync(path)) {
        real = realpathSync(path);
        real = `${real}:${statSync(real).mtimeMs}`;
      }
    } catch {
      real = null;
    }
    if (real === opened && db) return db;
    try {
      db?.close();
    } catch {}
    db = null;
    opened = null;
    version = null;
    if (!real) return null;
    try {
      const next = new DatabaseSync(path, { readOnly: true });
      const schema = next.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value;
      if (schema !== "questlayer.poi/1") {
        next.close();
        return null;
      }
      version = next.prepare("SELECT value FROM meta WHERE key='version'").get()?.value || null;
      db = next;
      opened = real;
    } catch {
      db = null;
    }
    return db;
  }
  return {
    kind: "file",
    available: () => !!refresh(),
    version: () => (refresh() ? version : null),
    cellPois(cell) {
      const handle = refresh();
      if (!handle) return null;
      try {
        return poiRowsFromFile(handle, cell);
      } catch {
        return null;
      }
    },
    close() {
      try {
        db?.close();
      } catch {}
      db = null;
    },
  };
}

/** Test/operator source over an in-memory list of POI rows. */
export function staticPoiSource(rows, { version = "static" } = {}) {
  return {
    kind: "static",
    available: () => true,
    version: () => version,
    cellPois: (cell) => rows.filter((r) => r.h3r7 === cell).map((r) => ({ ...r })),
  };
}

let defaultSource = null;
export function defaultPoiSource() {
  if (process.env.POI_QUESTS === "off") return null;
  defaultSource ||= openPoiFileSource();
  return defaultSource;
}

// ---------------------------------------------------------------------------
// Pure, deterministic plan for one cell and day.

const unit = (seed, id) => parseInt(hash(`${seed}:${id}`).slice(0, 13), 16) / 2 ** 52;

/**
 * planCellPoiQuests({ layerId, cell, day, pois, recent, policy })
 * -> { seed, quests: [{ template, category, pois: [...] , chest }] }
 *
 * - seed = hash(layerId, cell, day, policy);
 * - every target at least MIN_POI_GAP_M from every other target of the day;
 * - POIs used in this cell in the previous 72 h only when nothing else fits;
 * - notable places (Wikidata sitelinks) get a slightly higher chance;
 * - at most MAX_POI_QUESTS_PER_CELL quests, of which at most
 *   MAX_POI_HUNTS_PER_CELL category hunts and one chest.
 */
export function planCellPoiQuests({
  layerId = DEFAULT_LAYER.id,
  cell,
  day,
  pois,
  recent = new Set(),
  policy = POI_QUEST_POLICY,
}) {
  assert(isValidCell(cell) && getResolution(cell) === 7, "A POI plan needs an H3 res-7 cell.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day), "A POI plan needs a local date.");
  const seed = hash(`${layerId}:${cell}:${day}:${policy}`);
  const seen = new Set();
  const ranked = (pois || [])
    .filter((p) => p && typeof p.id === "string" && !seen.has(p.id) && seen.add(p.id))
    .map((p) => {
      // Weighted sampling key (Efraimidis-Spirakis): u^(1/w), w in [1, 1.5].
      const weight = 1 + Math.min(50, p.notability || 0) / 100;
      return { ...p, fresh: !recent.has(p.id), key: unit(seed, p.id) ** (1 / weight) };
    })
    .sort((a, b) => b.fresh - a.fresh || b.key - a.key || (a.id < b.id ? -1 : 1));
  const picked = [];
  const used = new Set();
  const spaced = (p, extra = []) =>
    [...picked, ...extra].every((q) => distance(q, p) >= MIN_POI_GAP_M);
  const quests = [];

  // Hunts first, so they get room: categories in ranked order, freshest first.
  const categories = [];
  for (const p of ranked)
    if (!HUNT_EXCLUDED.has(p.category) && !categories.includes(p.category)) categories.push(p.category);
  for (const category of categories) {
    if (quests.length >= MAX_POI_HUNTS_PER_CELL) break;
    // Keep room for at least two single visits.
    if (ranked.length - used.size < HUNT_STOPS + 2) break;
    const stops = [];
    for (const p of ranked) {
      if (p.category !== category || used.has(p.id) || !spaced(p, stops)) continue;
      stops.push(p);
      if (stops.length === HUNT_STOPS) break;
    }
    if (stops.length < HUNT_STOPS) continue;
    for (const s of stops) {
      picked.push(s);
      used.add(s.id);
    }
    quests.push({ template: "poi-category-hunt", category, pois: stops });
  }
  for (const p of ranked) {
    if (quests.length >= MAX_POI_QUESTS_PER_CELL) break;
    if (used.has(p.id) || !spaced(p)) continue;
    picked.push(p);
    used.add(p.id);
    quests.push({ template: "poi-visit", category: p.category, pois: [p] });
  }
  // The chest goes to the most notable single visit (ties: plan order).
  let chest = -1;
  quests.forEach((q, i) => {
    if (q.template !== "poi-visit") return;
    if (chest < 0 || q.pois[0].notability > quests[chest].pois[0].notability) chest = i;
  });
  if (chest >= 0 && MAX_POI_CHESTS_PER_CELL > 0) quests[chest].chest = true;
  return {
    seed,
    quests: quests.map((q) => ({
      ...q,
      pois: q.pois.map(({ fresh, key, ...p }) => p),
    })),
  };
}

// ---------------------------------------------------------------------------
// Materialisation into a street world.

function circle(p, radius = POI_TARGET_RADIUS_M, steps = 16) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((i % steps) / steps) * Math.PI * 2;
    ring.push([
      Number((p.lng + (Math.cos(a) * radius) / (111320 * Math.cos((p.lat * Math.PI) / 180))).toFixed(7)),
      Number((p.lat + (Math.sin(a) * radius) / 110540).toFixed(7)),
    ]);
  }
  return ring;
}

export function isStreetWorld(manifest) {
  return !!manifest && !manifest.cityId && !manifest.arena && typeof manifest.region === "string" && !manifest.region.startsWith("city-");
}

/** World ids of the same cell on the previous POI_ROTATION_DAYS local days. */
function recentPoiIds(db, manifest) {
  const ids = [];
  for (let d = 1; d <= POI_ROTATION_DAYS; d++)
    ids.push(`demo:${manifest.region}:${shiftDate(manifest.day, -d)}:v2`);
  const recent = new Set();
  for (const row of db
    .prepare(
      `SELECT metadata FROM quests WHERE world_id IN (${ids.map(() => "?").join(",")}) AND json_valid(metadata) AND json_extract(metadata,'$.poi') IS NOT NULL`,
    )
    .all(...ids))
    for (const id of JSON.parse(row.metadata).poi?.ids || []) recent.add(id);
  return recent;
}

/** Play hours of the default layer (08:00-20:00), clamped to the local day. */
function playWindow(day, timezone) {
  const { startsAt, endsAt } = localDateBounds(day, timezone);
  const hours = DEFAULT_LAYER.pack?.rules?.hours || DEFAULT_LAYER.pack?.hours;
  const [open, close] = Array.isArray(hours) && hours.length === 2 ? hours : ["08:00", "20:00"];
  const at = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? startsAt + (h * 60 + m) * 60000 : null;
  };
  // A DST day shifts wall-clock hours by an hour; this stays within the day.
  const opensAt = Math.max(startsAt, at(open) ?? startsAt),
    closesAt = Math.min(endsAt, at(close) ?? endsAt);
  return opensAt < closesAt ? { opensAt, closesAt } : { opensAt: startsAt, closesAt: endsAt };
}

const EMPTY_NOTICE =
  "Nothing here yet. This area has no checked public places for quests today. Street coins still follow mapped paths.";

/**
 * Attach today's POI quests to a street world, once. Two parallel calls create
 * one set: the job key and the quest rows are written in one transaction.
 * Returns the (possibly updated) manifest. Never throws for a missing POI file.
 */
export function materializePoiQuests(db, manifest, { source = defaultPoiSource(), now = Date.now(), layerId = DEFAULT_LAYER.id } = {}) {
  if (!isStreetWorld(manifest) || manifest.poiQuests || now >= manifest.endsAt) return manifest;
  if (!source || !source.available()) return manifest;
  if (db.prepare("SELECT 1 FROM daily_jobs WHERE job_key=?").get(`poi-quests:${manifest.id}`)) {
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(manifest.id);
    return row ? JSON.parse(row.manifest) : manifest;
  }
  const pois = source.cellPois(manifest.region);
  if (!Array.isArray(pois)) return manifest;
  return atomic(db, () => {
    const key = `poi-quests:${manifest.id}`;
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(manifest.id);
    if (!row) return manifest;
    const current = JSON.parse(row.manifest);
    if (current.poiQuests || db.prepare("SELECT 1 FROM daily_jobs WHERE job_key=?").get(key)) return current;
    const plan = planCellPoiQuests({
      layerId,
      cell: current.region,
      day: current.day,
      pois,
      recent: recentPoiIds(db, current),
    });
    const { opensAt, closesAt } = playWindow(current.day, current.timezone);
    const zones = [];
    plan.quests.forEach((q, i) => {
      const slot = 100 + i,
        zoneId = `${current.id}:zone:poi-${i}`,
        questId = `${current.id}:quest:poi-${i}:0`,
        first = q.pois[0],
        targets = q.pois.map((p) => ({ lat: p.lat, lng: p.lng }));
      const hunt = q.template === "poi-category-hunt";
      const name = hunt
        ? `${label(q.category, true)[0].toUpperCase()}${label(q.category, true).slice(1)} hunt`
        : first.name || `${label(q.category)[0].toUpperCase()}${label(q.category).slice(1)}`;
      const geometry = hunt
        ? { type: "MultiPolygon", coordinates: targets.map((t) => [circle(t)]) }
        : { type: "Polygon", coordinates: [circle(first)] };
      zones.push({
        id: zoneId,
        slot,
        name,
        tier: 1,
        lat: first.lat,
        lng: first.lng,
        radius: 0,
        geometry,
        targets,
        kind: "discovery",
        sector: null,
        source: "poi",
        sourceId: `poi:${q.pois.map((p) => p.id).join("+")}`,
        poi: { category: q.category, ids: q.pois.map((p) => p.id) },
        opensAt,
        closesAt,
        color: "#258b73",
      });
      const kind = q.chest ? "chest" : hunt ? "route" : "visit";
      const title = hunt
        ? `Find ${HUNT_STOPS} ${label(q.category, true)}`
        : q.chest
          ? `Chest at ${name}`
          : `Visit ${name}`;
      const objective = hunt
        ? `Visit ${HUNT_STOPS} ${label(q.category, true)} in this area today, in any order.`
        : q.chest
          ? `Reach the chest next to ${name} and open it. An Aura may remain in its edition.`
          : `Reach the marked public spot next to ${name} and confirm your visit.`;
      const activity = poiQuestActivity(
        q.chest ? "cosmetic-chest" : q.template,
        targets,
        { objective, policy: POI_QUEST_POLICY },
      );
      if (hunt)
        activity.steps.forEach((s, n) => {
          s.label = q.pois[n].name ? `${q.pois[n].name}` : `${label(q.category)} ${n + 1}`;
        });
      if (q.chest)
        activity.rewardConstraint =
          "Personal XP once; a cosmetic Aura only while edition supply remains. No GOLD or NEAR prize.";
      db.prepare(
        "INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at,zone_id,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        questId,
        current.id,
        title.slice(0, 120),
        objective.slice(0, 280),
        targets.at(-1).lat,
        targets.at(-1).lng,
        1,
        0,
        q.chest ? POI_XP.chest : hunt ? POI_XP.hunt : POI_XP.visit,
        kind,
        opensAt,
        closesAt,
        zoneId,
        JSON.stringify({
          zoneId,
          checkpoints: hunt ? targets : [],
          ...(hunt ? { unordered: true } : {}),
          activity,
          poi: {
            policy: POI_QUEST_POLICY,
            template: q.template,
            category: q.category,
            ids: q.pois.map((p) => p.id),
            seed: plan.seed,
          },
        }),
      );
    });
    current.zones = [...current.zones, ...zones];
    current.poiQuests = {
      policy: POI_QUEST_POLICY,
      layerId,
      source: source.version?.() || null,
      status: zones.length ? "ready" : "empty",
      count: zones.length,
      ...(zones.length ? {} : { notice: EMPTY_NOTICE }),
    };
    db.prepare("UPDATE worlds SET manifest=? WHERE id=?").run(JSON.stringify(current), current.id);
    db.prepare("INSERT INTO daily_jobs VALUES (?,?)").run(key, now);
    return current;
  });
}

// ---------------------------------------------------------------------------
// Category hunt progress: stops in any order.

export function huntVisited(db, questId, player) {
  if (!player) return new Set();
  ensurePoiQuestSchema(db);
  return new Set(
    db
      .prepare("SELECT stop FROM poi_hunt_stops WHERE quest_id=? AND player_id=?")
      .all(questId, player)
      .map((r) => r.stop),
  );
}

/** The unvisited stop nearest to the fix, or null. */
export function nearestOpenStop(checkpoints, visited, fix) {
  let best = null;
  checkpoints.forEach((p, i) => {
    if (visited.has(i)) return;
    const d = distance(fix, p);
    if (!best || d < best.distance) best = { index: i, distance: d, point: p };
  });
  return best;
}

export function recordHuntStop(db, questId, player, stop, fixAt, now) {
  ensurePoiQuestSchema(db);
  db.prepare(
    "INSERT OR IGNORE INTO poi_hunt_stops(quest_id,player_id,stop,fix_at,created_at) VALUES(?,?,?,?,?)",
  ).run(questId, player, stop, fixAt, now);
}

