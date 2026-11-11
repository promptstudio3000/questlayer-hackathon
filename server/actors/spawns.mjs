// Daily placement of actor instances (docs/NPC-PLAN.md §3, §13.1). Pure and
// deterministic: the same world seed, day, zones and closures give the same
// instances. NPCs with a home stay there; planned archetypes get a seeded home
// on the walkable graph; guardians stand at today's open zones.
import { distance } from "../domain.mjs";
import { instanceId, phaseOf } from "./definitions.mjs";
import { nearestNode, pathGraph, seededRandom } from "./schedule.mjs";

// At most one monster per this many metres (§13.1 density cap).
export const MONSTER_SPACING_M = 150;
// Lurkers hide within this distance of a street find (§13.1).
export const LURKER_FIND_RADIUS_M = 40;
const ROAMER_SPACING_M = 300;
// A guardian stands on the path point nearest its chest, never further than this.
export const GUARDIAN_CHEST_RADIUS_M = 40;

/**
 * planSpawns(city, pack, worldSeed, dayId, { zones, closed, finds })
 *   -> [{ def, id, home: {lat,lng}, guards?, near? }]
 * `zones` are the world's zones with placeStatus and `chest` ({questId,lat,lng},
 * the zone's chest quest); closed zones and zones without a chest get no guardian.
 * `finds` are today's street finds ({id, lat, lng}); lurkers hide next to a
 * seeded subset of them, or on seeded path points when there are none.
 */
export function planSpawns(city, pack, worldSeed, dayId, { zones = [], closed = [], finds = [], pois = null, cap = null, homeArea = null } = {}) {
  const g = pathGraph(pack, closed);
  if (!g.nodes.length) return [];
  // `homeArea` ({ center, radiusM }, the compact demo layout) keeps seeded
  // homes near the centre; without enough nodes there the whole graph is used.
  const near = homeArea
    ? g.nodes.filter((i) => distance({ lat: g.lat[i], lng: g.lng[i] }, homeArea.center) <= homeArea.radiusM)
    : [];
  const homeNodes = near.length >= 20 ? near : g.nodes;
  const out = [],
    monsters = [],
    npcHomes = [],
    used = {};
  // `cap` (DENSITY_CAP_PER_CELL) limits instances per archetype in one cell at
  // any moment: day and night casts are counted apart, "any" counts in both.
  const phases = (def) => (phaseOf(def) === "any" ? ["day", "night"] : [phaseOf(def)]);
  const taken = (def) => Math.max(...phases(def).map((p) => used[`${def.archetype}|${p}`] || 0));
  const room = (def) => (cap ? Math.max(0, Math.min(def.count || 1, (cap[def.archetype] ?? 0) - taken(def))) : def.count || 1);
  const node = (i) => ({ lat: g.lat[i], lng: g.lng[i] });
  const spaced = (p, min, list) => list.every((q) => distance(p, q) >= min);
  for (const def of city.actors) {
    if (!def.enabled) continue;
    const rng = seededRandom(worldSeed, "spawn", def.id, dayId),
      count = room(def);
    if (!count) continue;
    for (const p of phases(def)) used[`${def.archetype}|${p}`] = (used[`${def.archetype}|${p}`] || 0) + count;
    if (def.homeFrom === "poi") {
      // Generic NPCs live at a seeded safe POI on the path graph, apart from
      // each other; with no usable POI they fall back to a seeded path point.
      const pool = [...(pois || [])];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let n = 1; n <= count; n++) {
        let home = null,
          poiId = null;
        for (const poi of pool) {
          const at = nearestNode(g, poi, 250);
          if (at < 0 || !spaced(node(at), MONSTER_SPACING_M, npcHomes)) continue;
          home = node(at);
          poiId = poi.id;
          pool.splice(pool.indexOf(poi), 1);
          break;
        }
        for (let tries = 0; !home && tries < 100; tries++) {
          const p = node(g.nodes[Math.floor(rng() * g.nodes.length)]);
          if (spaced(p, MONSTER_SPACING_M, npcHomes) || tries === 99) home = p;
        }
        npcHomes.push(home);
        out.push({ def, id: instanceId(def, n), home, ...(poiId ? { poi: { id: poiId } } : {}) });
      }
      continue;
    }
    if (def.archetype === "guardian") {
      // A guardian stands on the zone chest it guards, so beating it "drops"
      // the chest right where the fight was. Zones without a chest get none.
      const open = zones
        .filter((z) => z.placeStatus !== "closed" && Number.isFinite(z.chest?.lat) && Number.isFinite(z.chest?.lng))
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      let n = 0;
      for (const zone of open) {
        if (n >= count) break;
        const at = nearestNode(g, zone.chest, GUARDIAN_CHEST_RADIUS_M);
        if (at < 0 || !spaced(node(at), MONSTER_SPACING_M, monsters)) continue;
        n++;
        const instance = { def, id: instanceId(def, n), home: node(at), guards: { zoneId: zone.id, questId: zone.chest.questId } };
        out.push(instance);
        monsters.push(instance.home);
      }
      continue;
    }
    if (def.home) {
      for (let n = 1; n <= count; n++) {
        out.push({ def, id: instanceId(def, n), home: def.home });
        if (def.kind === "monster") monsters.push(def.home);
      }
      continue;
    }
    if (def.archetype === "lurker" && finds.length) {
      const pool = [...finds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const mine = [];
      let n = 1;
      for (const find of pool) {
        if (n > count) break;
        const at = nearestNode(g, find, LURKER_FIND_RADIUS_M);
        if (at < 0) continue;
        const p = node(at);
        if (!spaced(p, MONSTER_SPACING_M, mine) || !spaced(p, MONSTER_SPACING_M, monsters)) continue;
        mine.push(p);
        monsters.push(p);
        out.push({ def, id: instanceId(def, n), home: p, near: { findId: find.id } });
        n++;
      }
      continue;
    }
    // Seeded homes anywhere on the walkable graph.
    const spacing = def.archetype === "roamer" ? ROAMER_SPACING_M : MONSTER_SPACING_M;
    const mine = [];
    for (let tries = 0, n = 1; n <= count && tries < 400; tries++) {
      const p = node(homeNodes[Math.floor(rng() * homeNodes.length)]);
      if (!spaced(p, spacing, mine)) continue;
      if (def.kind === "monster" && !spaced(p, MONSTER_SPACING_M, monsters)) continue;
      mine.push(p);
      if (def.kind === "monster") monsters.push(p);
      out.push({ def, id: instanceId(def, n), home: p });
      n++;
    }
  }
  return out;
}
