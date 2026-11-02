// NPC traders on market v2 (N3, docs/NPC-PLAN.md §2.2 and §14). The rules
// engine computes every offer and price before any model talks; the trader
// account signs a NEP-413 order only when the player accepts, and the market
// contract settles it. Players fill with the ordinary market methods
// (fill_buy_order / fill_sell_order), so the NPC never moves a player's funds.
//
// Offer kinds:
//   trade_buy   premium buy of a "wanted" edition the player owns: a buy order
//               for that exact token, so only its owner can fill it (10 min).
//   trade_sell  sale from the trader's escrowed stock at ≥ cost × 1.10 (3 min,
//               released only to the player standing next to the trader).
//   trade_up    the player hands 3 commons to the trader account and receives
//               one rare Aura (game claim, secured via award-signed redeem).
//               Patrons (Tier 2+) also get a 3 rares → 1 epic table.
// Patron rates (GAME-LOOPS P1-5): Tier 2+ players get a deeper stock discount,
// a higher premium and first call on the premium budget, all inside the
// margin floor (trader-pricing.mjs). Gated by stake tier only.
// Ten settled trades with one trader earn the NPC-only Merchant's Ledger Aura.
import { GameError, assert, hash, positionTier, tierFor } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { AURA_CATALOG, AURA_SUPPLY } from "../aura-catalog.mjs";
import { id } from "../domain.mjs";
import { signTraderOrder } from "./trader-keys.mjs";
import { createTraderLedger } from "./trader-ledger.mjs";
import { awardEditionOnce } from "../earned-editions.mjs";
import {
  BUY_TTL_MS,
  FLOAT,
  LEDGER_TRADES_FOR_AURA,
  MAX_TRADES_PER_PLAYER_DAY,
  MAX_TRADES_PER_TRADER_DAY,
  NPC_TRADER_POLICY,
  SELL_TTL_MS,
  TRADEUP_COMMONS,
  TRADEUP_TABLES,
  budgetLeftFor,
  discountSellPrice,
  isPatron,
  editionOf,
  formatNear,
  premiumBudget,
  premiumBuyPrice,
  rarityOf,
  sweepableSurplus,
  wantedEditions,
} from "./trader-pricing.mjs";

const DAY = 86_400_000;
const TRADEUP_TTL_MS = 30 * 60_000;
const TRADE_KINDS = new Set(["trade_buy", "trade_sell", "trade_up"]);
const editionName = (edition) => AURA_CATALOG.find((e) => e.id === edition)?.name || edition;
const tokenLabel = (tokenId) => `${editionName(editionOf(tokenId))} #${tokenId.split(":")[2]}`;
const offerId = (kind, parts) => `${kind}:${hash(parts.join("|")).slice(0, 16)}`;

/** Mint a specific catalog edition into the player's game inventory (claimable on NEAR). */
export function mintEdition(db, player, editionId, now) {
  const e = AURA_CATALOG.find((x) => x.id === editionId);
  assert(e, "Unknown Aura edition.");
  db.prepare("INSERT OR IGNORE INTO editions VALUES (?,0,?)").run(e.demoName, AURA_SUPPLY);
  const row = db.prepare("SELECT * FROM editions WHERE name=?").get(e.demoName);
  if (row.minted >= row.max_supply) return null;
  const item = {
    id: id("aura"),
    name: e.demoName,
    rarity: e.rarity,
    slot: e.slot,
    color: e.demoColor || e.color,
    serial: row.minted + 1,
  };
  db.prepare("UPDATE editions SET minted=minted+1 WHERE name=?").run(e.demoName);
  db.prepare("INSERT INTO inventory VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    item.id,
    player,
    "aura",
    item.name,
    item.rarity,
    item.slot,
    item.color,
    0,
    item.serial,
    now,
  );
  return item;
}

const editionLeft = (db, editionId) => {
  const e = AURA_CATALOG.find((x) => x.id === editionId);
  return (db.prepare("SELECT minted FROM editions WHERE name=?").get(e?.demoName)?.minted || 0) < AURA_SUPPLY;
};

export function createTraderService({
  db,
  traders,
  market,
  nfts,
  orderIndex,
  clock = Date.now,
}) {
  assert(traders?.size && market && nfts && orderIndex, "NPC traders need the market, collection and order index.", 503);
  const ledger = createTraderLedger(db, { clock });
  const marketId = market.contractId,
    nftId = nfts.contractId;
  const traderAccounts = new Set([...traders.values()].map((t) => t.accountId));
  const traderFor = (actorId) => traders.get(actorId) || null;
  const linked = (player) =>
    db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at")
      .all(player)
      .map((r) => r.account_id)
      .slice(0, 3);

  /** Lowest open sell order for an edition from players (not traders). */
  function floorFor(edition) {
    const rows = db
      .prepare(
        "SELECT maker,price FROM signed_market_orders WHERE market=? AND state='open' AND kind='sell' AND token_id LIKE ? AND deadline_ms>?",
      )
      .all(marketId, `aura:${edition}:%`, clock())
      .filter((r) => !traderAccounts.has(r.maker));
    return rows.reduce((min, r) => (min == null || BigInt(r.price) < min ? BigInt(r.price) : min), null);
  }

  async function listings(fresh = false) {
    const out = [];
    for (let from = 0; from < 256; from += 50) {
      const page = await market.view("get_listings", { from_index: from, limit: 50 }, fresh);
      out.push(...page);
      if (page.length < 50) break;
    }
    return out;
  }

  /** Native Auras the player's linked accounts own or hold in market escrow. */
  async function playerTokens(accounts, book) {
    const out = [];
    for (const accountId of accounts) {
      const tokens = await nfts.view("nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 });
      for (const t of tokens)
        if (editionOf(t.token_id) && t.owner_id === accountId) out.push({ tokenId: t.token_id, accountId, escrowed: false });
      for (const l of book)
        if (l.seller === accountId && l.state === "deposited" && editionOf(l.token_id))
          out.push({ tokenId: l.token_id, accountId, escrowed: true });
    }
    return out;
  }

  const credit = async (trader, fresh = false) =>
    BigInt((await market.view("get_account", { account_id: trader.accountId }, fresh))?.credit || "0");

  /** The player's stake tier, as the world view computes it (positions, matured). */
  function tierOf(player) {
    const now = clock();
    return tierFor(
      db
        .prepare("SELECT * FROM positions WHERE player_id=?")
        .all(player)
        .reduce((n, p) => n + positionTier(p, now), 0),
    );
  }

  function budgetFor(trader, dayId) {
    const first = trader.fundedAt || ledger.firstActivity(trader.actorId) || clock();
    const daysActive = Math.floor((clock() - first) / DAY);
    const profit7d = ledger.profit7d(trader.actorId);
    const budget = premiumBudget({ profit7d, daysActive });
    const spent = ledger.premiumsToday(trader.actorId, dayId);
    return { profit7d, budget, spent, left: budget > spent ? budget - spent : 0n };
  }

  /** Offer menu for one encounter (registered as the "trader" menu builder). */
  async function menu({ actor, player, dayId, now = clock(), expiresAt }) {
    const trader = traderFor(actor.id);
    if (!trader || !player) return [];
    await reconcile({ trader: actor.id }).catch(() => {});
    if (ledger.tradesToday(actor.id, dayId, player) >= MAX_TRADES_PER_PLAYER_DAY) return [];
    if (ledger.tradesToday(actor.id, dayId) >= MAX_TRADES_PER_TRADER_DAY) return [];
    const patron = isPatron(tierOf(player));
    const rate = patron ? " (patron rate)" : "";
    const accounts = linked(player);
    const book = await listings();
    const offers = [];
    const until = Math.min(expiresAt ?? now + 5 * 60_000, now + 5 * 60_000);
    // Discount / margin-floor sales from escrowed stock.
    const escrowed = new Set(book.filter((l) => l.seller === trader.accountId && l.state === "deposited").map((l) => l.token_id));
    for (const lot of ledger.held(actor.id)) {
      if (offers.length >= 2) break;
      if (!escrowed.has(lot.token_id) || ledger.openSellFor(actor.id, lot.token_id)) continue;
      const edition = editionOf(lot.token_id);
      const p = discountSellPrice(edition, BigInt(lot.cost), floorFor(edition), { patron });
      if (!p) continue;
      offers.push({
        id: offerId("trade_sell", [actor.id, dayId, player, lot.token_id, p.price]),
        kind: "trade_sell",
        label: `Buy ${tokenLabel(lot.token_id)} for ${formatNear(p.price)} test NEAR${p.discount ? " (below market)" : ""}${p.discount ? rate : ""}`,
        terms: {
          tokenId: lot.token_id,
          edition,
          price: p.price.toString(),
          market: p.market.toString(),
          discount: p.discount,
          patron,
          trader: trader.accountId,
          ttlMs: SELL_TTL_MS,
          policy: NPC_TRADER_POLICY,
        },
        expiresAt: until,
      });
    }
    if (accounts.length) {
      const mine = await playerTokens(accounts, book);
      // Premium buys of today's wanted editions, paid only from profit.
      const wanted = wantedEditions(actor.id, dayId);
      const budget = budgetFor(trader, dayId);
      let free = (await credit(trader)) - ledger.reservedForBuys(actor.id);
      let premiumLeft = budgetLeftFor(budget, { patron });
      for (const edition of wanted) {
        const token = mine.find((t) => editionOf(t.tokenId) === edition && !ledger.tokenInTradeUp(t.tokenId));
        if (!token) continue;
        const p = premiumBuyPrice(edition, floorFor(edition), { patron });
        if (!p || p.premium > premiumLeft || p.price > free) continue;
        premiumLeft -= p.premium;
        free -= p.price;
        offers.push({
          id: offerId("trade_buy", [actor.id, dayId, player, token.tokenId, p.price]),
          kind: "trade_buy",
          label: `Sell me your ${tokenLabel(token.tokenId)} for ${formatNear(p.price)} test NEAR (+${formatNear(p.premium)} over market)${rate}`.slice(0, 120),
          terms: {
            tokenId: token.tokenId,
            accountId: token.accountId,
            escrowed: token.escrowed,
            edition,
            price: p.price.toString(),
            premium: p.premium.toString(),
            market: p.market.toString(),
            trader: trader.accountId,
            ttlMs: BUY_TTL_MS,
            wanted: true,
            patron,
            policy: NPC_TRADER_POLICY,
          },
          expiresAt: until,
        });
      }
      // Trade-ups (held directly, not escrowed): 3 commons → 1 rare for
      // everyone, 3 rares → 1 epic for patrons. The received Aura comes from
      // game edition supply, so the trader only gains stock.
      const inTrade = new Set();
      for (const table of TRADEUP_TABLES) {
        if (table.patron && !patron) continue;
        const target = AURA_CATALOG.filter((e) => e.native && e.source === "chest" && e.rarity === table.get)
          .map((e) => e.id)
          .sort((a, b) => hash(`${actor.id}|${dayId}|${a}`).localeCompare(hash(`${actor.id}|${dayId}|${b}`)))
          .find((e) => editionLeft(db, e));
        const byAccount = new Map();
        for (const t of mine)
          if (!t.escrowed && rarityOf(editionOf(t.tokenId)) === table.give && !inTrade.has(t.tokenId) && !ledger.tokenInTradeUp(t.tokenId))
            byAccount.set(t.accountId, [...(byAccount.get(t.accountId) || []), t.tokenId]);
        const pick = [...byAccount.entries()].find(([, list]) => list.length >= TRADEUP_COMMONS);
        if (!target || !pick) continue;
        const tokens = pick[1].sort().slice(0, TRADEUP_COMMONS);
        tokens.forEach((x) => inTrade.add(x));
        offers.push({
          id: offerId("trade_up", [actor.id, dayId, player, ...tokens, target]),
          kind: "trade_up",
          label: `Trade ${tokens.map(tokenLabel).join(", ")} for one ${editionName(target)}${table.patron ? rate : ""}`.slice(0, 120),
          terms: {
            tokens,
            accountId: pick[0],
            edition: target,
            give: table.give,
            patron: table.patron,
            trader: trader.accountId,
            ttlMs: TRADEUP_TTL_MS,
            policy: NPC_TRADER_POLICY,
          },
          expiresAt: until,
        });
      }
    }
    return offers.slice(0, 6);
  }

  async function assertOwner(tokenId, accountId) {
    const token = await nfts.view("nft_token", { token_id: tokenId }, true);
    if (token?.owner_id === accountId) return "wallet";
    const l = await market.view("get_listing", { token_id: tokenId }, true);
    assert(l?.seller === accountId && l?.state === "deposited", "That Aura is no longer in your account.", 409, "NPC_TRADE_GONE");
    return "escrow";
  }

  function capCheck(actorId, dayId, player) {
    assert(
      ledger.tradesToday(actorId, dayId, player) < MAX_TRADES_PER_PLAYER_DAY,
      `You already traded ${MAX_TRADES_PER_PLAYER_DAY} times with this trader today.`,
      429,
      "NPC_TRADE_CAP",
    );
    assert(
      ledger.tradesToday(actorId, dayId) < MAX_TRADES_PER_TRADER_DAY,
      "This trader has closed their books for today.",
      429,
      "NPC_TRADE_CAP",
    );
  }

  const tradeView = (t) => ({
    tradeId: t.id,
    kind: t.kind,
    state: t.state,
    tokenId: t.token_id,
    price: t.price,
    deadlineMs: t.deadline_ms,
    ...(t.data.order ? { order: t.data.order, market: marketId, nftContract: nftId } : {}),
    ...(t.kind === "trade_up"
      ? { tokens: t.data.tokens, receiver: t.data.receiver, edition: t.data.edition, nftContract: nftId }
      : {}),
  });

  /** Accept a trade offer from the encounter's bound menu. */
  async function accept({ player, actor, encounter, offerId: wanted }) {
    const trader = traderFor(actor.id);
    assert(trader, "This character does not trade here.", 404, "NPC_UNKNOWN");
    const offer = (encounter?.menu || []).find((o) => o.id === wanted);
    assert(offer && TRADE_KINDS.has(offer.kind), "This offer is no longer available.", 409, "NPC_OFFER_GONE");
    const prior = ledger.tradeFor(actor.id, player, offer.id);
    if (prior) return tradeView(prior);
    const dayId = encounter.dayId,
      now = clock(),
      t = offer.terms;
    capCheck(actor.id, dayId, player);
    // A patron rate needs the tier at accept time too (stake may have moved).
    const patron = isPatron(tierOf(player));
    assert(!t.patron || patron, "This rate is for patrons (Tier 2) only.", 403, "NPC_TRADE_PATRON");
    if (offer.kind === "trade_up") {
      assert(t.tokens.every((x) => !ledger.tokenInTradeUp(x)), "One of these Auras is already in a trade.", 409, "NPC_TRADE_GONE");
      assert(linked(player).includes(t.accountId), "Link this NEAR account first.", 403);
      for (const tokenId of t.tokens)
        assert((await assertOwner(tokenId, t.accountId)) === "wallet", "Take the Aura out of market escrow first.", 409, "NPC_TRADE_GONE");
      assert(editionLeft(db, t.edition), "That edition has no supply left.", 409, "NPC_TRADE_GONE");
      const tradeId = atomic(db, () => {
        capCheck(actor.id, dayId, player);
        return ledger.insertTrade({
          trader: actor.id,
          player,
          accountId: t.accountId,
          kind: "trade_up",
          offerId: offer.id,
          tokenId: t.tokens[0],
          price: 0n,
          deadlineMs: now + TRADEUP_TTL_MS,
          dayId,
          data: { tokens: t.tokens, edition: t.edition, receiver: trader.accountId },
        });
      });
      return tradeView(ledger.trade(tradeId));
    }
    let deadlineMs, price, premium = 0n, accountId;
    if (offer.kind === "trade_buy") {
      accountId = t.accountId;
      assert(linked(player).includes(accountId), "Link this NEAR account first.", 403);
      await assertOwner(t.tokenId, accountId);
      price = BigInt(t.price);
      premium = BigInt(t.premium);
      const budget = budgetFor(trader, dayId);
      assert(premium <= budgetLeftFor(budget, { patron }), "The trader is out of premium budget today.", 409, "NPC_TRADE_BUDGET");
      assert(price <= (await credit(trader, true)) - ledger.reservedForBuys(actor.id), "The trader's purse is empty right now.", 409, "NPC_TRADE_BUDGET");
      deadlineMs = now + BUY_TTL_MS;
    } else {
      accountId = linked(player)[0] || "unlinked";
      const lot = ledger.heldLot(actor.id, t.tokenId);
      assert(lot && !ledger.openSellFor(actor.id, t.tokenId), "Someone else is buying that Aura.", 409, "NPC_TRADE_GONE");
      const l = await market.view("get_listing", { token_id: t.tokenId }, true);
      assert(l?.seller === trader.accountId && l.state === "deposited", "That Aura is not on the counter.", 409, "NPC_TRADE_GONE");
      price = BigInt(t.price);
      // Never below the margin floor, even if the lot record changed meanwhile.
      assert(price * 10n >= BigInt(lot.cost) * 11n, "Price below the trader's margin floor.", 409, "NPC_TRADE_GONE");
      deadlineMs = now + SELL_TTL_MS;
    }
    const epoch = (await market.view("get_signer", { account_id: trader.accountId }, true))?.epoch || 0;
    const order = signTraderOrder(trader, {
      kind: offer.kind === "trade_buy" ? "buy" : "sell",
      market: marketId,
      nftContract: nftId,
      tokenId: t.tokenId,
      price,
      deadlineMs,
      epoch,
    });
    const indexed = await orderIndex.submit(order);
    const tradeId = atomic(db, () => {
      capCheck(actor.id, dayId, player);
      if (offer.kind === "trade_sell")
        assert(!ledger.openSellFor(actor.id, t.tokenId), "Someone else is buying that Aura.", 409, "NPC_TRADE_GONE");
      return ledger.insertTrade({
        trader: actor.id,
        player,
        accountId,
        kind: offer.kind,
        offerId: offer.id,
        tokenId: t.tokenId,
        price,
        premium,
        orderId: indexed.id,
        deadlineMs,
        dayId,
        data: { order },
      });
    });
    return tradeView(ledger.trade(tradeId));
  }

  function grantLedgerAura(trader, player) {
    if (ledger.settledCount(trader, player) < LEDGER_TRADES_FOR_AURA) return null;
    // Once per player, ever (server/earned-editions.mjs).
    const item = awardEditionOnce(db, player, "ledger", `npc:${trader}`, clock());
    if (item) history(db, player, "npc-trade", `Merchant's Ledger from ${trader}`, 0, { actor: trader, policy: NPC_TRADER_POLICY });
    return item;
  }

  /** Hand-over check for a trade-up: all three commons now belong to the trader. */
  async function completeTradeUp({ player, actor, offerId: wanted }) {
    const trader = traderFor(actor.id);
    assert(trader, "This character does not trade here.", 404, "NPC_UNKNOWN");
    const row = db
      .prepare("SELECT id FROM npc_trader_trades WHERE trader=? AND player_id=? AND offer_id=? AND kind='trade_up' ORDER BY created_at DESC")
      .get(actor.id, player, wanted);
    const t = row && ledger.trade(row.id);
    assert(t, "You have no such trade with this character.", 404, "NPC_OFFER");
    if (t.state === "completed") return { ...tradeView(t), replay: true };
    assert(t.state === "issued", "This trade has lapsed.", 409, "NPC_OFFER_EXPIRED");
    const missing = [];
    for (const tokenId of t.data.tokens) {
      const token = await nfts.view("nft_token", { token_id: tokenId }, true);
      if (token?.owner_id !== trader.accountId) missing.push(tokenId);
    }
    if (missing.length)
      throw new GameError(`Hand over ${missing.map(tokenLabel).join(", ")} to ${trader.accountId} first.`, 409, "NPC_TRADE_PENDING");
    return atomic(db, () => {
      assert(ledger.settle(t.id, "completed") === 1, "This trade was already completed.", 409, "NPC_OFFER");
      for (const tokenId of t.data.tokens) ledger.addLot({ trader: actor.id, tokenId, cost: 0n, source: "trade_up", tradeId: t.id });
      const aura = mintEdition(db, player, t.data.edition, clock());
      if (!aura) throw new GameError("That edition ran out of supply; your commons stay with the trade record.", 409, "NPC_TRADE_SUPPLY");
      history(db, player, "npc-trade", `Trade-up with ${actor.name || actor.id}`, 0, {
        actor: actor.id,
        tokens: t.data.tokens,
        aura: aura.name,
        policy: NPC_TRADER_POLICY,
      });
      const ledgerAura = grantLedgerAura(actor.id, player);
      return { ...tradeView(ledger.trade(t.id)), aura, ...(ledgerAura ? { ledgerAura } : {}) };
    });
  }

  /**
   * Settle issued orders from the order index and on-chain ownership: a buy
   * is filled when the trader now holds the token, a sale when the token left
   * the trader's escrow to someone else. Unfilled orders lapse at their deadline.
   */
  async function reconcile({ trader: only = null, limit = 24 } = {}) {
    const now = clock();
    let settled = 0;
    for (const t of ledger.openTrades().filter((x) => !only || x.trader === only).slice(0, limit)) {
      const trader = traderFor(t.trader);
      if (!trader) continue;
      if (t.kind === "trade_up") {
        if (t.deadline_ms <= now) settled += ledger.settle(t.id, "expired");
        continue;
      }
      const idx = t.order_id ? db.prepare("SELECT state FROM signed_market_orders WHERE id=?").get(t.order_id) : null;
      if (idx?.state === "open" && t.deadline_ms > now) continue;
      if (idx?.state === "cancelled") {
        settled += ledger.settle(t.id, "cancelled");
        continue;
      }
      const token = await nfts.view("nft_token", { token_id: t.token_id }, true);
      const listing = await market.view("get_listing", { token_id: t.token_id }, true);
      if (listing && /filling/i.test(JSON.stringify(listing.state))) continue; // settling right now
      const filled =
        t.kind === "trade_buy"
          ? token?.owner_id === trader.accountId || listing?.seller === trader.accountId
          : idx?.state === "filled" || (token?.owner_id !== trader.accountId && token?.owner_id !== marketId);
      if (!filled) {
        if (t.deadline_ms <= now) settled += ledger.settle(t.id, "expired");
        continue;
      }
      atomic(db, () => {
        if (ledger.settle(t.id, "filled") !== 1) return;
        settled++;
        if (t.kind === "trade_buy")
          ledger.addLot({ trader: t.trader, tokenId: t.token_id, cost: BigInt(t.price), source: "buy", tradeId: t.id });
        else ledger.sellLot(t.trader, t.token_id, BigInt(t.price));
        history(db, t.player_id, "npc-trade", t.kind === "trade_buy" ? `Sold ${tokenLabel(t.token_id)} to a trader` : `Bought ${tokenLabel(t.token_id)} from a trader`, 0, {
          actor: t.trader,
          price: t.price,
          policy: NPC_TRADER_POLICY,
        });
        grantLedgerAura(t.trader, t.player_id);
      });
    }
    return { settled };
  }

  /** Public books: float, 7-day P&L, premiums and swept total per trader. */
  async function books() {
    const dayId = new Date(clock()).toISOString().slice(0, 10);
    const out = [];
    for (const trader of traders.values()) {
      let float = null;
      try {
        float = await credit(trader);
      } catch {}
      const reserved = ledger.reservedForBuys(trader.actorId);
      const b = budgetFor(trader, dayId);
      out.push({
        actorId: trader.actorId,
        accountId: trader.accountId,
        startFloat: FLOAT.toString(),
        marketCredit: float?.toString() ?? null,
        reservedForBuys: reserved.toString(),
        profit7d: b.profit7d.toString(),
        premiumBudgetToday: b.budget.toString(),
        premiumsToday: b.spent.toString(),
        sweepable: float == null ? null : sweepableSurplus(float, { reserved }).toString(),
        swept: ledger.sweptTotal(trader.actorId).toString(),
        held: ledger.held(trader.actorId).map((l) => ({ tokenId: l.token_id, cost: l.cost, source: l.source })),
        trades: ledger.stats(trader.actorId),
        sweeps: ledger.sweeps(trader.actorId, 5),
      });
    }
    return { policy: NPC_TRADER_POLICY, network: "testnet", market: marketId, traders: out };
  }

  return {
    ledger,
    traders,
    marketId,
    nftId,
    marketView: (method, args, fresh) => market.view(method, args, fresh),
    nftsView: (method, args, fresh) => nfts.view(method, args, fresh),
    listings,
    isTrader: (actorId) => traders.has(actorId),
    menu,
    accept,
    completeTradeUp,
    reconcile,
    books,
  };
}
