// Daily placement of actor instances (docs/NPC-PLAN.md §3, §13.1). Pure and
// deterministic: the same world seed, day, zones and closures give the same
// instances. NPCs with a home stay there; planned archetypes get a seeded home
// on the walkable graph; guardians stand at today's open zones.
import { distance } from "../domain.mjs";
import { instanceId } from "./definitions.mjs";
import { nearestNode, pathGraph, seededRandom } from "./schedule.mjs";

// At most one monster per this many metres (§13.1 density cap).
export const MONSTER_SPACING_M = 150;
const ROAMER_SPACING_M = 300;

/**
 * planSpawns(city, pack, worldSeed, dayId, { zones, closed })
 *   -> [{ def, id, home: {lat,lng}, guards? }]
 * `zones` are the world's zones with placeStatus; closed ones get no guardian.
 */
export function planSpawns(city, pack, worldSeed, dayId, { zones = [], closed = [] } = {}) {
  const g = pathGraph(pack, closed);
  if (!g.nodes.length) return [];
  const out = [],
    monsters = [];
  const node = (i) => ({ lat: g.lat[i], lng: g.lng[i] });
  const spaced = (p, min, list) => list.every((q) => distance(p, q) >= min);
  for (const def of city.actors) {
    if (!def.enabled) continue;
    const rng = seededRandom(worldSeed, "spawn", def.id, dayId),
      count = def.count || 1;
    if (def.archetype === "guardian") {
      const open = zones
        .filter((z) => z.placeStatus !== "closed" && Number.isFinite(z.lat))
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      let n = 0;
      for (const zone of open) {
        if (n >= count) break;
        const anchor = zone.walking?.entry || { lat: zone.lat, lng: zone.lng };
        const at = nearestNode(g, anchor, 250);
        if (at < 0 || !spaced(node(at), MONSTER_SPACING_M, monsters)) continue;
        n++;
        const instance = { def, id: instanceId(def, n), home: node(at), guards: { zoneId: zone.id } };
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
    // Seeded homes anywhere on the walkable graph.
    const spacing = def.archetype === "roamer" ? ROAMER_SPACING_M : MONSTER_SPACING_M;
    const mine = [];
    for (let tries = 0, n = 1; n <= count && tries < 400; tries++) {
      const p = node(g.nodes[Math.floor(rng() * g.nodes.length)]);
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
