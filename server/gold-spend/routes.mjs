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
//   POST /api/gold/burn/prepare {kind, amountU}   the ft_burn call to sign (QGOLD realm)
//   POST /api/gold/burn/confirm {txHash}          verify that burn and keep it as a credit
//   GET  /api/places?lat=&lng=&radiusKm=&sort=   the local feed
//   POST /api/places {kind, text, title?, days, lat, lng, fix?, arena, publicConsent}
//   GET  /api/places/:id                      open a shout or topic (counts a read)
//   POST /api/places/:id/extend {days}        pay more days
//   POST /api/places/:id/posts {text}         write in a topic
//   POST /api/places/:id/report {reason}      report a message or post
//   DELETE /api/places/:id                    the author removes a message or post
//   POST /api/places/follow {playerId, on}    follow an author for the Following feed
//   POST /api/places/:id/social/prepare|confirm {accountId, ...}   NEAR Social record
import { BURN_KINDS, spendRealm } from "./ledger.mjs";
import { confirmQgoldBurn, ensureQgoldBurns, prepareQgoldBurn } from "./qgold-burn.mjs";

import { runPurchase, purchaseRow } from "./purchases.mjs";
import { atomic } from "../database.mjs";
import { GameError } from "../domain.mjs";

const ONE = /^\/api\/places\/((?:place|post)_[a-f0-9-]{36}|seed-pt-[a-z0-9-]{1,40})(?:\/(extend|posts|report|social\/prepare|social\/confirm))?$/;

export function createGoldSpendRoutes(
  { gold, places, social, linkedAccount = () => null, qgold = null, db = null },
  { rates = new Map() } = {},
) {
  // Created up front: a spend's transaction may roll back the first use.
  if (db) ensureQgoldBurns(db);
  // QGOLD realm: balances are the player's QGOLD on chain, spends are burns.
  const onChain = () => spendRealm() === "qgold" && qgold;
  const purchase = async (req, player, path, input, work) => {
    if (!onChain()) return work();
    const id = req.headers["x-questlayer-purchase"];
    try {
      return await runPurchase(db, { player, id, path, input }, work);
    } catch (error) {
      if (error.code === "QGOLD_BURN") await refuseShortBurn(player, id, error);
      throw error;
    }
  };
  // A burn the player's QGOLD cannot cover only fails on chain, so the
  // shortfall is caught before anything is signed and the purchase released.
  async function refuseShortBurn(player, id, error) {
    const needU = Number(error.details?.amountU), purchase = error.details?.purchaseId;
    if (!Number.isSafeInteger(needU) || needU <= 0 || !purchase) return;
    let haveU;
    try {
      haveU = await qgold.balanceU(player);
    } catch {
      return; // the burn itself still checks the balance on chain
    }
    if (!Number.isFinite(haveU) || haveU >= needU) return;
    const released = atomic(db, () => {
      const p = db.prepare("SELECT * FROM qgold_purchases WHERE id=? AND player_id=?").get(purchase, player);
      if (!p || p.state !== "new" || p.memo || p.relay_job_id || p.tx_hash) return false;
      db.prepare("DELETE FROM qgold_purchase_aliases WHERE purchase_id=?").run(p.id);
      db.prepare("DELETE FROM qgold_purchases WHERE id=?").run(p.id);
      return true;
    });
    if (!released) return;
    const short = new GameError("Not enough QGOLD in your account.", 402, "QGOLD_SHORT");
    short.details = { needU, haveU, purchaseReleased: id };
    throw short;
  }
  // The linked NEAR account that holds the most QGOLD pays (a player can
  // link a second wallet, and the newest link may still be empty).
  async function spendable(player) {
    if (qgold.spendable) return qgold.spendable(player);
    return { accountId: qgold.accountIds(player)[0] ?? null, balanceU: await qgold.balanceU(player) };
  }
  async function withBalance(player, view) {
    if (!onChain()) return view;
    let balanceU = 0,
      balanceKnown = true,
      accountId = qgold.accountIds(player)[0] ?? null;
    try {
      ({ balanceU, accountId } = await spendable(player));
    } catch {
      // The shop still opens and the buttons stay usable: the burn itself
      // checks the balance on chain.
      balanceKnown = false;
    }
    let pendingU = 0;
    try {
      pendingU = Math.max(0, Number(qgold.pendingU?.(player)) || 0);
    } catch {
      /* nothing on the way is shown */
    }
    return { ...view, realm: "qgold", balanceU, balanceKnown, pendingU, hasAccount: !!accountId };
  }
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
      if (path === "/api/gold/burn/intent" && method === "GET") {
        assert(onChain(), "QGOLD spending is not open here.", 503, "QGOLD_DISABLED");
        const p = db.prepare("SELECT * FROM qgold_purchases WHERE player_id=? AND memo=?").get(player, url.searchParams.get("memo"));
        assert(p, "Purchase not found.", 404, "PURCHASE_NOT_FOUND");
        respond(res, { accountId: p.account_id, contractId: p.contract_id, amount: String(p.amount_u), memo: p.memo, state: p.state }); return true;
      }
      if (path === "/api/gold/shop" && method === "GET") return respond(res, await withBalance(player, gold.shop(player))), true;
      if (path === "/api/gold/burn/prepare" && method === "POST") {
        assert(onChain(), "QGOLD spending is not open here.", 503, "QGOLD_DISABLED");
        const i = await body(req);
        const pending = purchaseRow(db, player, i.purchaseId);
        const accounts = qgold.accountIds(player);
        let accountId = pending.account_id ?? null;
        if (!accountId) {
          try { accountId = (await spendable(player)).accountId; } catch { /* fall back to the newest link */ }
          if (!accounts.includes(accountId)) accountId = accounts[0] ?? null;
        }
        assert(accounts.includes(accountId), "This purchase account is not linked.", 403, "BURN_SIGNER");
        if (pending.relay_job_id && pending.state === "prepared") {
          const job = db.prepare("SELECT transaction_hash,state FROM relay_jobs WHERE id=?").get(pending.relay_job_id);
          if (job?.transaction_hash) {
            try { await confirmQgoldBurn(db, { player, intentId: pending.id, accountIds: accounts, contract: qgold.contract,
              txHash: job.transaction_hash, txStatus: qgold.txStatus, relayerId: qgold.relayerId }); }
            catch (error) { if (!["BURN_REJECTED", "BURN_PENDING"].includes(error.code)) throw error; }
          }
        }
        return (
          respond(
            res,
            prepareQgoldBurn({
              db, player, intentId: i.purchaseId, submitterId: i.submitterId,
              contract: qgold.contract,
              accountId,
              kinds: BURN_KINDS,
            }),
          ),
          true
        );
      }
      if (path === "/api/gold/burn/confirm" && method === "POST") {
        assert(onChain(), "QGOLD spending is not open here.", 503, "QGOLD_DISABLED");
        limit(`burn:${player}`, 20, assert);
        const i = await body(req);
        const credit = await confirmQgoldBurn(db, {
          player, intentId: i.purchaseId, relayerId: qgold.relayerId,
          accountIds: qgold.accountIds(player),
          contract: qgold.contract,
          txHash: i.txHash,
          txStatus: qgold.txStatus,
        });
        return respond(res, { kind: credit.kind, amountU: credit.amount_u, memo: credit.memo, transactionHash: credit.tx_hash, accountId: credit.account_id, contractId: qgold.contract, confirmed: true }), true;
      }
      if (path === "/api/gold/buy" && method === "POST") {
        const i = await body(req); respond(res, await purchase(req, player, path, i, () => gold.buy(player, i))); return true;
      }
      if (path === "/api/gold/equip" && method === "POST") return respond(res, gold.equip(player, await body(req))), true;
      if (path === "/api/gold/emote" && method === "POST") {
        limit(`emote:${player}`, 12, assert);
        return respond(res, gold.emote(player, await body(req))), true;
      }
      if (path === "/api/gold/gear" && method === "POST") {
        const i = await body(req); respond(res, await purchase(req, player, path, i, () => gold.buyGear(player, i))); return true;
      }
      if (path === "/api/gold/lure/quote" && method === "POST")
        return respond(res, await withBalance(player, gold.lureQuote(player, await body(req)))), true;
      if (path === "/api/gold/lure" && method === "POST") {
        limit(`lure:${player}`, 6, assert);
        const i = await body(req); return respond(res, await purchase(req, player, path, i, () => gold.setLure(player, i)), 201), true;
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
        const i = await body(req); return respond(res, await purchase(req, player, path, i, () => places.create(player, i)), 201), true;
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
      if (action === "extend" && method === "POST") {
        const i = await body(req); return respond(res, await purchase(req, player, path, i, () => places.extend(player, targetId, i))), true;
      }
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
