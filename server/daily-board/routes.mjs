// HTTP routes for the daily board (docs/DAILY-BOARD.md):
//   GET  /api/daily-board?worldId=        today's three goals and progress
//   POST /api/daily-board/claim {worldId} the bonus XP, once per world day
export function createDailyBoardRoutes(board, db) {
  function world(worldId, assert) {
    assert(typeof worldId === "string" && worldId.length >= 1 && worldId.length <= 200, "Open today's map first.", 400, "WORLD_REQUIRED");
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(worldId);
    assert(row, "This map has ended. Refresh for today's world.", 404, "WORLD_NOT_FOUND");
    return JSON.parse(row.manifest);
  }
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (path !== "/api/daily-board" && path !== "/api/daily-board/claim") return false;
      if (!board) {
        respond(res, { enabled: false });
        return true;
      }
      assert(player, "Sign in to see today's board.", 401, "AUTH");
      if (path === "/api/daily-board" && method === "GET") {
        respond(res, board.view(player, world(url.searchParams.get("worldId") || "", assert)));
        return true;
      }
      if (path === "/api/daily-board/claim" && method === "POST") {
        const input = await body(req);
        respond(res, board.claim(player, world(String(input.worldId || ""), assert)));
        return true;
      }
      assert(false, "Not found.", 404, "NOT_FOUND");
    },
  };
}
