// Demo zone layout (docs/DEMO-ZONES.md).
//
// DEMO_ZONES=plzen-compact (set in deploy/questlayer-hackathon.service for the
// testnet demo) changes Plzeň in two ways so a visitor sees everything in a
// short walk from náměstí Republiky:
//   1. The six daily zones come from server/data/demo-zones/plzen-compact.json
//      (the ring of parks around the square, all within ~400 m) instead of the
//      citywide reviewed candidates.
//   2. Every zone, the rarer ones too, is open the whole local day: no
//      opening countdown.
// The NPCs and monsters of a compact world also stay near the centre
// (server/actors/service.mjs).
//
// Switching back for the final product: delete the DEMO_ZONES line from the
// unit (or set DEMO_ZONES=off) and redeploy. The next world uses the normal
// citywide zones with their rarity windows. Mainnet refuses to start with it.
import { readFileSync } from "node:fs";

export const DEMO_ZONE_LAYOUTS = Object.freeze({
  "plzen-compact": { cityId: "plzen", file: "plzen-compact.json" },
});
const cache = new Map();

/** The configured layout name, or null when the normal layout applies. */
export function demoZoneMode(env = process.env, network = env.NEAR_NETWORK || "testnet") {
  const flag = env.DEMO_ZONES;
  if (flag === undefined || flag === "" || flag === "off" || flag === "0") return null;
  if (!DEMO_ZONE_LAYOUTS[flag])
    throw new Error(`DEMO_ZONES must be off or one of: ${Object.keys(DEMO_ZONE_LAYOUTS).join(", ")}.`);
  if (network === "mainnet") throw new Error("DEMO_ZONES is only allowed on testnet.");
  return flag;
}

function loadLayout(name) {
  if (!cache.has(name)) {
    const entry = DEMO_ZONE_LAYOUTS[name],
      layout = JSON.parse(
        readFileSync(new URL(`./data/demo-zones/${entry.file}`, import.meta.url), "utf8"),
      );
    if (layout.version !== 1 || layout.cityId !== entry.cityId || !Array.isArray(layout.candidates))
      throw new Error(`Demo zone layout ${name} is invalid.`);
    cache.set(name, Object.freeze(layout));
  }
  return cache.get(name);
}

/** The active demo layout for a city, or null. */
export function demoLayoutFor(cityId, env = process.env) {
  let mode;
  try {
    mode = demoZoneMode(env);
  } catch {
    // An invalid or mainnet flag is refused at startup; here it means "off".
    return null;
  }
  if (!mode || DEMO_ZONE_LAYOUTS[mode].cityId !== cityId) return null;
  return loadLayout(mode);
}

/**
 * The city pack the day planner uses. With a demo layout its candidates are
 * replaced and `demoZones` tells the planner to keep every zone open all day.
 * The changed pack also changes the plan's source hash, so a stored citywide
 * plan is never reused for a compact day (and the other way round).
 */
export function withDemoZones(pack, env = process.env) {
  const layout = pack && demoLayoutFor(pack.id, env);
  if (!layout) return pack;
  return {
    ...pack,
    candidates: layout.candidates,
    demoZones: {
      layout: layout.layout,
      alwaysOpen: true,
      zoneGapM: layout.zoneGapM,
      center: layout.center,
    },
  };
}

/** World id suffix, so a compact world never reuses today's citywide world. */
export function demoWorldSuffix(cityId, env = process.env) {
  return demoLayoutFor(cityId, env) ? "-compact" : "";
}

// Actors of a compact world: walkers stay within ACTOR_RANGE_M of their
// home and seeded homes sit within ACTOR_HOME_RADIUS_M of the centre, so the
// trader, the pilgrim, roamers and the wisp are a short walk away too.
export const ACTOR_RANGE_M = 250;
export const ACTOR_HOME_RADIUS_M = 400;
export function compactActorCast(cast) {
  return {
    ...cast,
    actors: cast.actors.map((def) =>
      def.rangeM > ACTOR_RANGE_M ? { ...def, rangeM: ACTOR_RANGE_M } : def,
    ),
  };
}
