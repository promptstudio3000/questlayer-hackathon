// HTTP routes for the monster hunt (slices M3 + M4):
//   GET  /api/hunt?worldId=                 shards, roll tickets, craft status, this week's boss
//   POST /api/hunt/craft                    {worldId, recipe?, itemId?} -> an altar recipe edition
//   GET  /api/hunt/boss?worldId=            event page: HP, schedule, arena, leaderboard
//   POST /api/actors/:id/boss               {encounter} -> a seeded boss-hit mini-game
//   POST /api/actors/:id/boss/:hitId        {taps | samples} -> damage and shared HP
import { positionAt } from "../schedule.mjs";

const HIT = /^\/api\/actors\/([a-z0-9-]{3,40})\/boss(?:\/(bhit_[A-Za-z0-9_-]{8,40}))?$/;

export function createHuntRoutes(hunt, actorService, db) {
  function world(worldId, assert) {
    assert(typeof worldId === "string" && worldId.length >= 1 && worldId.length <= 200, "Open today's map first.", 400, "WORLD_REQUIRED");
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(worldId);
    assert(row, "This map has ended. Refresh for today's world.", 404, "WORLD_NOT_FOUND");
    return JSON.parse(row.manifest);
  }

  function bossPage(manifest, player) {
    const plan = actorService.planFor(manifest);
    const inst = plan?.instances.find((i) => i.def.archetype === "boss");
    if (!inst) return null;
    const t = Date.now();
    const out = hunt.boss.event(manifest.cityId, manifest.day, inst.id, player);
    const next = inst.segments.find((s) => s.to > t);
    return {
      ...out,
      name: inst.def.name,
      model: inst.def.model,
      element: inst.def.element,
      home: inst.home,
      arena: { model: "great-portal", ...inst.home },
      outNow: !!positionAt(inst.segments, t),
      ...(next ? { nextWindow: { from: Math.max(next.from, t), to: next.to } } : {}),
    };
  }

  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      const hit = HIT.exec(path);
      if (!hit && !path.startsWith("/api/hunt")) return false;
      assert(hunt, "Monster hunting is not enabled on this host.", 503, "ACTORS_DISABLED");
      if (path === "/api/hunt" && method === "GET") {
        assert(player, "Sign in to see your hunt.", 401, "AUTH");
        const manifest = world(url.searchParams.get("worldId") || "", assert);
        respond(res, { ...hunt.rewards.summary(player, manifest.day), boss: bossPage(manifest, player) });
        return true;
      }
      if (path === "/api/hunt/boss" && method === "GET") {
        const manifest = world(url.searchParams.get("worldId") || "", assert);
        respond(res, { boss: bossPage(manifest, player) });
        return true;
      }
      if (path === "/api/hunt/craft" && method === "POST") {
        const input = await body(req);
        const manifest = world(String(input.worldId || ""), assert);
        const crafted = hunt.rewards.craft(player, { itemId: input.itemId ? String(input.itemId) : undefined, recipe: input.recipe ? String(input.recipe).slice(0, 40) : undefined, dayId: manifest.day });
        respond(res, { crafted, ...hunt.rewards.summary(player, manifest.day) });
        return true;
      }
      if (hit && method === "POST") {
        const [, actorId, hitId] = hit;
        const input = await body(req);
        if (!hitId) respond(res, await hunt.boss.start({ player, actorId, encounter: String(input.encounter || "") }));
        else respond(res, hunt.boss.submit({ player, actorId, hitId, input }));
        return true;
      }
      return false;
    },
  };
}
