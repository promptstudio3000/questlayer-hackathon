// HTTP routes for GOLD spending and place messages (docs/GOLD-SPENDING.md):
//   GET  /api/gold/shop                       catalog, prices, what the player owns
//   POST /api/gold/buy {sku}                  unlock a premium emote or a cosmetic (burn)
//   POST /api/gold/equip {frame}              wear an unlocked marker frame (null = none)
//   POST /api/gold/emote {emote}              show an emote above the character
//   POST /api/gold/gear {actorId, encounter, edition}   trader premium gear (burn, then the Aura)
//   POST /api/gold/lure/quote {worldId, fix}  lure options where the player stands
//   POST /api/gold/lure {worldId, fix, kind, actorId?}  set a 30-minute lure (burn)
//   GET  /api/gold/map?lat=&lng=              lures and place-message pins nearby
//   GET  /api/gold/burns                      public burn totals
//   GET  /api/places?lat=&lng=&radiusKm=&sort=   the local feed
//   POST /api/places {kind, text, title?, days, lat, lng, fix?, arena, publicConsent}
//   GET  /api/places/:id                      open a shout or topic (counts a read)
//   POST /api/places/:id/extend {days}        pay more days
//   POST /api/places/:id/posts {text}         write in a topic
//   POST /api/places/:id/report {reason}      report a message or post
//   DELETE /api/places/:id                    the author removes a message or post
//   POST /api/places/follow {playerId, on}    follow an author for the Following feed
//   POST /api/places/:id/social/prepare|confirm {accountId, ...}   NEAR Social record
const ONE = /^\/api\/places\/((?:place|post)_[a-f0-9-]{36})(?:\/(extend|posts|report|social\/prepare|social\/confirm))?$/;

export function createGoldSpendRoutes({ gold, places, social, linkedAccount = () => null }, { rates = new Map() } = {}) {
  function limit(key, max, assert) {
    const k = `${key}:${Math.floor(Date.now() / 60_000)}`,
      n = (rates.get(k) || 0) + 1;
    rates.set(k, n);
    if (rates.size > 5000) for (const old of rates.keys()) if (!old.endsWith(`:${Math.floor(Date.now() / 60_000)}`)) rates.delete(old);
    assert(n <= max, "Please wait a moment before trying again.", 429, "RATE_LIMITED");
  }
  const num = (url, k) => {
    const v = url.searchParams.get(k);
    return v === null ? NaN : Number(v);
  };
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/gold/") && path !== "/api/places" && !path.startsWith("/api/places/")) return false;
      if (path === "/api/gold/burns" && method === "GET") {
        respond(res, gold.burns());
        return true;
      }
      assert(player, "Sign in first.", 401, "AUTH");
      limit(`gold:${player}`, 120, assert);
      if (path === "/api/gold/shop" && method === "GET") return respond(res, gold.shop(player)), true;
      if (path === "/api/gold/buy" && method === "POST") return respond(res, gold.buy(player, await body(req))), true;
      if (path === "/api/gold/equip" && method === "POST") return respond(res, gold.equip(player, await body(req))), true;
      if (path === "/api/gold/emote" && method === "POST") {
        limit(`emote:${player}`, 12, assert);
        return respond(res, gold.emote(player, await body(req))), true;
      }
      if (path === "/api/gold/gear" && method === "POST") return respond(res, await gold.buyGear(player, await body(req))), true;
      if (path === "/api/gold/lure/quote" && method === "POST") return respond(res, gold.lureQuote(player, await body(req))), true;
      if (path === "/api/gold/lure" && method === "POST") {
        limit(`lure:${player}`, 6, assert);
        return respond(res, gold.setLure(player, await body(req)), 201), true;
      }
      if (path === "/api/gold/map" && method === "GET") {
        const here = { lat: num(url, "lat"), lng: num(url, "lng") };
        assert(Number.isFinite(here.lat) && Number.isFinite(here.lng), "Invalid location.");
        return respond(res, { lures: gold.luresNear(player, here), places: places.pins(player, here), now: Date.now() }), true;
      }
      if (path === "/api/places" && method === "GET")
        return (
          respond(
            res,
            places.feed(player, {
              lat: num(url, "lat"),
              lng: num(url, "lng"),
              radiusKm: Number(url.searchParams.get("radiusKm") || 3),
              sort: url.searchParams.get("sort") || "latest",
            }),
          ),
          true
        );
      if (path === "/api/places" && method === "POST") {
        limit(`place:${player}`, 6, assert);
        return respond(res, places.create(player, await body(req)), 201), true;
      }
      if (path === "/api/places/follow" && method === "POST") {
        const i = await body(req);
        return respond(res, places.follow(player, i.playerId, i.on !== false)), true;
      }
      const one = ONE.exec(path);
      assert(one, "Not found.", 404, "NOT_FOUND");
      const [, targetId, action] = one;
      if (!action && method === "GET") return respond(res, places.open(player, targetId)), true;
      if (!action && method === "DELETE") return respond(res, places.remove(player, targetId)), true;
      if (action === "extend" && method === "POST") return respond(res, places.extend(player, targetId, await body(req))), true;
      if (action === "posts" && method === "POST") return respond(res, places.post(player, targetId, await body(req)), 201), true;
      if (action === "report" && method === "POST") return respond(res, places.report(player, targetId, await body(req))), true;
      if (action?.startsWith("social/") && method === "POST") {
        const i = await body(req);
        const accountId = linkedAccount(player, i.accountId);
        assert(accountId, "Link a NEAR account first.", 409, "NO_ACCOUNT");
        const result = action === "social/prepare" ? await social.prepare(player, accountId, { ...i, targetId }) : await social.confirm(player, accountId, { ...i, targetId });
        return respond(res, result), true;
      }
      assert(false, "Not found.", 404, "NOT_FOUND");
    },
  };
}
