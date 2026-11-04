// NPC traders on NEAR Intents (N3, docs/NPC-TRADERS.md). The rules engine
// computes every offer and price before any model talks. The trader's stock
// (Auras) and purse (wNEAR) sit in the game's Intents verifier. Accepting an
// offer reserves the deal; the player then signs their own token_diff, the
// server signs the trader's exact opposite and the solver settles both in one
// execute_intents. The trader's intent is never published, so only the player
// standing next to the trader can take the deal, and the NPC never moves a
// player's funds. Like every trade, the buyer's wNEAR leg pays the verifier
// fee (2 %), which goes to the treasury.
//
// Offer kinds:
//   trade_buy   premium buy of a "wanted" edition the player owns, for that
//               exact token (10 min). The player receives the price; the
//               trader pays it plus the fee.
//   trade_sell  sale from the trader's stock at ≥ cost × 1.10 (3 min, only for
//               the player standing next to the trader). The player pays the
//               price plus the fee; the margin floor holds on the price.
//   trade_up    the player hands 3 commons to the trader account and receives
//               one rare Aura (game claim, secured via award-signed redeem).
//               Patrons (Staker + level 4) also get a 3 rares → 1 epic table.
// Patron rates (GAME-LOOPS P1-5): patrons (staker-gates.json patron_trader_rates) get a deeper stock discount,
// a higher premium and first call on the premium budget, all inside the
// margin floor (trader-pricing.mjs). Gated by step and level, never odds.
// Ten settled trades with one trader earn the NPC-only Merchant's Ledger Aura.
import { GameError, assert, hash, levelFor, positionTier, tierFor } from "../domain.mjs";
import { checkGate, playerStakerAccess } from "../staker-gates.mjs";
import { atomic, history } from "../database.mjs";
import { AURA_CATALOG, AURA_SUPPLY } from "../aura-catalog.mjs";
import { id } from "../domain.mjs";
import {
  auraOrderTerms,
  auraTokenDiff,
  grossForNet,
  intentMessage,
  nep171,
  signIntentWithKeyPair,
  versionedNonce,
} from "../native/intents.mjs";
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
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
// The trader's counter-intent lives only for the settlement call.
const TRADER_INTENT_TTL_MS = 2 * 60_000;
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
  intents,
  nfts,
  clock = Date.now,
}) {
  assert(traders?.size && intents && nfts, "NPC traders need the NEAR Intents verifier and the collection.", 503);
  const ledger = createTraderLedger(db, { clock });
  const verifierId = intents.verifierId,
    nftId = nfts.contractId;
  assert(intents.nftContract === nftId, "The verifier trades another collection.", 503);
  const fills = new Set();
  const traderAccounts = new Set([...traders.values()].map((t) => t.accountId));
  const traderFor = (actorId) => traders.get(actorId) || null;
  const linked = (player) =>
    db
      .prepare("SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY verified_at")
      .all(player)
      .map((r) => r.account_id)
      .slice(0, 3);

  /** Lowest open Intents sell order for an edition from players (not traders). */
  function floorFor(edition) {
    const rows = db
      .prepare(
        "SELECT maker,price FROM intents_orders WHERE verifier=? AND state='open' AND side='sell' AND token_id LIKE ? AND deadline_ms>?",
      )
      .all(verifierId, `aura:${edition}:%`, clock())
      .filter((r) => !traderAccounts.has(r.maker));
    return rows.reduce((min, r) => (min == null || BigInt(r.price) < min ? BigInt(r.price) : min), null);
  }

  /** An account's Auras and wNEAR inside the verifier. */
  const holdings = (accountId) => intents.account(accountId);
  /** The trader's stock: its Auras deposited in the verifier. */
  const stock = async (trader) => (await holdings(trader.accountId)).auras.filter((t) => editionOf(t));
  /** The trader's purse: its wNEAR in the verifier. */
  const purse = async (trader) => BigInt((await holdings(trader.accountId)).wnear || "0");
  const feePips = async () => (await intents.terms()).feePips || 0;

  /** Native Auras the player's linked accounts own, in the wallet or in the verifier. */
  async function playerTokens(accounts) {
    const out = [];
    for (const accountId of accounts) {
      const tokens = await nfts.view("nft_tokens_for_owner", { account_id: accountId, from_index: "0", limit: 100 });
      for (const t of tokens)
        if (editionOf(t.token_id) && t.owner_id === accountId) out.push({ tokenId: t.token_id, accountId, escrowed: false });
      for (const tokenId of (await holdings(accountId).catch(() => ({ auras: [] }))).auras)
        if (editionOf(tokenId)) out.push({ tokenId, accountId, escrowed: true });
    }
    return out;
  }

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

  /**
   * Patron rates follow the staker gate table (patron_trader_rates, default
   * Staker + level 4; owner decision 1 Nov 23:47). Staker = 2 NEAR matured,
   * read from the Keeper's staker status cache; Tier 2 counts as a Staker.
   */
  function isPatronPlayer(player) {
    const level = levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
    return checkGate("patron_trader_rates", playerStakerAccess(db, player, { worldTier: tierOf(player), level })).open;
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
    const patron = isPatronPlayer(player);
    const rate = patron ? " (patron rate)" : "";
    const accounts = linked(player);
    const offers = [];
    const until = Math.min(expiresAt ?? now + 5 * 60_000, now + 5 * 60_000);
    const fee = await feePips();
    // Discount / margin-floor sales from the trader's stock in the verifier.
    const escrowed = new Set(await stock(trader));
    for (const lot of ledger.held(actor.id)) {
      if (offers.length >= 2) break;
      if (!escrowed.has(lot.token_id) || ledger.openSellFor(actor.id, lot.token_id)) continue;
      const edition = editionOf(lot.token_id);
      const p = discountSellPrice(edition, BigInt(lot.cost), floorFor(edition), { patron });
      if (!p) continue;
      // The player pays the price plus the verifier fee (to the treasury).
      const pays = grossForNet(p.price, fee);
      offers.push({
        id: offerId("trade_sell", [actor.id, dayId, player, lot.token_id, p.price]),
        kind: "trade_sell",
        label: `Buy ${tokenLabel(lot.token_id)} for ${formatNear(pays)} test NEAR${p.discount ? " (below market)" : ""}${p.discount ? rate : ""}`,
        terms: {
          tokenId: lot.token_id,
          edition,
          price: p.price.toString(),
          buyerPays: pays.toString(),
          feePips: fee,
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
      const mine = await playerTokens(accounts);
      // Premium buys of today's wanted editions, paid only from profit.
      const wanted = wantedEditions(actor.id, dayId);
      const budget = budgetFor(trader, dayId);
      let free = (await purse(trader)) - ledger.reservedForBuys(actor.id);
      let premiumLeft = budgetLeftFor(budget, { patron });
      for (const edition of wanted) {
        const token = mine.find((t) => editionOf(t.tokenId) === edition && !ledger.tokenInTradeUp(t.tokenId));
        if (!token) continue;
        const p = premiumBuyPrice(edition, floorFor(edition), { patron });
        // The trader pays the price plus the verifier fee from its purse.
        const cost = p ? grossForNet(p.price, fee) : 0n;
        if (!p || p.premium > premiumLeft || cost > free) continue;
        premiumLeft -= p.premium;
        free -= cost;
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
            traderPays: cost.toString(),
            feePips: fee,
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
    const inVerifier = (await holdings(accountId)).auras.includes(tokenId);
    assert(inVerifier, "That Aura is no longer in your account.", 409, "NPC_TRADE_GONE");
    return "verifier";
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

  /** The execute_intents transaction that settled a trader deal. */
  const settlementTx = (t) => t.data.txHash || null;

  /**
   * Hand-over transactions of a trade-up: hashes the player reported (checked
   * on chain) plus relayed nft_transfer jobs of the explorer account, which
   * the relayer itself recorded.
   */
  function handoverTxs(t) {
    const out = { ...(t.data.handoverTxs || {}) };
    try {
      const rows = db
        .prepare(
          "SELECT transaction_hash,call FROM relay_jobs WHERE account_id=? AND receiver_id=? AND method_name='nft_transfer' AND transaction_hash IS NOT NULL AND state!='failed' AND created_at>=?",
        )
        .all(t.account_id, nftId, t.created_at);
      for (const r of rows) {
        const args = JSON.parse(r.call)?.args || {};
        if (args.receiver_id === t.data.receiver && t.data.tokens.includes(args.token_id) && !out[args.token_id])
          out[args.token_id] = r.transaction_hash;
      }
    } catch {
      // No relayer on this host: only reported hashes count.
    }
    return out;
  }

  const tradeView = (t) => {
    const handovers = t.kind === "trade_up" ? handoverTxs(t) : null;
    const txHash = t.kind === "trade_up" ? null : settlementTx(t);
    const txHashes = handovers ? [...new Set(Object.values(handovers))] : txHash ? [txHash] : [];
    return {
      tradeId: t.id,
      kind: t.kind,
      state: t.state,
      tokenId: t.token_id,
      price: t.price,
      deadlineMs: t.deadline_ms,
      accountId: t.account_id,
      // On-chain proof for the explorer link: the fill, or the hand-overs.
      txHash: txHash || txHashes[txHashes.length - 1] || null,
      txHashes,
      // What the player signs on the verifier (src/chain-trades.ts).
      ...(t.kind === "trade_up"
        ? {}
        : {
            intents: {
              verifier: verifierId,
              nftContract: nftId,
              wnear: intents.wnear,
              side: t.kind === "trade_sell" ? "buy" : "sell",
              price: t.price,
              feePips: t.data.feePips ?? 0,
              buyerPays: t.data.gross ?? t.price,
            },
          }),
      ...(t.kind === "trade_up"
        ? { tokens: t.data.tokens, receiver: t.data.receiver, edition: t.data.edition, nftContract: nftId, handovers }
        : {}),
      ...(t.data.auraItemId ? { secureItemId: t.data.auraItemId } : {}),
    };
  };

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
    const patron = isPatronPlayer(player);
    assert(!t.patron || patron, "This rate is for patrons (Stakers from level 4) only.", 403, "NPC_TRADE_PATRON");
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
    // Buy and sell deals only reserve the trade here: nothing is signed until
    // the player signs their side (fill), so an unused offer costs nothing.
    const fee = await feePips();
    let deadlineMs, price, premium = 0n, accountId, gross, cash = 0n;
    if (offer.kind === "trade_buy") {
      accountId = t.accountId;
      assert(linked(player).includes(accountId), "Link this NEAR account first.", 403);
      await assertOwner(t.tokenId, accountId);
      price = BigInt(t.price);
      premium = BigInt(t.premium);
      gross = grossForNet(price, fee);
      const budget = budgetFor(trader, dayId);
      assert(premium <= budgetLeftFor(budget, { patron }), "The trader is out of premium budget today.", 409, "NPC_TRADE_BUDGET");
      cash = await purse(trader);
      assert(gross <= cash - ledger.reservedForBuys(actor.id), "The trader's purse is empty right now.", 409, "NPC_TRADE_BUDGET");
      deadlineMs = now + BUY_TTL_MS;
    } else {
      accountId = linked(player)[0] || "unlinked";
      const lot = ledger.heldLot(actor.id, t.tokenId);
      assert(lot && !ledger.openSellFor(actor.id, t.tokenId), "Someone else is buying that Aura.", 409, "NPC_TRADE_GONE");
      assert((await stock(trader)).includes(t.tokenId), "That Aura is not on the counter.", 409, "NPC_TRADE_GONE");
      price = BigInt(t.price);
      gross = grossForNet(price, fee);
      // Never below the margin floor, even if the lot record changed meanwhile.
      assert(price * 10n >= BigInt(lot.cost) * 11n, "Price below the trader's margin floor.", 409, "NPC_TRADE_GONE");
      deadlineMs = now + SELL_TTL_MS;
    }
    const tradeId = atomic(db, () => {
      capCheck(actor.id, dayId, player);
      if (offer.kind === "trade_sell")
        assert(!ledger.openSellFor(actor.id, t.tokenId), "Someone else is buying that Aura.", 409, "NPC_TRADE_GONE");
      if (offer.kind === "trade_buy") {
        // Re-check under the write lock: two accepts can pass the checks above
        // together, and each one alone fits the purse and the premium budget
        // while both do not.
        assert(premium <= budgetLeftFor(budgetFor(trader, dayId), { patron }), "The trader is out of premium budget today.", 409, "NPC_TRADE_BUDGET");
        assert(gross <= cash - ledger.reservedForBuys(actor.id), "The trader's purse is empty right now.", 409, "NPC_TRADE_BUDGET");
      }
      return ledger.insertTrade({
        trader: actor.id,
        player,
        accountId,
        kind: offer.kind,
        offerId: offer.id,
        tokenId: t.tokenId,
        price,
        premium,
        orderId: null,
        deadlineMs,
        dayId,
        // `gross` is what the buyer gives: the price plus the verifier fee.
        data: { venue: "intents", feePips: fee, gross: gross.toString() },
      });
    });
    return tradeView(ledger.trade(tradeId));
  }

  /** Books a settled buy or sale: the lot, the player's history, the Ledger Aura. */
  function settleFilled(t, txHash) {
    return atomic(db, () => {
      if (ledger.settle(t.id, "filled") !== 1) return false;
      if (txHash) ledger.mergeData(t.id, { txHash });
      // A buy costs the trader the price plus the fee; a sale earns the price.
      if (t.kind === "trade_buy")
        ledger.addLot({ trader: t.trader, tokenId: t.token_id, cost: BigInt(t.data.gross ?? t.price), source: "buy", tradeId: t.id });
      else ledger.sellLot(t.trader, t.token_id, BigInt(t.price));
      history(db, t.player_id, "npc-trade", t.kind === "trade_buy" ? `Sold ${tokenLabel(t.token_id)} to a trader` : `Bought ${tokenLabel(t.token_id)} from a trader`, 0, {
        actor: t.trader,
        price: t.price,
        tokenId: t.token_id,
        txHash,
        network: "testnet",
        venue: "near-intents",
        policy: NPC_TRADER_POLICY,
      });
      grantLedgerAura(t.trader, t.player_id);
      return true;
    });
  }

  /**
   * The player's side of a reserved buy or sale: their signed token_diff on
   * the verifier. The server checks it against the reserved terms, signs the
   * trader's exact opposite with the trader's verifier key and the solver
   * settles both at once.
   */
  async function fill({ player, tradeId, signed }) {
    assert(typeof tradeId === "string" && tradeId.length <= 64, "Choose a trade.", 400, "NPC_OFFER");
    const t = ledger.trade(tradeId);
    assert(t && t.player_id === player && t.kind !== "trade_up", "You have no such trade with this character.", 404, "NPC_OFFER");
    if (t.state === "filled") return { ...tradeView(t), replay: true };
    assert(t.state === "issued" && t.deadline_ms > clock(), "This offer has lapsed. Talk to the trader again.", 409, "NPC_OFFER_EXPIRED");
    const trader = traderFor(t.trader);
    assert(trader, "This character does not trade here.", 404, "NPC_UNKNOWN");
    assert(!fills.has(t.id), "This trade is being settled right now.", 409, "NPC_TRADE_BUSY");
    fills.add(t.id);
    try {
      const body = await intents.verify(signed);
      const accounts = linked(player);
      assert(accounts.includes(body.signerId), "Sign with your linked NEAR account.", 403, "NPC_TX");
      if (t.kind === "trade_buy") assert(body.signerId === t.account_id, "Sign with the account that holds this Aura.", 403, "NPC_TX");
      const fee = t.data.feePips ?? 0;
      assert(fee === (await feePips()), "The trade fee changed. Talk to the trader again.", 409, "NPC_OFFER_EXPIRED");
      const mine = auraOrderTerms(body.intents, { nftContract: nftId, wnear: intents.wnear, feePips: fee });
      const playerSide = t.kind === "trade_sell" ? "buy" : "sell";
      assert(mine.side === playerSide && mine.tokenId === t.token_id && mine.price === String(t.price), "Your intent does not match this deal.", 409, "NPC_TX");
      if (t.kind === "trade_sell") {
        const lot = ledger.heldLot(t.trader, t.token_id);
        assert(lot && BigInt(t.price) * 10n >= BigInt(lot.cost) * 11n, "That Aura is no longer on the counter.", 409, "NPC_TRADE_GONE");
      }
      const deadlineMs = clock() + TRADER_INTENT_TTL_MS;
      const salt = await intents.verifier.view("current_salt", {}, true);
      const nonce = versionedNonce({ salt, deadlineMs });
      const traderIntent = signIntentWithKeyPair(trader.signing, {
        message: intentMessage({
          signerId: trader.accountId,
          deadlineMs,
          intents: [auraTokenDiff({ side: t.kind === "trade_sell" ? "sell" : "buy", nftContract: nftId, tokenId: t.token_id, price: t.price, wnear: intents.wnear, feePips: fee })],
        }),
        nonce,
        recipient: verifierId,
      });
      // Remember the trader's nonce first: if the process stops mid-call,
      // reconcile finds the used nonce and books the trade.
      ledger.mergeData(t.id, { traderNonce: Buffer.from(nonce).toString("base64"), signer: body.signerId });
      const r = await intents.settlePair(traderIntent, signed, { reference: `npc:${t.id}` });
      if (!settleFilled(t, r.transactionHash)) ledger.mergeData(t.id, { txHash: r.transactionHash });
      return tradeView(ledger.trade(t.id));
    } finally {
      fills.delete(t.id);
    }
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
      const handovers = handoverTxs(t);
      // The received Aura is secured on NEAR right away (the client redeems
      // the award claim for this item), so the whole trade-up is on chain.
      ledger.mergeData(t.id, { handoverTxs: handovers, auraItemId: aura.id });
      const txHashes = [...new Set(Object.values(handovers))];
      history(db, player, "npc-trade", `Trade-up with ${actor.name || actor.id}`, 0, {
        actor: actor.id,
        tokens: t.data.tokens,
        aura: aura.name,
        itemId: aura.id,
        txHash: txHashes[txHashes.length - 1] || null,
        txHashes,
        network: "testnet",
        policy: NPC_TRADER_POLICY,
      });
      const ledgerAura = grantLedgerAura(actor.id, player);
      return { ...tradeView(ledger.trade(t.id)), aura, ...(ledgerAura ? { ledgerAura } : {}) };
    });
  }

  /**
   * Closes issued deals: trade-ups and unsigned deals lapse at their
   * deadline; a fill that stopped after sending is booked once the trader's
   * nonce shows as used on the verifier.
   */
  async function reconcile({ trader: only = null, limit = 24 } = {}) {
    const now = clock();
    let settled = 0;
    for (const t of ledger.openTrades().filter((x) => !only || x.trader === only).slice(0, limit)) {
      const trader = traderFor(t.trader);
      if (!trader || fills.has(t.id)) continue;
      if (t.kind === "trade_up") {
        if (t.deadline_ms <= now) settled += ledger.settle(t.id, "expired");
        continue;
      }
      // A fill that stopped after sending: the trader's nonce is used on chain.
      if (t.data.traderNonce) {
        const used = await intents.verifier
          .view("is_nonce_used", { account_id: trader.accountId, nonce: t.data.traderNonce }, true)
          .catch(() => false);
        if (used) {
          if (settleFilled(t, null)) settled++;
          continue;
        }
      }
      if (t.deadline_ms <= now) settled += ledger.settle(t.id, "expired");
    }
    return { settled };
  }

  /**
   * The player reports the hash of a wallet-signed trade-up hand-over. Nothing
   * is trusted from the client: the hand-over is checked against the
   * transaction itself. Buys and sales are settled by the server (fill).
   */
  async function recordTx({ player, tradeId, transactionHash }) {
    assert(typeof tradeId === "string" && tradeId.length <= 64, "Choose a trade.", 400, "NPC_OFFER");
    assert(TX_HASH.test(String(transactionHash)), "Invalid transaction hash.", 400, "NPC_TX");
    const t = ledger.trade(tradeId);
    assert(t && t.player_id === player, "You have no such trade with this character.", 404, "NPC_OFFER");
    if (t.kind === "trade_up") {
      const provider = nfts.provider;
      assert(provider?.viewTransactionStatus, "Hand-over checks are not available here.", 503, "NPC_TX");
      const outcome = await provider.viewTransactionStatus({ txHash: transactionHash, accountId: t.account_id, waitUntil: "FINAL" });
      const tx = outcome?.transaction;
      assert(tx?.hash === transactionHash && tx.signer_id === t.account_id && tx.receiver_id === nftId, "That transaction is not this hand-over.", 409, "NPC_TX");
      const failed = (outcome.receipts_outcome || []).some((r) => r?.outcome?.status && Object.hasOwn(r.outcome.status, "Failure"));
      assert(!failed, "That hand-over failed on chain.", 409, "NPC_TX");
      const found = {};
      for (const a of tx.actions || []) {
        const call = a?.FunctionCall;
        if (call?.method_name !== "nft_transfer") continue;
        let args = {};
        try {
          args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
        } catch {}
        if (args.receiver_id === t.data.receiver && t.data.tokens.includes(args.token_id)) found[args.token_id] = transactionHash;
      }
      assert(Object.keys(found).length, "That transaction hands no Aura of this trade to the trader.", 409, "NPC_TX");
      ledger.mergeData(t.id, { handoverTxs: found });
      return tradeView(ledger.trade(t.id));
    }
    // Buys and sales are settled by the server itself (fill); nothing to record.
    await reconcile({ trader: t.trader });
    return tradeView(ledger.trade(t.id));
  }

  /** Issued trade-ups: the relayer may sponsor these exact hand-overs to the trader. */
  function handoversFor(player) {
    const now = clock();
    return ledger
      .openTrades("trade_up")
      .filter((t) => t.player_id === player && t.deadline_ms > now)
      .map((t) => ({ accountId: t.account_id, receiver: t.data.receiver, tokens: [...t.data.tokens] }));
  }

  /** The player's trades with every trader, with their on-chain proof. */
  const myTrades = (player, limit = 20) => ledger.playerTrades(player, limit).map((t) => ({ ...tradeView(t), trader: t.trader, createdAt: t.created_at, settledAt: t.settled_at }));

  /** Public books: float, 7-day P&L, premiums and swept total per trader. */
  async function books() {
    const dayId = new Date(clock()).toISOString().slice(0, 10);
    const out = [];
    for (const trader of traders.values()) {
      let float = null;
      try {
        float = await purse(trader);
      } catch {}
      const reserved = ledger.reservedForBuys(trader.actorId);
      const b = budgetFor(trader, dayId);
      out.push({
        actorId: trader.actorId,
        accountId: trader.accountId,
        startFloat: FLOAT.toString(),
        // wNEAR the trader holds in the Intents verifier.
        purse: float?.toString() ?? null,
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
    return { policy: NPC_TRADER_POLICY, network: "testnet", venue: "near-intents", verifier: verifierId, traders: out };
  }

  return {
    ledger,
    traders,
    verifierId,
    nftId,
    wnear: intents.wnear,
    verifierView: (method, args, fresh) => intents.verifier.view(method, args, fresh),
    nftsView: (method, args, fresh) => nfts.view(method, args, fresh),
    holdings,
    stock,
    purse,
    isTrader: (actorId) => traders.has(actorId),
    menu,
    accept,
    fill,
    completeTradeUp,
    reconcile,
    recordTx,
    handoversFor,
    myTrades,
    books,
  };
}
