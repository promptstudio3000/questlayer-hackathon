/** Reuses the authenticated game session; request bodies cannot select an actor. */
export function createWorkshopRoutes({ store, authenticate, actorFor }) {
  return {
    async handle(req, res, url, ctx) {
      if (!url.pathname.startsWith("/api/gotchiverse/")) return false;
      const route = url.pathname.slice("/api/gotchiverse/".length),
        method = req.method;
      let input = null;
      if (method === "POST") {
        ctx.assert(
          /^application\/json(?:\s*;|$)/i.test(
            req.headers["content-type"] || "",
          ),
          "JSON is required.",
          415,
        );
        ctx.assert(
          req.headers["sec-fetch-site"] !== "cross-site",
          "Request origin is not allowed.",
          403,
        );
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          ctx.assert(size <= 8192, "This workshop request is too large.", 413);
          chunks.push(chunk);
        }
        try {
          input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        } catch {
          ctx.assert(false, "Invalid request.");
        }
        ctx.assert(
          input && typeof input === "object" && !Array.isArray(input),
          "Invalid request.",
        );
      }
      // A logout while the request body streams must invalidate a new write.
      ctx.assert(
        authenticate(req) === ctx.player,
        "Please sign in again.",
        401,
      );
      const actor = actorFor(ctx.player);
      let result;
      if (route === "open" && method === "POST")
        result = { workshop: store.open(actor) };
      else if (route === "workshop" && method === "GET")
        result = { workshop: store.get(actor, url.searchParams.get("id")) };
      else if (route === "edit" && method === "POST")
        result = store.edit(actor, input);
      else if (route === "invite" && method === "POST")
        result = store.invite(actor, input.workshopId);
      else if (route === "join" && method === "POST")
        result = { workshop: store.join(actor, input.token) };
      else if (route === "revoke" && method === "POST")
        result = {
          workshop: store.revoke(actor, input.workshopId, input.memberId),
        };
      else if (route === "visit" && method === "POST")
        result = {
          workshop: store.visit(
            actor,
            input.workshopId,
            input.position,
            input.leave === true,
          ),
        };
      else {
        ctx.assert(false, "Not found.", 404);
      }
      ctx.respond(res, result, 200, {
        "Cache-Control": "private,no-store",
        Vary: "Cookie",
      });
      return true;
    },
  };
}
