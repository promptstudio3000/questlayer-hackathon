// HTTP routes for the task market, Secrets and conditional transfers.
// Mounted after session auth: `player` is the signed-in explorer.
import * as market from "./service.mjs";
import { accountOf, checkFunding, escrowConfig, pendingFunding } from "./chain.mjs";

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export function createMarketRoutes({ db, isModerator = () => false, clock = Date.now, escrowView = null, tokenView = null } = {}) {
  market.ensureMarketSchema(db);
  return {
    async handle(req, res, url, { player, body, respond, assert }) {
      const path = url.pathname,
        method = req.method || "GET";
      if (!path.startsWith("/api/market/")) return false;
      const now = clock();
      const send = (data, status = 200) => (respond(res, data, status), true);
      const q = url.searchParams;
      const route = path.slice("/api/market/".length);

      if (route === "funding-intent" && method === "GET") {
        const funding = pendingFunding(db, String(q.get("id") ?? ""), player);
        assert(funding, "This funding request is no longer pending for this player.", 404);
        return send(funding);
      }

      if (route === "nearby" && method === "GET") {
        const view = market.nearby(db, player, { lat: num(q.get("lat")), lng: num(q.get("lng")) }, now);
        // Spendable QGOLD = the token balance of the player's own account.
        const account = accountOf(db, player);
        let balance = null;
        if (account && tokenView)
          balance = await tokenView("ft_balance_of", { account_id: account })
            .then((v) => Number(v))
            .catch(() => null);
        return send({ ...view, wallet: { account, balance } });
      }
      if (route === "stats" && method === "GET") return send({ ...market.marketStats(db), invariant: market.marketInvariant(db) });
      if (route === "escrow" && method === "GET") {
        const c = escrowConfig();
        return send({ enabled: !!c, contractId: c?.contractId ?? null, tokenId: c?.tokenId ?? null });
      }

      // ---- tasks
      if (route === "tasks" && method === "POST") return send(market.createTask(db, player, await body(req), now), 201);
      if (route === "task" && method === "GET")
        return send({ task: market.getTask(db, player, q.get("id"), q.get("k") || undefined, now) });
      const i = method === "POST" ? await body(req) : {};
      switch (method === "POST" ? route : "") {
        // ---- the player signed a funding ft_transfer_call
        case "funded":
          assert(escrowView, "Paying with QGOLD is not open yet.", 503);
          return send(await checkFunding(db, String(i.id ?? ""), player, { view: escrowView, activate: market.ACTIVATE, now }));
        case "task/reserve":
          return send(market.reserveTask(db, player, i.taskId, { linkKey: i.k, offer: i.offer }, now));
        case "task/accept-offer":
          return send(market.acceptOffer(db, player, i.claimId, now));
        case "task/submit":
          return send(market.submitClaim(db, player, i.claimId, i, now));
        case "task/review":
          return send(market.reviewClaim(db, player, i.claimId, i.approve === true, i.reason, now));
        case "task/dispute":
          return send(market.disputeClaim(db, player, i.claimId, i.reason, now));
        case "task/resolve":
          assert(isModerator(player), "Only a moderator can resolve disputes.", 403);
          return send(market.resolveDispute(db, i.claimId, i.pay === true, now));
        case "task/cancel":
          return send(market.cancelTask(db, player, i.taskId, now));
        case "task/message":
          return send(market.postMessage(db, player, i.taskId, i, now), 201);
        case "task/rate":
          return send(market.rateClaim(db, player, i.claimId, i.stars, i.comment, now));
        // ---- secrets
        case "secrets":
          return send(market.createSecret(db, player, i, now), 201);
        case "secret/reveal":
          return send(market.revealSecret(db, player, i.secretId, { linkKey: i.k }, now));
        case "secret/visit":
          return send(market.visitSecret(db, player, i.secretId, i.fix, now));
        case "secret/dispute":
          return send(market.disputeReveal(db, player, i.secretId, i.reason, now));
        case "secret/resolve":
          assert(isModerator(player), "Only a moderator can resolve disputes.", 403);
          return send(market.resolveReveal(db, i.revealId, i.refund === true, now));
        case "secret/close":
          return send(market.closeSecret(db, player, i.secretId, now));
        // ---- conditional transfers (no fee)
        case "transfers":
          return send(market.createTransfer(db, player, i, now), 201);
        case "transfer/act":
          return send(market.actOnTransfer(db, player, i.transferId, i.action, i, now));
      }
      if (route === "secret" && method === "GET") {
        const from = { lat: num(q.get("lat")), lng: num(q.get("lng")) };
        return send({
          secret: market.getSecret(db, player, q.get("id"), {
            linkKey: q.get("k") || undefined,
            from: Number.isFinite(from.lat) && Number.isFinite(from.lng) ? from : null,
          }, now),
        });
      }
      if (route === "transfers" && method === "GET") return send({ transfers: market.listTransfers(db, player, now) });
      return false;
    },
  };
}
