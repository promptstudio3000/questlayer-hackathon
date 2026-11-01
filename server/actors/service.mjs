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
import { loadCityActors, REVEAL_RADIUS_M } from "./definitions.mjs";
import { buildActorMenu, menuHash } from "./menu.mjs";
import { ACTORS_SCHEMA } from "./schema.mjs";
import { planDay, positionAt } from "./schedule.mjs";
import { planSpawns } from "./spawns.mjs";
import { streetFindIds } from "../street-finds.mjs";

export const ENCOUNTER_TTL_MS = 5 * 60_000;
export const ENCOUNTER_RADIUS_M = 35;
export const STATION_RADIUS_M = 50;
export const MAX_GPS_ACCURACY_M = 30;
export const MAX_FIX_AGE_MS = 15_000;
export const MAX_SPEED_MPS = 15;
export const SEGMENT_HORIZON_MS = 2 * 3600_000;
export const ENCOUNTERS_PER_HOUR = 60;

// Slices can add fields to an ActorView (the hunt slice adds boss HP and the
// boss arena). A decorator gets (view, {instance, player, dayId, cityId, now})
// and returns extra fields or nothing.
const decorators = [];
export function registerActorDecorator(fn) {
  if (typeof fn === "function" && !decorators.includes(fn)) decorators.push(fn);
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
    cities = options.cityById || cityById,
    loadActors = options.loadCityActors || loadCityActors,
    plans = new Map();

  function manifestFor(worldId) {
    assert(typeof worldId === "string" && worldId.length >= 1 && worldId.length <= 200, "Open today's map first.", 400, "WORLD_REQUIRED");
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(worldId);
    assert(row, "This map has ended. Refresh for today's world.", 404, "WORLD_NOT_FOUND");
    return JSON.parse(row.manifest);
  }

  // Day plan per world and closure version, cached in memory (pure input).
  function planFor(manifest) {
    const city = manifest.cityId ? loadActors(manifest.cityId) : null,
      base = city ? cities(manifest.cityId) : null;
    if (!city || !base) return null;
    const closed = closedPlaces(db, manifest.cityId),
      key = `${manifest.id}|${closed.map((c) => `${c.id}@${c.version}`).join(",")}`;
    if (plans.has(key)) return plans.get(key);
    const pack = effectiveCityPack(db, base),
      seed = worldSeed(manifest),
      dayStart = localDateStart(manifest.day, manifest.timezone),
      zones = (manifest.zones || []).map((z) => ({
        ...z,
        placeStatus: placeClosed(closed, z.sourceId, z) ? "closed" : "open",
      }));
    const finds = streetFinds(manifest.id);
    const instances = planSpawns(city, pack, seed, manifest.day, { zones, closed, finds }).map((s) => {
      const def = { ...s.def, instanceId: s.id };
      return {
        ...s,
        segments: planDay(def, pack, seed, manifest.day, {
          dayStart,
          hours: city.hours,
          home: s.home,
          allDay: !!manifest.arena,
        }),
      };
    });
    const plan = { seed, instances, byId: new Map(instances.map((i) => [i.id, i])) };
    if (plans.size > 32) plans.clear();
    plans.set(key, plan);
    return plan;
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
      ? instance.segments.filter((s) => s.to > now - 60_000 && s.from < now + SEGMENT_HORIZON_MS)
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
      segments,
      ...(REVEAL_RADIUS_M[def.archetype] ? { revealRadiusM: REVEAL_RADIUS_M[def.archetype] } : {}),
      ...(instance.guards ? { guards: instance.guards } : {}),
      state,
      ...(p?.cooldown_until > now ? { cooldownUntil: p.cooldown_until } : {}),
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
    for (const instance of plan.instances) {
      const pos = positionAt(instance.segments, now);
      const next = instance.segments.find((s) => s.to > now && s.from < now + SEGMENT_HORIZON_MS);
      if (!pos && !next) continue;
      const reveal = REVEAL_RADIUS_M[instance.def.archetype];
      // Hidden actors are sent only to a player already within reveal range,
      // so the list can't be used to hunt them from afar.
      if (reveal && (!here || !pos || distance(here, pos) > reveal)) continue;
      actors.push(decorate(view(instance, now, progress), { instance, player, dayId: manifest.day, cityId: manifest.cityId, now }));
    }
    return { ...empty, actors };
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
    return p;
  }

  async function encounter({ player, actorId, worldId, location }) {
    assert(player, "Please sign in again.", 401);
    const now = clock(),
      manifest = manifestFor(worldId);
    assert(manifest.endsAt > now, "Today's world has ended. Refresh the map for a new one.", 410, "WORLD_ENDED");
    assert(!paused(manifest), "Operators paused today's world for a moment. Your progress is safe; try again later.", 423, "WORLD_PAUSED");
    const plan = planFor(manifest),
      instance = plan?.byId.get(actorId);
    assert(instance, "This character is not on today's map.", 404, "ACTOR_NOT_FOUND");
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
      actor = decorate(view(instance, now, progress), { instance, player, dayId: manifest.day, cityId: manifest.cityId, now }),
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

  return { list, encounter, requireEncounter, planFor };
}
