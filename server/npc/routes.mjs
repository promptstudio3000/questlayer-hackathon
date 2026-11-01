// NPC conversation and quest routes (N1+N2). Every call needs a live
// encounter token from POST /api/actors/:id/encounter, which proves the
// player is standing next to the character.
//   POST /api/actors/:id/talk                        {encounter, message}
//   POST /api/actors/:id/offers/:offerId/accept      {encounter}
//   POST /api/actors/:id/offers/:offerId/complete    {encounter}
//   POST /api/actors/:id/greet                       {encounter}
import { worldView } from "../world.mjs";

const TALK = /^\/api\/actors\/([a-z0-9-]{3,44})\/(talk|greet)$/;
const OFFER = /^\/api\/actors\/([a-z0-9-]{3,44})\/offers\/((?:quest|chapter):[0-9a-f]{16})\/(accept|complete)$/;

export function createNpcRoutes(npc, actors, db) {
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname;
      if ((req.method || "GET") !== "POST" || !path.startsWith("/api/actors/")) return false;
      const talk = path.match(TALK),
        offer = path.match(OFFER);
      if (!talk && !offer) return false;
      assert(npc && actors, "Characters on the map are not enabled here.", 503, "ACTORS_DISABLED");
      const input = await body(req);
      const actorId = (talk || offer)[1];
      const encounter = await actors.requireEncounter({ token: input.encounter, player, actorId });
      assert(encounter.actor?.kind !== "monster", "This character does not talk.", 404, "NPC_UNKNOWN");
      const world = worldView(db, encounter.worldId, player);
      assert(world, "This day has ended.", 410, "ENCOUNTER_EXPIRED");
      const actor = { ...encounter.def, ...encounter.actor, persona: encounter.def?.persona };
      if (talk?.[2] === "greet") respond(res, npc.greet({ player, actor, world, encounter }));
      else if (talk) respond(res, await npc.talk({ player, actor, world, encounter, message: input.message }));
      else if (offer[3] === "accept") respond(res, npc.accept({ player, actor, world, encounter, offerId: offer[2] }));
      else respond(res, npc.complete({ player, actor, world, offerId: offer[2] }));
      return true;
    },
  };
}
