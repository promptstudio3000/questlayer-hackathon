// HTTP routes for badges (docs/BADGES.md):
//   GET  /api/badges?lat=&lng=          place badges (earned + nearest) and player badges
//   POST /api/badges/check {fix}         award place badges for a fresh GPS fix
//   POST /api/badges/user {...}          create a player badge (queued for NEAR)
//   POST /api/badges/user/claim {...}    claim a player badge (place fix, event code or quest)
//   GET  /api/badges/user/:id            one player badge
const ONE = /^\/api\/badges\/user\/([a-z0-9-]{3,48})$/;

export function createBadgeRoutes(badges, { rates = new Map() } = {}) {
  function limit(key, max, assert) {
    const k = `${key}:${Math.floor(Date.now() / 60_000)}`,
      n = (rates.get(k) || 0) + 1;
    rates.set(k, n);
    assert(n <= max, "Please wait a moment before trying again.", 429, "RATE_LIMITED");
  }
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path !== "/api/badges" && !path.startsWith("/api/badges/")) return false;
      if (!badges) {
        respond(res, { enabled: false });
        return true;
      }
      assert(player, "Sign in to see your badges.", 401, "AUTH");
      if (path === "/api/badges" && method === "GET") {
        const lat = url.searchParams.get("lat"),
          lng = url.searchParams.get("lng");
        const at = lat !== null && lng !== null ? { lat: Number(lat), lng: Number(lng) } : null;
        respond(res, { enabled: true, ...badges.overview(player, at) });
        return true;
      }
      if (path === "/api/badges/check" && method === "POST") {
        limit(`badge-check:${player}`, 20, assert);
        const input = await body(req);
        respond(res, badges.check(player, input.fix));
        return true;
      }
      if (path === "/api/badges/user" && method === "POST") {
        limit(`badge-create:${player}`, 5, assert);
        respond(res, badges.createUserBadge(player, await body(req)));
        return true;
      }
      if (path === "/api/badges/user/claim" && method === "POST") {
        limit(`badge-claim:${player}`, 10, assert);
        respond(res, badges.claimUserBadge(player, await body(req)));
        return true;
      }
      const one = ONE.exec(path);
      if (one && method === "GET") {
        respond(res, badges.userBadge(player, one[1]));
        return true;
      }
      assert(false, "Not found.", 404, "NOT_FOUND");
    },
  };
}
