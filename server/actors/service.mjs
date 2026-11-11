// Actor service: lists today's NPCs and monsters for a world and issues
// encounter tokens (docs/NPC-PLAN.md §3, §14). Positions are a pure function
// of (world seed, day, actor, time); the server recomputes them at encounter
// time and never trusts a client-reported actor position.
import { createHash, randomBytes } from "node:crypto";
import { assert, distance, point } from "../domain.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { cityById } from "../spatial/city-pack.mjs";
import { localDateStart } from "../spatial/calendar.mjs";
import {
  closedPlaces,
  effectiveCityPack,
  placeClosed,
} from "../spatial/place-safety.mjs";
import { pauseFor, pauseState } from "../operator/world-controls.mjs";
import { cellToLatLng, getResolution, isValidCell } from "h3-js";
import { DENSITY_CAP_PER_CELL, loadCityActors, loadGenericActors, REVEAL_RADIUS_M } from "./definitions.mjs";
import { actorPois } from "./pois.mjs";
import { pathGraph } from "./schedule.mjs";
import { buildActorMenu, menuHash } from "./menu.mjs";
import { ACTORS_SCHEMA } from "./schema.mjs";
import { planDay, positionAt } from "./schedule.mjs";
import { planSpawns } from "./spawns.mjs";
import { skyAt } from "../sun.mjs";
import { streetFindIds } from "../street-finds.mjs";
import { ACTOR_HOME_RADIUS_M, compactActorCast } from "../demo-zones.mjs";

export const ENCOUNTER_TTL_MS = 5 * 60_000;
export const ENCOUNTER_RADIUS_M = 35;
export const STATION_RADIUS_M = 50;
export const MAX_GPS_ACCURACY_M = 30;
export const MAX_FIX_AGE_MS = 15_000;
export const MAX_SPEED_MPS = 15;
export const SEGMENT_HORIZON_MS = 2 * 3600_000;
// The map refetches every minute, so the list sends only the next 20 minutes
// of each walk (was the full 2 h: ~80 KB a minute on a phone, see
// docs/PERFORMANCE-BUDGET.md). SEGMENT_HORIZON_MS still decides who is listed.
export const LIST_HORIZON_MS = 20 * 60_000;
// Day plans kept in memory. A cold city plan takes 0.4-0.6 s of synchronous
// work, which stalls every other request, so the cache evicts least recently
// used plans instead of clearing, and warm() builds today's city plans
// outside the request path.
export const PLAN_CACHE_SIZE = 128;
export const ENCOUNTERS_PER_HOUR = 60;

// Slices can add fields to an ActorView (the hunt slice adds boss HP and the
// boss arena). A decorator gets (view, {instance, player, dayId, cityId, now})
// and returns extra fields or nothing.
const decorators = [];
export function registerActorDecorator(fn) {
  if (typeof fn === "function" && !decorators.includes(fn)) decorators.push(fn);
}
// A slice can move an actor for a while (GOLD lures, server/gold-spend):
// an override returns { from, to, lat, lng } and the actor dwells there for
// that window instead of its planned segments. Overrides never change who
// the actor is, its rewards or its odds.
const segmentOverrides = [];
export function registerSegmentOverride(fn) {
  if (typeof fn === "function" && !segmentOverrides.includes(fn)) segmentOverrides.push(fn);
}
/** Replace the planned segments overlapping [from, to) with one dwell at the point. */
export function spliceDwell(segments, { from, to, lat, lng }) {
  return [
    ...segments.filter((s) => s.to <= from),
    { from, to, path: [[lng, lat]], dwell: true, lured: true },
    ...segments.filter((s) => s.from >= to),
  ];
}
function liveSegments(instance, worldId, now) {
  for (const fn of segmentOverrides) {
    let o = null;
    try {
      o = fn({ instance, worldId, now });
    } catch {
      o = null;
    }
    if (o && Number.isFinite(o.from) && Number.isFinite(o.to) && o.to > o.from && Number.isFinite(o.lat) && Number.isFinite(o.lng))
      return spliceDwell(instance.segments, o);
  }
  return instance.segments;
}
function decorate(view, ctx) {
  for (const d of decorators) {
    try {
      Object.assign(view, d(view, ctx) || {});
    } catch {
      // A broken decorator must not hide the actor.
    }
  }
  return view;
}

/**
 * ACTORS_ALL_DAY=1 is a test-only switch (e2e servers): every actor plays the
 * whole local day instead of its opening hours. Ignored on mainnet.
 */
export function actorsAllDay(env = process.env, network = env.NEAR_NETWORK || "testnet") {
  return env.ACTORS_ALL_DAY === "1" && network !== "mainnet";
}

export function actorsEnabled(env = process.env) {
  return env.ACTORS_ENABLED === "1";
}

const sha = (v) => createHash("sha256").update(v).digest("hex");
const round = (n) => Math.round(n * 1e6) / 1e6;

/** World seed: published with the world, so plans can't be known earlier. */
export function worldSeed(manifest) {
  return sha(`actors-v1|${manifest.cityId}|${manifest.blueprintId || manifest.id}`);
}

export function createActorService(db, options = {}) {
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const clock = options.clock || Date.now,
    // Test hook: plan every actor across the whole local day, so e2e runs
    // see a cast at any hour. Production never sets it (actorsAllDay below).
    forceAllDay = options.allDay === true,
    // The server's shared travel anchor (server/fair-play.mjs guardTravel).
    travelGuard = options.travelGuard || null,
    cities = options.cityById || cityById,
    loadActors = options.loadCityActors || loadCityActors,
    loadGeneric = options.loadGenericActors || loadGenericActors,
    plans = new Map();

  // Street cells walk the cell's cached public-path snapshot (the same one
  // street coins use). No map request happens here: a cell without a
  // snapshot simply has no actors yet.
  function cellPack(region) {
    let row;
    try {
      row = db.prepare("SELECT data FROM geo_cache WHERE region=?").get(region);
    } catch {
      return null;
    }
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.data),
        raw = Array.isArray(parsed) ? parsed : parsed.paths;
      if (!Array.isArray(raw) || !raw.length) return null;
      const [lat, lng] = cellToLatLng(region);
      return {
        id: `cell-${region}`,
        version: `${parsed.observedAt ?? 0}`,
        paths: raw.slice(0, 150).map((points) => ({ points })),
        exclusions: [],
        candidates: [],
        center: { lat, lng },
        minComponent: 8,
      };
    } catch {
      return null;
    }
  }

  // Which cast plays in this world: a reviewed city file wins; any other city
  // pack and every active street cell gets the generic cast, capped per cell.
  function castFor(manifest) {
    if (manifest.cityId) {
      const base = cities(manifest.cityId);
      if (!base) return null;
      const reviewed = loadActors(manifest.cityId),
        cast = reviewed || loadGeneric();
      // A compact demo world (DEMO_ZONES, server/demo-zones.mjs) keeps its
      // cast near the centre too.
      if (manifest.demoZones)
        return { cast: compactActorCast(cast), base, generic: !reviewed, packKey: "compact", compact: true };
      return { cast, base, generic: !reviewed, packKey: "" };
    }
    const region = manifest.region;
    if (manifest.arena || typeof region !== "string" || !isValidCell(region) || getResolution(region) !== 7) return null;
    const pack = cellPack(region);
    return pack ? { cast: loadGeneric(), base: pack, generic: true, cell: region, packKey: pack.version } : null;
  }

  function manifestFor(worldId) {
    assert(typeof worldId === "string" && worldId.length >= 1 && worldId.length <= 200, "Open today's map first.", 400, "WORLD_REQUIRED");
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(worldId);
    assert(row, "This map has ended. Refresh for today's world.", 404, "WORLD_NOT_FOUND");
    return JSON.parse(row.manifest);
  }

  // Day plan per world and closure version, cached in memory (pure input).
  function planFor(manifest) {
    const source = castFor(manifest);
    if (!source) return null;
    const { cast: city, base } = source;
    const closed = closedPlaces(db, manifest.cityId),
      key = `${manifest.id}|${source.packKey}|${closed.map((c) => `${c.id}@${c.version}`).join(",")}`;
    if (plans.has(key)) {
      // Least recently used goes first: a busy world (the Plzeň arena) stays
      // warm however many street cells are visited (docs/PERFORMANCE-BUDGET.md).
      const hit = plans.get(key);
      plans.delete(key);
      plans.set(key, hit);
      return hit;
    }
    const pack = source.cell ? base : effectiveCityPack(db, base),
      seed = worldSeed(manifest),
      dayStart = localDateStart(manifest.day, manifest.timezone),
      chests = zoneChests(manifest.id),
      zones = (manifest.zones || []).map((z) => ({
        ...z,
        placeStatus: placeClosed(closed, z.sourceId, z) ? "closed" : "open",
        ...(chests.has(z.id) ? { chest: chests.get(z.id) } : {}),
      }));
    const finds = streetFinds(manifest.id);
    const pois = source.generic ? actorPois({ manifest, pack, graph: pathGraph(pack, closed), zones, closed }) : null,
      // Generic ids differ per cell so a win in one street cell is not a win
      // in the next one; city ids stay as reviewed.
      suffix = source.cell ? `-${sha(source.cell).slice(0, 6)}` : "";
    const spawned = planSpawns(city, pack, seed, manifest.day, {
      zones,
      closed,
      finds,
      pois,
      cap: source.cell ? DENSITY_CAP_PER_CELL : null,
      ...(source.compact ? { homeArea: { center: pack.center, radiusM: ACTOR_HOME_RADIUS_M } } : {}),
    });
    const instances = spawned.map((s) => {
      const id = `${s.id}${suffix}`,
        def = { ...s.def, instanceId: id };
      return {
        ...s,
        id,
        segments: planDay(def, pack, seed, manifest.day, {
          dayStart,
          hours: city.hours,
          home: s.home,
          allDay: forceAllDay || !!manifest.arena,
          // Real local daylight at the world's centre picks the day or night cast.
          sky: pack.center,
        }),
      };
    });
    const plan = { seed, instances, center: pack.center, byId: new Map(instances.map((i) => [i.id, i])) };
    plans.set(key, plan);
    while (plans.size > PLAN_CACHE_SIZE) plans.delete(plans.keys().next().value);
    return plan;
  }

  // Each zone's chest quest: its guardian stands on it (server/actors/spawns.mjs).
  function zoneChests(worldId) {
    try {
      return new Map(
        db
          .prepare("SELECT id,zone_id,lat,lng FROM quests WHERE world_id=? AND kind='chest' AND zone_id IS NOT NULL ORDER BY id")
          .all(worldId)
          .map((q) => [q.zone_id, { questId: q.id, lat: q.lat, lng: q.lng }]),
      );
    } catch {
      return new Map();
    }
  }

  // Today's street finds (lurkers hide next to them). Worlds without coins
  // (or tests without the table) fall back to seeded path points.
  function streetFinds(worldId) {
    try {
      const ids = streetFindIds(db, worldId);
      return db
        .prepare("SELECT id,lat,lng FROM coins WHERE world_id=?")
        .all(worldId)
        .filter((c) => ids.has(c.id));
    } catch {
      return [];
    }
  }

  function progressFor(player, dayId) {
    if (!player) return new Map();
    return new Map(
      db
        .prepare("SELECT actor_id,defeats,cooldown_until FROM actor_progress WHERE player_id=? AND day_id=?")
        .all(player, dayId)
        .map((r) => [r.actor_id, r]),
    );
  }

  function view(instance, now, progress, { trim = true } = {}) {
    const { def } = instance;
    const segments = (trim
      ? instance.segments.filter((s) => s.to > now - 60_000 && s.from < now + LIST_HORIZON_MS)
      : instance.segments
    ).map((s) => ({
      from: s.from,
      to: s.to,
      path: s.path.map(([lng, lat]) => [round(lng), round(lat)]),
      ...(s.dwell ? { dwell: true } : {}),
    }));
    const p = progress?.get(instance.id);
    const state =
      p?.cooldown_until > now ? "cooldown" : p?.defeats > 0 ? "defeated" : "active";
    return {
      id: instance.id,
      kind: def.kind,
      archetype: def.archetype,
      name: def.name,
      ...(def.title ? { title: def.title } : {}),
      model: def.model,
      ...(def.element ? { element: def.element } : {}),
      ...(def.phase === "day" || def.phase === "night" ? { phase: def.phase } : {}),
      segments,
      ...(REVEAL_RADIUS_M[def.archetype] ? { revealRadiusM: REVEAL_RADIUS_M[def.archetype] } : {}),
      ...(instance.guards ? { guards: instance.guards } : {}),
      state,
      ...(p?.cooldown_until > now ? { cooldownUntil: p.cooldown_until } : {}),
    };
  }

  function withLiveSegments(instance, worldId, now) {
    const segments = liveSegments(instance, worldId, now);
    return segments === instance.segments ? instance : { ...instance, segments };
  }

  /** Every actor of today's world with its position now (null when away). */
  function castNow(worldId) {
    const now = clock(),
      manifest = manifestFor(worldId);
    if (manifest.endsAt <= now || paused(manifest)) return { manifest, now, actors: [] };
    const plan = planFor(manifest);
    if (!plan) return { manifest, now, actors: [] };
    return {
      manifest,
      now,
      actors: plan.instances.map((i) => ({
        id: i.id,
        kind: i.def.kind,
        archetype: i.def.archetype,
        name: i.def.name,
        pos: positionAt(liveSegments(i, manifest.id, now), now),
      })),
    };
  }

  function paused(manifest) {
    return !!pauseFor(pauseState(db, manifest.cityId, manifest.day), null);
  }

  async function list({ player, worldId, location }) {
    const now = clock(),
      manifest = manifestFor(worldId),
      empty = { enabled: true, worldId, dayId: manifest.day, now, actors: [] };
    if (manifest.endsAt <= now || paused(manifest)) return empty;
    const plan = planFor(manifest);
    if (!plan) return empty;
    const here = location ? point(location) : null,
      progress = progressFor(player, manifest.day),
      actors = [];
    for (const planned of plan.instances) {
      const instance = withLiveSegments(planned, manifest.id, now);
      const pos = positionAt(instance.segments, now);
      const next = instance.segments.find((s) => s.to > now && s.from < now + SEGMENT_HORIZON_MS);
      if (!pos && !next) continue;
      const reveal = REVEAL_RADIUS_M[instance.def.archetype];
      // Hidden actors are sent only to a player already within reveal range,
      // so the list can't be used to hunt them from afar.
      if (reveal && (!here || !pos || distance(here, pos) > reveal)) continue;
      actors.push(decorate(view(instance, now, progress), { instance, player, dayId: manifest.day, cityId: manifest.cityId, worldId: manifest.id, now }));
    }
    return { ...empty, ...(plan.center ? { sky: skyAt(now, plan.center) } : {}), actors };
  }

  function checkFix(player, fix, arena, now) {
    const p = point(fix);
    if (arena) return p;
    assert(
      Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= MAX_GPS_ACCURACY_M,
      "Your location is not precise enough yet. Step into the open and try again.",
      422,
      "GPS_ACCURACY",
    );
    assert(
      Number.isFinite(fix.timestamp) && fix.timestamp <= now + 2000 && now - fix.timestamp <= MAX_FIX_AGE_MS,
      "Your location is out of date. Wait a moment for a fresh one, then try again.",
      422,
      "GPS_STALE",
    );
    const prev = db.prepare("SELECT * FROM actor_player_fixes WHERE player_id=?").get(player);
    let flagged = 0;
    if (prev && fix.timestamp > prev.fix_at) {
      const seconds = (fix.timestamp - prev.fix_at) / 1000,
        meters = Math.max(0, distance(prev, p) - (fix.accuracy || 0) - (prev.accuracy || 0));
      if (seconds >= 1 && meters / seconds > MAX_SPEED_MPS) flagged = 1;
    }
    db.prepare(
      "INSERT INTO actor_player_fixes(player_id,lat,lng,accuracy,fix_at,flagged) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,fix_at=MAX(fix_at,excluded.fix_at),flagged=excluded.flagged",
    ).run(player, p.lat, p.lng, fix.accuracy, Math.round(fix.timestamp), flagged);
    assert(
      !flagged,
      "Your location jumped too fast. Wait for a steady GPS fix, then try again.",
      422,
      "IMPLAUSIBLE_MOVE",
    );
    // Meetings share the travel anchor with coin and quest claims. Otherwise
    // an errand could be handed in from across town: meet the NPC, claim the
    // far place, and meet the NPC again a second later (each check only saw
    // its own last fix).
    travelGuard?.(player, fix, now);
    return p;
  }

  async function encounter({ player, actorId, worldId, location }) {
    assert(player, "Please sign in again.", 401);
    const now = clock(),
      manifest = manifestFor(worldId);
    assert(manifest.endsAt > now, "Today's world has ended. Refresh the map for a new one.", 410, "WORLD_ENDED");
    assert(!paused(manifest), "Operators paused today's world for a moment. Your progress is safe; try again later.", 423, "WORLD_PAUSED");
    const plan = planFor(manifest),
      planned = plan?.byId.get(actorId);
    assert(planned, "This character is not on today's map.", 404, "ACTOR_NOT_FOUND");
    const instance = withLiveSegments(planned, manifest.id, now);
    const pos = positionAt(instance.segments, now);
    assert(pos, `${instance.def.name} is not out right now. Check back later.`, 409, "ACTOR_AWAY");
    const recent = db
      .prepare("SELECT COUNT(*) AS n FROM actor_encounters WHERE player_id=? AND created_at>?")
      .get(player, now - 3600_000).n;
    assert(recent < ENCOUNTERS_PER_HOUR, "Take a short break before meeting more characters.", 429, "ENCOUNTER_LIMIT");
    const here = checkFix(player, location || {}, !!manifest.arena, now);
    const meters = distance(here, pos),
      radius = pos.dwell ? STATION_RADIUS_M : ENCOUNTER_RADIUS_M;
    assert(meters <= radius, `Get closer to ${instance.def.name}, then try again.`, 422, "OUT_OF_RANGE");
    const progress = progressFor(player, manifest.day),
      actor = decorate(view(instance, now, progress), { instance, player, dayId: manifest.day, cityId: manifest.cityId, worldId: manifest.id, now }),
      expiresAt = now + ENCOUNTER_TTL_MS;
    assert(actor.state !== "cooldown", `${instance.def.name} needs a moment. Try again later.`, 429, "ACTOR_COOLDOWN");
    const menu = await buildActorMenu({
      actor,
      def: instance.def,
      persona: instance.def.persona || null,
      player,
      world: manifest,
      dayId: manifest.day,
      now,
      expiresAt,
      db,
    });
    const hash = menuHash(menu),
      token = `enc_${randomBytes(24).toString("base64url")}`;
    db.prepare(
      "INSERT INTO actor_encounters(id,player_id,actor_id,world_id,day_id,segment_index,menu_hash,distance_m,arena,data,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      sha(token),
      player,
      instance.id,
      manifest.id,
      manifest.day,
      pos.index,
      hash,
      Math.round(meters * 10) / 10,
      manifest.arena ? 1 : 0,
      JSON.stringify({ menu }),
      now,
      expiresAt,
    );
    db.prepare("DELETE FROM actor_encounters WHERE expires_at<?").run(now - 7 * 86_400_000);
    return { encounter: token, expiresAt, actor, menu, distanceM: Math.round(meters) };
  }

  // For /talk, /offers and /challenge routes. Throws 403/404/410.
  function requireEncounter({ token, player, actorId }) {
    assert(typeof token === "string" && /^enc_[A-Za-z0-9_-]{20,64}$/.test(token), "Meet the character first.", 403, "ENCOUNTER_REQUIRED");
    const row = db.prepare("SELECT * FROM actor_encounters WHERE id=?").get(sha(token));
    assert(row && row.player_id === player && (!actorId || row.actor_id === actorId), "Meet the character first.", 403, "ENCOUNTER_REQUIRED");
    const now = clock();
    assert(row.expires_at > now, "This meeting has ended. Walk up to them again.", 410, "ENCOUNTER_EXPIRED");
    const manifest = manifestFor(row.world_id),
      plan = planFor(manifest),
      instance = plan?.byId.get(row.actor_id);
    assert(instance, "This character is not on today's map.", 404, "ACTOR_NOT_FOUND");
    return {
      encounterId: row.id,
      actor: decorate(view(instance, now, progressFor(player, row.day_id)), { instance, player, dayId: row.day_id, cityId: manifest.cityId, now }),
      def: instance.def,
      worldId: row.world_id,
      cityId: manifest.cityId,
      dayId: row.day_id,
      seed: sha(`${plan.seed}|${row.id}`),
      menu: JSON.parse(row.data).menu || [],
      menuHash: row.menu_hash,
      expiresAt: row.expires_at,
    };
  }

  // Builds today's city plans (arena and reviewed cities) ahead of the first
  // player, so no request pays for a cold plan. Street cells are cheap (~25 ms)
  // and are left to the first visit. Returns how many plans were built.
  function warm(now = clock()) {
    let built = 0;
    const rows = db
      .prepare("SELECT manifest FROM worlds WHERE created_at >= ?")
      .all(now - 2 * 86_400_000);
    for (const row of rows) {
      let manifest;
      try {
        manifest = JSON.parse(row.manifest);
      } catch {
        continue;
      }
      if (!manifest.cityId || !(manifest.endsAt > now)) continue;
      const before = plans.size;
      try {
        planFor(manifest);
      } catch {
        continue;
      }
      if (plans.size > before) built++;
    }
    return built;
  }

  return { list, encounter, requireEncounter, planFor, warm, castNow, manifestFor };
}
