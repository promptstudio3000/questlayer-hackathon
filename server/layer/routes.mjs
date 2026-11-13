// /api/layer/* (docs/LAYER.md). Reuses the authenticated game session; a
// request body can never select the acting explorer.
import { LAYER_REGISTRY, publicLayer } from "./layers.mjs";

export function createLayerRoutes({ store, authenticate, actorFor }) {
  return {
    async handle(req, res, url, ctx) {
      if (!url.pathname.startsWith("/api/layer/")) return false;
      const route = url.pathname.slice("/api/layer/".length),
        method = req.method;
      let input = null;
      if (method === "POST") {
        ctx.assert(
          /^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""),
          "JSON is required.",
          415,
        );
        ctx.assert(req.headers["sec-fetch-site"] !== "cross-site", "Request origin is not allowed.", 403);
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          ctx.assert(size <= 8192, "This layer request is too large.", 413);
          chunks.push(chunk);
        }
        try {
          input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {
          ctx.assert(false, "Invalid request.");
        }
        ctx.assert(input && typeof input === "object" && !Array.isArray(input), "Invalid request.");
      }
      // A logout while the body streams must invalidate the write.
      ctx.assert(ctx.player && authenticate(req) === ctx.player, "Please sign in again.", 401);
      const actor = actorFor(ctx.player);
      const q = (name) => url.searchParams.get(name);
      let result;
      if (route === "layers" && method === "GET") result = { layers: LAYER_REGISTRY.map(publicLayer) };
      else if (route === "expedition/enter" && method === "POST") result = store.expedition.enter(actor, input.layer, input.plaza === true);
      else if (route === "expedition/state" && method === "GET") result = store.expedition.snapshot(actor, q("layer"), Number(q("x")), Number(q("z")));
      else if (route === "expedition/start" && method === "POST") result = store.expedition.startQuest(actor, input);
      else if (route === "expedition/edit" && method === "POST") result = store.expedition.edit(actor, input);
      else if (route === "expedition/mine-start" && method === "POST") result = store.expedition.startMining(actor, input);
      else if (route === "expedition/mine-finish" && method === "POST") result = store.expedition.finishMining(actor, input);
      else if (route === "expedition/interact" && method === "POST") result = store.expedition.interact(actor, input);
      else if (route === "expedition/activity" && method === "GET") result = store.expedition.activity(actor, q("layer"));
      else if (route === "expedition/verify" && method === "POST") result = await store.expedition.verifyAction(actor, input);
      else if (route === "home" && method === "POST") {
        const home = store.home(actor, input.layer);
        result = { ...home, progress: store.progress(actor, input.layer) };
      } else if (route === "plots" && method === "GET")
        result = { plots: store.plotsNear(q("layer"), Number(q("x")), Number(q("z"))) };
      else if (route === "plot" && method === "GET") result = store.plot(q("id"));
      else if (route === "edit" && method === "POST") result = store.edit(actor, input);
      else if (route === "presence" && method === "POST") result = store.visit(actor, input);
      else if (route === "leave" && method === "POST") result = store.leave(actor, input.layer);
      else ctx.assert(false, "Not found.", 404);
      ctx.respond(res, result, 200, { "Cache-Control": "private,no-store", Vary: "Cookie" });
      return true;
    },
  };
}
