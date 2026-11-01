// NPC traders on market v2 (N3): pricing always favours the treasury, offers
// become NEP-413 orders signed by the trader account, caps hold, fills settle
// into the books, trade-ups pay a rare Aura, and the keeper sweeps surplus.
import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { SignedOrderIndex } from "../server/native/order-index.mjs";
import { verifySignedOrderLocally } from "../server/native/signed-orders.mjs";
import { NETWORK } from "../server/native/network.mjs";
import { parseTraders } from "../server/npc/trader-keys.mjs";
import { createTraderService } from "../server/npc/trader.mjs";
import { createTraderKeeper, sweepReceiptId } from "../server/npc/trader-keeper.mjs";
import { offerFacts } from "../server/npc/offers.mjs";
import {
  FLOAT,
  MAX_TRADES_PER_PLAYER_DAY,
  MILLI,
  REFERENCE,
  SEED_PER_DAY,
  SWEEP_BUFFER,
  YOCTO,
  discountSellPrice,
  premiumBudget,
  premiumBuyPrice,
  referenceValue,
  sweepableSurplus,
  wantedEditions,
} from "../server/npc/trader-pricing.mjs";

const skip = NETWORK !== "testnet";
const MARKET = "market.testnet",
  NFTS = "nfts.testnet",
  NPC = "npc-kupec-vojtech.op.testnet",
  DAY = "2026-11-02";
const ACTOR = { id: "kupec-vojtech", kind: "npc", archetype: "trader", name: "Vojtěch the Merchant" };

test("premium buys keep a 10 % margin to resale and sales never go below cost × 1.10", () => {
  for (const edition of ["ember", "dew", "polar", "bloom", "storm", "moon", "comet"]) {
    for (const floor of [null, 5n * MILLI, 15n * MILLI, 40n * MILLI, 100n * MILLI, 400n * MILLI]) {
      const buy = premiumBuyPrice(edition, floor);
      if (buy) {
        assert.ok(buy.price * 110n <= buy.resale * 100n, `${edition} buy keeps margin`);
        assert.ok(buy.price >= buy.market, "a premium is never below market");
        const sell = discountSellPrice(edition, buy.price, null);
        if (sell) assert.ok(sell.price * 100n >= buy.price * 110n, "resale ≥ cost × 1.10");
      }
      for (const cost of [0n, 10n * MILLI, 50n * MILLI]) {
        const sell = discountSellPrice(edition, cost, floor);
        if (sell) {
          assert.ok(sell.price * 100n >= cost * 110n);
          assert.ok(sell.price <= (floor ?? referenceValue(edition)), "never worse than the book");
        }
      }
    }
  }
  // No local order book: buy at most reference / 1.10.
  const ember = premiumBuyPrice("ember", null);
  assert.ok(ember.price <= (REFERENCE.common * 10n) / 11n && ember.premium > 0n);
  // Stock from trade-ups (cost 0) sells at a real discount.
  assert.equal(discountSellPrice("ember", 0n, null).discount, true);
  // An expensive local floor leaves no margin: no buy.
  assert.equal(premiumBuyPrice("ember", 100n * MILLI), null);
});

test("premiums are paid only from profit, plus a first-week seed", () => {
  assert.equal(premiumBudget({ profit7d: -1n, daysActive: 0 }), 0n);
  assert.equal(premiumBudget({ profit7d: 0n, daysActive: 2 }), SEED_PER_DAY);
  assert.equal(premiumBudget({ profit7d: 0n, daysActive: 8 }), 0n);
  assert.equal(premiumBudget({ profit7d: 2n * SEED_PER_DAY, daysActive: 9 }), SEED_PER_DAY);
  assert.equal(sweepableSurplus(FLOAT), 0n);
  assert.equal(sweepableSurplus(FLOAT + SWEEP_BUFFER + YOCTO), YOCTO);
  assert.equal(sweepableSurplus(FLOAT + SWEEP_BUFFER + YOCTO, { reserved: YOCTO }), 0n);
  assert.ok(sweepReceiptId(ACTOR.id, "20261102", 1).length <= 64);
});

function chain() {
  const s = {
    owner: new Map(),
    listings: new Map(),
    credit: new Map([[NPC, FLOAT]]),
    epoch: 0,
    calls: [],
  };
  const market = {
    contractId: MARKET,
    nfts: { contractId: NFTS },
    view: async (method, args = {}) => {
      switch (method) {
        case "get_stats":
          return { version: 2 };
        case "get_listings":
          return [...s.listings.entries()].slice(args.from_index, args.from_index + args.limit).map(([token_id, l], i) => ({ id: i, token_id, seller: l.seller, price: "0", state: l.state }));
        case "get_listing": {
          const l = s.listings.get(args.token_id);
          return l ? { token_id: args.token_id, seller: l.seller, state: l.state } : null;
        }
        case "get_account":
          return { credit: String(s.credit.get(args.account_id) || 0n), withdrawing: "0", listed: 0 };
        case "get_signer":
          return { keys: [], epoch: s.epoch };
        case "check_order":
          return { valid: true, reason: null, fillable: false };
      }
      throw new Error(method);
    },
  };
  const nfts = {
    contractId: NFTS,
    view: async (method, args = {}) => {
      if (method === "nft_token") return s.owner.has(args.token_id) ? { token_id: args.token_id, owner_id: s.owner.get(args.token_id) } : null;
      if (method === "nft_tokens_for_owner")
        return [...s.owner.entries()].filter(([, o]) => o === args.account_id).map(([token_id, owner_id]) => ({ token_id, owner_id }));
      throw new Error(method);
    },
  };
  return { s, market, nfts };
}

function setup(t, { now = Date.now() } = {}) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let clock = now;
  const c = chain();
  const index = new SignedOrderIndex(db, c.market, { now: () => clock });
  const traders = parseTraders({
    network: "testnet",
    traders: [
      { actorId: ACTOR.id, accountId: NPC, signingKey: KeyPair.fromRandom("ed25519").toString(), fundedAt: new Date(now).toISOString() },
    ],
  });
  const service = createTraderService({ db, traders, market: c.market, nfts: c.nfts, orderIndex: index, clock: () => clock });
  const player = (name, account) => {
    const p = createPlayer(db, name, now);
    db.prepare("INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?)").run(account, p, now);
    return p;
  };
  const encounter = async (p) => {
    const menu = await service.menu({ actor: ACTOR, player: p, dayId: DAY, now: clock, expiresAt: clock + 300_000 });
    return { menu, dayId: DAY, encounterId: "enc" };
  };
  return { db, c, index, service, traders, player, encounter, tick: (ms) => (clock += ms), now: () => clock };
}

test("a premium buy becomes a trader-signed buy order bound to one token", { skip }, async (t) => {
  const { c, service, player, encounter, traders, db } = setup(t);
  const [wanted] = wantedEditions(ACTOR.id, DAY);
  const alice = player("Alice", "alice.testnet"),
    bob = player("Bob", "bob.testnet");
  c.s.owner.set(`aura:${wanted}:7`, "alice.testnet");
  const enc = await encounter(alice);
  const offer = enc.menu.find((o) => o.kind === "trade_buy");
  assert.ok(offer, "Alice is offered a premium for her wanted Aura");
  assert.equal(offer.terms.tokenId, `aura:${wanted}:7`);
  assert.match(offerFacts([offer])[0].text, /signed buy order/);
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  const terms = verifySignedOrderLocally(trade.order, { market: MARKET, nftContract: NFTS });
  assert.equal(terms.maker, NPC);
  assert.equal(terms.kind, "buy");
  assert.equal(terms.token_id, `aura:${wanted}:7`);
  assert.equal(trade.order.public_key, traders.get(ACTOR.id).signingPublicKey);
  // Accepting again returns the same order (no second nonce, no double budget).
  const again = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  assert.equal(again.tradeId, trade.tradeId);
  // Bob cannot use Alice's offer: it is not on his encounter menu.
  const bobEnc = await encounter(bob);
  await assert.rejects(service.accept({ player: bob, actor: ACTOR, encounter: bobEnc, offerId: offer.id }), /no longer available/);
  // The fill (on chain the trader now owns the token) settles into the books.
  c.s.owner.set(`aura:${wanted}:7`, NPC);
  db.prepare("UPDATE signed_market_orders SET state='filled' WHERE id=?").run(`${NPC}:${trade.order.nonce}`);
  assert.equal((await service.reconcile()).settled, 1);
  const lot = service.ledger.heldLot(ACTOR.id, `aura:${wanted}:7`);
  assert.equal(lot.cost, String(BigInt(offer.terms.price)));
});

test("caps stop the fourth trade of the day with one trader", { skip }, async (t) => {
  const { c, service, player, encounter } = setup(t);
  const alice = player("Alice", "alice.testnet");
  // Escrowed stock from earlier trade-ups (cost 0) for four sales.
  for (let i = 1; i <= 4; i++) {
    c.s.listings.set(`aura:ember:${i}`, { seller: NPC, state: "deposited" });
    c.s.owner.set(`aura:ember:${i}`, MARKET);
    service.ledger.addLot({ trader: ACTOR.id, tokenId: `aura:ember:${i}`, cost: 0n, source: "trade_up" });
  }
  let done = 0;
  for (let round = 0; round < 3; round++) {
    const enc = await encounter(alice);
    const sells = enc.menu.filter((o) => o.kind === "trade_sell");
    assert.ok(sells.length, `round ${round} has a sale`);
    for (const o of sells) {
      if (done >= MAX_TRADES_PER_PLAYER_DAY) break;
      const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: o.id });
      const terms = verifySignedOrderLocally(trade.order, { market: MARKET, nftContract: NFTS });
      assert.equal(terms.kind, "sell");
      assert.ok(BigInt(terms.price) < REFERENCE.common);
      done++;
    }
    if (done >= MAX_TRADES_PER_PLAYER_DAY) break;
  }
  assert.equal(done, MAX_TRADES_PER_PLAYER_DAY);
  assert.deepEqual((await encounter(alice)).menu, []);
});

test("the trader pays no premium when its purse cannot cover the order", { skip }, async (t) => {
  const { c, player, encounter } = setup(t);
  const [wanted] = wantedEditions(ACTOR.id, DAY);
  const alice = player("Alice", "alice.testnet");
  c.s.owner.set(`aura:${wanted}:3`, "alice.testnet");
  c.s.credit.set(NPC, 0n);
  assert.equal((await encounter(alice)).menu.filter((o) => o.kind === "trade_buy").length, 0);
});

test("a trade-up turns three handed-over commons into one rare Aura", { skip }, async (t) => {
  const { c, service, player, encounter, db } = setup(t);
  const alice = player("Alice", "alice.testnet");
  for (const id of ["aura:ember:1", "aura:ember:2", "aura:dew:3"]) c.s.owner.set(id, "alice.testnet");
  const enc = await encounter(alice);
  const offer = enc.menu.find((o) => o.kind === "trade_up");
  assert.ok(offer);
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  assert.equal(trade.receiver, NPC);
  await assert.rejects(service.completeTradeUp({ player: alice, actor: ACTOR, offerId: offer.id }), /Hand over/);
  for (const id of trade.tokens) c.s.owner.set(id, NPC);
  const done = await service.completeTradeUp({ player: alice, actor: ACTOR, offerId: offer.id });
  assert.equal(done.state, "completed");
  assert.equal(done.aura.rarity, "rare");
  assert.equal(service.ledger.held(ACTOR.id).length, 3);
  assert.equal((await service.completeTradeUp({ player: alice, actor: ACTOR, offerId: offer.id })).replay, true);
  assert.equal(db.prepare("SELECT count(*) n FROM inventory WHERE player_id=? AND name=?").get(alice, done.aura.name).n, 1);
});

test("the keeper sweeps only the surplus above the float, and only with no open buy", { skip }, async (t) => {
  const { c, service } = setup(t);
  const provider = { query: async () => ({ amount: String(YOCTO), storage_usage: 1000 }) };
  const keeper = createTraderKeeper({ service, provider, rewardsId: "rewards.testnet" });
  c.s.credit.set(NPC, FLOAT + SWEEP_BUFFER + 3n * YOCTO);
  const r = await keeper.tick({ execute: false });
  const sweep = r.reports[0].actions.find((a) => a.step === "sweep");
  assert.equal(sweep.amount, String(3n * YOCTO));
  assert.equal(r.reports[0].execute, false, "no account key: dry run");
  c.s.credit.set(NPC, FLOAT);
  const quiet = await keeper.tick({ execute: false });
  assert.equal(quiet.reports[0].actions.length, 0);
  const books = await service.books();
  assert.equal(books.traders[0].accountId, NPC);
  assert.equal(books.traders[0].startFloat, String(FLOAT));
});

test("traders files are testnet-only and keys must parse", () => {
  assert.throws(() => parseTraders({ network: "mainnet", traders: [] }));
  assert.throws(() =>
    parseTraders({ network: "testnet", traders: [{ actorId: "x1x", accountId: "npc.near", signingKey: KeyPair.fromRandom("ed25519").toString() }] }),
  );
});
