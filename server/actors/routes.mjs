// HTTP routes for roaming NPCs and monsters (docs/NPC-PLAN.md §14).
//   GET  /api/actors?worldId=&lat=&lng=     -> ActorsResponse
//   POST /api/actors/:id/encounter {worldId, location} -> ActorEncounter
// Later slices add /talk, /offers/:offerId/accept and /challenge routes; they
// verify the encounter token with service.requireEncounter().
const ACTOR_PATH = /^\/api\/actors\/([a-z0-9-]{3,44})\/encounter$/;

export function createActorRoutes(service) {
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path !== "/api/actors" && !path.startsWith("/api/actors/"))
        return false;
      if (path === "/api/actors" && method === "GET") {
        if (!service) {
          respond(res, { enabled: false, worldId: null, dayId: null, now: Date.now(), actors: [] });
          return true;
        }
        const lat = url.searchParams.get("lat"),
          lng = url.searchParams.get("lng");
        respond(
          res,
          await service.list({
            player,
            worldId: url.searchParams.get("worldId") || "",
            location:
              lat !== null && lng !== null
                ? { lat: Number(lat), lng: Number(lng) }
                : null,
          }),
        );
        return true;
      }
      const match = path.match(ACTOR_PATH);
      if (match && method === "POST") {
        assert(service, "Characters on the map are not enabled here.", 503, "ACTORS_DISABLED");
        const input = await body(req);
        respond(
          res,
          await service.encounter({
            player,
            actorId: match[1],
            worldId: typeof input.worldId === "string" ? input.worldId : "",
            location: input.location,
          }),
        );
        return true;
      }
      return false;
    },
  };
}
