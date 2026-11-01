// HTTP routes for monster challenges (§14 encounter flow):
//   GET  /api/actors/:id/challenge?encounter=   formats on offer, status, level
//   POST /api/actors/:id/challenge               {encounter, format} -> challenge
//   POST /api/actors/:id/challenge/:cid/submit   {answers | taps | samples}
//   POST /api/actors/:id/challenge/:cid/round    {stance, tapOffsetMs}
import { ChallengeError } from "./service.mjs";

const ROUTE = /^\/api\/actors\/([a-z0-9-]{3,40})\/challenge(?:\/(chl_[A-Za-z0-9_-]{8,40})\/(submit|round))?$/;

export function createChallengeRoutes(service) {
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const m = ROUTE.exec(url.pathname);
      if (!m) return false;
      assert(service, "Monster challenges are not enabled on this host.", 503, "ACTORS_DISABLED");
      const [, actorId, challengeId, action] = m;
      const method = req.method || "GET";
      try {
        if (!challengeId && method === "GET") {
          respond(res, await service.menu({ player, actorId, encounter: url.searchParams.get("encounter") || "" }));
          return true;
        }
        if (!challengeId && method === "POST") {
          const input = await body(req);
          respond(res, await service.start({ player, actorId, encounter: String(input.encounter || ""), format: String(input.format || "") }));
          return true;
        }
        if (action === "submit" && method === "POST") {
          const input = await body(req);
          respond(res, service.submit({ player, actorId, challengeId, input }));
          return true;
        }
        if (action === "round" && method === "POST") {
          const input = await body(req);
          respond(res, service.round({ player, actorId, challengeId, stance: String(input.stance || ""), tapOffsetMs: input.tapOffsetMs }));
          return true;
        }
      } catch (error) {
        if (error instanceof ChallengeError) assert(false, error.message, error.status, error.code);
        if (error instanceof RangeError) assert(false, "That move is not allowed.", 400, "INPUT");
        throw error;
      }
      return false;
    },
  };
}
