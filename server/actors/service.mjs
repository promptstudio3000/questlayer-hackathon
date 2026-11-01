// Actor service: lists today's NPCs and monsters and issues encounter tokens.
// Interface stub for the parallel slices; schedule, spawns and the presence
// checks land in the N0/M0 implementation PR.
import { assert } from "../domain.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "./schema.mjs";

export const ENCOUNTER_TTL_MS = 5 * 60_000;
export const ENCOUNTER_RADIUS_M = 35;
export const STATION_RADIUS_M = 50;
export const MAX_GPS_ACCURACY_M = 30;
export const MAX_SPEED_MPS = 15;

export function actorsEnabled(env = process.env) {
  return env.ACTORS_ENABLED === "1";
}

export function createActorService(db, options = {}) {
  ensureModuleVersion(db, ACTORS_SCHEMA);
  const clock = options.clock || Date.now;
  return {
    async list() {
      return { enabled: true, worldId: null, dayId: null, now: clock(), actors: [] };
    },
    async encounter() {
      assert(false, "Characters are not on the map yet.", 501, "ACTORS_NOT_READY");
    },
    // For /talk, /offers and /challenge routes: returns
    // {encounterId, actor: ActorView, def: ActorDefinition, worldId, dayId, seed, menu, menuHash}
    // or throws 401/403/404/410.
    requireEncounter({ token }) {
      assert(typeof token === "string" && token.startsWith("enc_"), "Meet the character first.", 403, "ENCOUNTER_REQUIRED");
      assert(false, "This meeting has ended. Walk up to them again.", 410, "ENCOUNTER_EXPIRED");
    },
  };
}
