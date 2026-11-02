// HTTP routes for the hackathon season (docs/SEASON.md):
//   GET  /api/season         public standings, pot meter; your row when signed in
//   POST /api/season/claim   the season mark (and Aura), once per explorer
export function createSeasonRoutes(season) {
  return {
    async handle(req, res, url, { player, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path !== "/api/season" && path !== "/api/season/claim") return false;
      if (!season) {
        respond(res, { enabled: false });
        return true;
      }
      if (path === "/api/season" && method === "GET") {
        respond(res, season.view(player || null));
        return true;
      }
      if (path === "/api/season/claim" && method === "POST") {
        assert(player, "Sign in to claim the season mark.", 401, "AUTH");
        respond(res, season.claim(player));
        return true;
      }
      assert(false, "Not found.", 404, "NOT_FOUND");
    },
  };
}
