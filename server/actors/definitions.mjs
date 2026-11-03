// Roaming NPC and monster definitions (docs/NPC-PLAN.md §14). Each city has
// one reviewed file in server/data/actors/<cityId>.json. Loading validates
// every field, so a bad file fails at startup and never reaches players.
import { existsSync, readFileSync } from "node:fs";
import { assert } from "../domain.mjs";

export const ACTOR_KINDS = Object.freeze(["npc", "monster"]);
export const NPC_ARCHETYPES = Object.freeze([
  "storyteller",
  "trader",
  "keeper",
  "quest_giver",
  "wandering_rare",
]);
export const MONSTER_ARCHETYPES = Object.freeze([
  "roamer",
  "guardian",
  "lurker",
  "boss",
]);
export const ELEMENTS = Object.freeze(["ember", "frost", "storm", "void"]);
// Visibility radius for actors that only show up close by.
export const REVEAL_RADIUS_M = Object.freeze({ lurker: 60, wandering_rare: 300 });
// Archetypes whose instances the spawn planner places (no fixed home needed).
export const PLANNED_ARCHETYPES = Object.freeze([
  "wandering_rare",
  "roamer",
  "guardian",
  "lurker",
]);

const ID = /^[a-z0-9-]{3,40}$/,
  HOUR = /^([01]\d|2[0-3]):[0-5]\d$/,
  FIELDS = new Set([
    "id",
    "kind",
    "archetype",
    "name",
    "title",
    "model",
    "home",
    "rangeM",
    "speedMps",
    "dwellMin",
    "hours",
    "windows",
    "persona",
    "enabled",
    "element",
    "count",
    "homeFrom",
  ]);

// The generic cast (server/data/actors/_generic.json) runs in any city
// without a reviewed file and in every active street cell. It may not hold
// archetypes that touch the treasury or need a reviewed zone.
export const GENERIC_CAST = "_generic";
export const GENERIC_DENIED = Object.freeze(["trader", "keeper", "guardian", "boss"]);
// Density cap per world cell, shared by every layer (docs/WORLDS-PLAN.md B.4):
// at most this many instances of each archetype in one street cell.
export const DENSITY_CAP_PER_CELL = Object.freeze({
  quest_giver: 1,
  storyteller: 1,
  wandering_rare: 1,
  roamer: 1,
  lurker: 2,
});

const text = (v, max) =>
  typeof v === "string" && v.trim() === v && v.length >= 1 && v.length <= max;
const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

export function validateActorDefinition(def, where = "actor") {
  assert(def && typeof def === "object" && !Array.isArray(def), `${where}: not an object.`);
  for (const key of Object.keys(def))
    assert(FIELDS.has(key), `${where}: unknown field "${key}".`);
  assert(ID.test(def.id), `${where}: invalid id.`);
  where = `actor ${def.id}`;
  assert(ACTOR_KINDS.includes(def.kind), `${where}: invalid kind.`);
  assert(
    (def.kind === "npc" ? NPC_ARCHETYPES : MONSTER_ARCHETYPES).includes(
      def.archetype,
    ),
    `${where}: archetype does not match kind.`,
  );
  assert(text(def.name, 60), `${where}: invalid name.`);
  assert(def.title === undefined || text(def.title, 80), `${where}: invalid title.`);
  assert(ID.test(def.model), `${where}: invalid model.`);
  assert(
    def.homeFrom === undefined || (def.homeFrom === "poi" && def.home === undefined && def.kind === "npc"),
    `${where}: homeFrom is "poi" for NPCs without a fixed home.`,
  );
  if (def.home !== undefined)
    assert(
      num(def.home?.lat, -85, 85) &&
        num(def.home?.lng, -180, 180) &&
        Object.keys(def.home).length === 2,
      `${where}: invalid home.`,
    );
  else if (!def.homeFrom)
    assert(
      PLANNED_ARCHETYPES.includes(def.archetype),
      `${where}: this archetype needs a home.`,
    );
  assert(num(def.rangeM, 0, 10000), `${where}: invalid rangeM.`);
  assert(num(def.speedMps, 0, 5), `${where}: invalid speedMps.`);
  assert(
    Array.isArray(def.dwellMin) &&
      def.dwellMin.length === 2 &&
      num(def.dwellMin[0], 0, 120) &&
      num(def.dwellMin[1], def.dwellMin[0], 120),
    `${where}: invalid dwellMin.`,
  );
  const moves = def.speedMps > 0 && def.rangeM > 0;
  assert(
    moves || (def.speedMps === 0 && ["keeper", "guardian", "lurker", "boss"].includes(def.archetype)),
    `${where}: a roaming archetype needs speed and range.`,
  );
  if (def.hours !== undefined)
    assert(
      Array.isArray(def.hours) &&
        def.hours.length === 2 &&
        def.hours.every((h) => HOUR.test(h)) &&
        def.hours[0] < def.hours[1],
      `${where}: invalid hours.`,
    );
  if (def.windows !== undefined)
    assert(
      Number.isSafeInteger(def.windows) && def.windows >= 1 && def.windows <= 12,
      `${where}: invalid windows.`,
    );
  assert(
    def.persona === undefined || ID.test(def.persona),
    `${where}: invalid persona.`,
  );
  assert(typeof def.enabled === "boolean", `${where}: enabled must be a boolean.`);
  assert(
    def.element === undefined || ELEMENTS.includes(def.element),
    `${where}: invalid element.`,
  );
  if (def.count !== undefined)
    assert(
      Number.isSafeInteger(def.count) &&
        def.count >= 1 &&
        def.count <= 20 &&
        PLANNED_ARCHETYPES.includes(def.archetype),
      `${where}: count is for planned archetypes, 1–20.`,
    );
  return Object.freeze({ ...def });
}

export function validateActorFile(file, cityId) {
  assert(file?.version === 1, "Actor file: unsupported version.");
  assert(file.cityId === cityId, "Actor file: city mismatch.");
  assert(
    Array.isArray(file.hours) &&
      file.hours.length === 2 &&
      file.hours.every((h) => HOUR.test(h)) &&
      file.hours[0] < file.hours[1],
    "Actor file: invalid hours.",
  );
  assert(
    Array.isArray(file.actors) && file.actors.length <= 60,
    "Actor file: invalid actor list.",
  );
  const actors = file.actors.map((a, i) => validateActorDefinition(a, `actor #${i}`));
  const ids = new Set();
  for (const a of actors) {
    for (let n = 1; n <= (a.count || 1); n++) {
      const id = instanceId(a, n);
      assert(!ids.has(id), `Actor file: duplicate id ${id}.`);
      ids.add(id);
    }
  }
  if (cityId === GENERIC_CAST) {
    const per = {};
    for (const a of actors) {
      assert(!GENERIC_DENIED.includes(a.archetype), `Actor file: ${a.archetype} needs a reviewed city file.`);
      assert(!a.home, `Actor file: generic actor ${a.id} cannot have fixed coordinates.`);
      per[a.archetype] = (per[a.archetype] || 0) + (a.count || 1);
    }
    for (const [archetype, n] of Object.entries(per))
      assert(n <= (DENSITY_CAP_PER_CELL[archetype] ?? 0), `Actor file: too many ${archetype} for one cell.`);
  } else assert(actors.every((a) => !a.homeFrom), "Actor file: homeFrom is for the generic cast.");
  return Object.freeze({
    cityId,
    hours: Object.freeze([...file.hours]),
    actors: Object.freeze(actors),
  });
}

// Templates with count > 1 spawn numbered instances: lickquidator-1, -2, …
export function instanceId(def, n) {
  return (def.count || 1) > 1 ? `${def.id}-${n}` : def.id;
}

const cache = new Map();
export function loadCityActors(
  cityId,
  dir = new URL("../data/actors/", import.meta.url),
) {
  const key = `${dir}|${cityId}`;
  if (cache.has(key)) return cache.get(key);
  assert(cityId === GENERIC_CAST || /^[a-z0-9-]{1,40}$/.test(cityId), "Invalid city.");
  const url = new URL(`${cityId}.json`, dir);
  const result = existsSync(url)
    ? validateActorFile(JSON.parse(readFileSync(url, "utf8")), cityId)
    : null;
  cache.set(key, result);
  return result;
}

/** The generic cast; never null (the file ships with the server). */
export function loadGenericActors(dir) {
  const cast = loadCityActors(GENERIC_CAST, dir);
  assert(cast, "Generic actor file missing.");
  return cast;
}
