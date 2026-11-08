// NPC traders on NEAR Intents (N3): pricing always favours the treasury, a
// deal settles as the player's signed token_diff against the trader's private
// opposite intent, the buyer pays the verifier fee, caps hold, fills settle
// into the books, trade-ups pay a rare Aura, and the keeper runs the trader's
// stock and purse inside the verifier and sweeps surplus to the treasury.
import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { IntentsMarket } from "../server/native/intents-market.mjs";
import { SubsidyBudget } from "../server/relayer/subsidy-budget.mjs";
import {
  TREASURY_FEE_PIPS,
  auraTokenDiff,
  feeForGross,
  grossForNet,
  intentMessage,
  netDeltas,
  signIntentWithKeyPair,
  verifyIntentLocally,
  versionedNonce,
} from "../server/native/intents.mjs";
import { NETWORK } from "../server/native/network.mjs";
import { parseTraders } from "../server/npc/trader-keys.mjs";
import { createTraderService } from "../server/npc/trader.mjs";
import { createTraderKeeper, stockClaimId, sweepReceiptId } from "../server/npc/trader-keeper.mjs";
import { awardMessage } from "../server/native/award-vouchers.mjs";
import { offerFacts } from "../server/npc/offers.mjs";
import {
  FLOAT,
  MAX_TRADES_PER_PLAYER_DAY,
  MILLI,
  PATRON_BUDGET_RESERVE_BPS,
  REFERENCE,
  SEED_PER_DAY,
  STOCK_EDITIONS,
  STOCK_RESERVE,
  STOCK_TARGET,
  pickStockEdition,
  rarityOf,
  SWEEP_BUFFER,
  YOCTO,
  budgetLeftFor,
  discountSellPrice,
  premiumBudget,
  premiumBuyPrice,
  referenceValue,
  sweepableSurplus,
  wantedEditions,
} from "../server/npc/trader-pricing.mjs";

const skip = NETWORK !== "testnet";
const NFTS = "nfts.testnet",
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

const VERIFIER = "intents.op.testnet",
  WNEAR = "wrap.testnet",
  COLLECTOR = "op.testnet",
  SALT = "a1b2c3d4";
const ft = `nep141:${WNEAR}`,
  nft = (tokenId) => `nep171:${NFTS}:${tokenId}`;
const playerKeys = new Map();
const keyOf = (account) => {
  if (!playerKeys.has(account)) playerKeys.set(account, KeyPair.fromRandom("ed25519"));
  return playerKeys.get(account);
};

/** Wallet NFTs plus an in-memory NEAR Intents verifier (fee to the collector). */
function chain({ fee = TREASURY_FEE_PIPS, now = () => Date.now() } = {}) {
  const s = { owner: new Map(), balances: new Map(), used: new Set(), keys: new Set(), fee, executed: [], failNext: false };
  const bal = (a, t) => s.balances.get(`${a}|${t}`) || 0n;
  const setBal = (a, t, v) => s.balances.set(`${a}|${t}`, v);
  const apply = (signed) => {
    const bodies = signed.map((x) => verifyIntentLocally(x, { verifier: VERIFIER, nowMs: now() }));
    for (const b of bodies) {
      assert.ok(s.keys.has(`${b.signerId}|${b.publicKey}`), `${b.signerId} key registered`);
      assert.ok(!s.used.has(`${b.signerId}|${b.nonce}`), "nonce used");
    }
    const net = netDeltas(bodies, s.fee);
    return Object.keys(net).length ? { invariant_violated: { unmatched_deltas: net } } : { bodies };
  };
  const reader = {
    contractId: VERIFIER,
    async view(method, args = {}) {
      switch (method) {
        case "current_salt": return SALT;
        case "fee": return s.fee;
        case "is_valid_salt": return args.salt === SALT;
        case "has_public_key": return s.keys.has(`${args.account_id}|${args.public_key}`);
        case "is_nonce_used": return s.used.has(`${args.account_id}|${args.nonce}`);
        case "mt_balance_of": return bal(args.account_id, args.token_id).toString();
        case "mt_batch_balance_of": return args.token_ids.map((t) => bal(args.account_id, t).toString());
        case "mt_tokens_for_owner":
          return [...s.balances].filter(([k, v]) => k.startsWith(args.account_id + "|") && v > 0n).map(([k]) => ({ token_id: k.split("|")[1] }));
        case "simulate_intents": return { invariant_violated: apply(args.signed).invariant_violated ?? null };
      }
      throw new Error(method);
    },
  };
  const solver = {
    accountId: "relayer.testnet",
    account: {
      async callFunctionRaw({ methodName, args }) {
        assert.equal(methodName, "execute_intents");
        const r = apply(args.signed);
        assert.ok(!r.invariant_violated);
        for (const b of r.bodies) {
          s.used.add(`${b.signerId}|${b.nonce}`);
          for (const i of b.intents)
            for (const [t, v] of Object.entries(i.diff || {})) {
              setBal(b.signerId, t, bal(b.signerId, t) + BigInt(v));
              if (BigInt(v) < 0n && t.startsWith("nep141:")) setBal(COLLECTOR, t, bal(COLLECTOR, t) + feeForGross(-BigInt(v), s.fee));
            }
        }
        s.executed.push(r.bodies.map((b) => b.signerId));
        const hash = `${s.executed.length}Wn3n9sZ7nK5YbYdH1Wf3pX6c8fQx2mKjv9JQw7sC`.padEnd(44, "q");
        if (s.failNext) {
          s.failNext = false;
          throw new Error("RPC timeout after send");
        }
        return { transaction: { hash }, status: { SuccessValue: "" }, receipts_outcome: [] };
      },
    },
  };
  const nfts = {
    contractId: NFTS,
    view: async (method, args = {}) => {
      if (method === "nft_token") return s.owner.has(args.token_id) ? { token_id: args.token_id, owner_id: s.owner.get(args.token_id) } : null;
      if (method === "get_award_signer") return s.awardKey || null;
      if (method === "edition_minted") return s.minted?.[args.edition] || 0;
      if (method === "get_claim_token") return s.claims?.get(args.claim_id) || null;
      if (method === "nft_tokens_for_owner")
        return [...s.owner.entries()].filter(([, o]) => o === args.account_id).map(([token_id, owner_id]) => ({ token_id, owner_id }));
      throw new Error(method);
    },
  };
  /** Puts an Aura into an account's verifier balance (nft_transfer_call). */
  const deposit = (account, tokenId) => {
    s.owner.set(tokenId, VERIFIER);
    setBal(account, nft(tokenId), 1n);
  };
  const stockOf = (account) => [...s.balances].filter(([k, v]) => k.startsWith(`${account}|nep171:`) && v > 0n).length;
  return { s, reader, solver, nfts, bal, setBal, deposit, stockOf };
}

function setup(t, { now = Date.now(), fee = TREASURY_FEE_PIPS } = {}) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  let clock = now;
  const c = chain({ fee, now: () => clock });
  const subsidyBudget = new SubsidyBudget(db, { dailyYocto: 10n ** 24n, dailyOperations: 1000, gasReserveYocto: 3n * 10n ** 22n, clock: () => clock });
  const intents = new IntentsMarket(db, { verifier: c.reader, nftContract: NFTS, wnear: WNEAR, solver: c.solver, subsidyBudget, now: () => clock });
  const traders = parseTraders({
    network: "testnet",
    traders: [
      { actorId: ACTOR.id, accountId: NPC, signingKey: KeyPair.fromRandom("ed25519").toString(), fundedAt: new Date(now).toISOString() },
    ],
  });
  const trader = traders.get(ACTOR.id);
  c.s.keys.add(`${NPC}|${trader.signingPublicKey}`);
  c.setBal(NPC, ft, FLOAT);
  const service = createTraderService({ db, traders, intents, nfts: c.nfts, clock: () => clock });
  const player = (name, account) => {
    const p = createPlayer(db, name, now);
    db.prepare("INSERT INTO wallet_links(account_id,player_id,verified_at) VALUES(?,?,?)").run(account, p, now);
    c.s.keys.add(`${account}|${keyOf(account).getPublicKey()}`);
    return p;
  };
  const encounter = async (p) => {
    const menu = await service.menu({ actor: ACTOR, player: p, dayId: DAY, now: clock, expiresAt: clock + 300_000 });
    return { menu, dayId: DAY, encounterId: "enc" };
  };
  /** The player's side of a deal, as the NPC sheet signs it with the device key. */
  const sign = (account, trade, { price = trade.intents.price, side = trade.intents.side } = {}) => {
    const deadlineMs = clock + 600_000;
    return signIntentWithKeyPair(keyOf(account), {
      message: intentMessage({
        signerId: account,
        deadlineMs,
        intents: [auraTokenDiff({ side, nftContract: NFTS, tokenId: trade.tokenId, price, wnear: WNEAR, feePips: trade.intents.feePips })],
      }),
      nonce: versionedNonce({ salt: SALT, deadlineMs }),
      recipient: VERIFIER,
    });
  };
  return { db, c, intents, service, traders, player, encounter, sign, tick: (ms) => (clock += ms), now: () => clock };
}

test("a premium buy settles on NEAR Intents for that exact token, and the trader pays the fee", { skip }, async (t) => {
  const { c, service, player, encounter, sign, intents } = setup(t);
  const [wanted] = wantedEditions(ACTOR.id, DAY);
  const token = `aura:${wanted}:7`;
  const alice = player("Alice", "alice.testnet"),
    bob = player("Bob", "bob.testnet");
  c.s.owner.set(token, "alice.testnet");
  const enc = await encounter(alice);
  const offer = enc.menu.find((o) => o.kind === "trade_buy");
  assert.ok(offer, "Alice is offered a premium for her wanted Aura");
  assert.equal(offer.terms.tokenId, token);
  assert.equal(offer.terms.traderPays, grossForNet(offer.terms.price, TREASURY_FEE_PIPS).toString());
  assert.match(offerFacts([offer])[0].text, /NEAR Intents/);
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  assert.equal(trade.state, "issued");
  assert.deepEqual(
    { side: trade.intents.side, price: trade.intents.price, verifier: trade.intents.verifier },
    { side: "sell", price: offer.terms.price, verifier: VERIFIER },
  );
  // Accepting reserves the deal and signs nothing; the trader's intent is never listed.
  assert.equal(intents.list().length, 0);
  const again = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  assert.equal(again.tradeId, trade.tradeId);
  // Bob cannot use Alice's offer: it is not on his encounter menu.
  const bobEnc = await encounter(bob);
  await assert.rejects(service.accept({ player: bob, actor: ACTOR, encounter: bobEnc, offerId: offer.id }), /no longer available/);
  await assert.rejects(service.fill({ player: bob, tradeId: trade.tradeId, signed: sign("bob.testnet", trade) }), /no such trade/);
  // Alice deposits the Aura and signs her sell side; a lower or higher price does not match.
  c.deposit("alice.testnet", token);
  await assert.rejects(
    service.fill({ player: alice, tradeId: trade.tradeId, signed: sign("alice.testnet", trade, { price: String(BigInt(trade.price) + MILLI) }) }),
    /does not match/,
  );
  const filled = await service.fill({ player: alice, tradeId: trade.tradeId, signed: sign("alice.testnet", trade) });
  assert.equal(filled.state, "filled");
  assert.ok(filled.txHash);
  assert.deepEqual(c.s.executed, [[NPC, "alice.testnet"]], "one execute_intents with both sides");
  const gross = grossForNet(trade.price, TREASURY_FEE_PIPS);
  assert.equal(c.bal("alice.testnet", ft), BigInt(trade.price), "the seller receives the price exactly");
  assert.equal(c.bal(NPC, ft), FLOAT - gross);
  assert.equal(c.bal(COLLECTOR, ft), gross - BigInt(trade.price), "the fee goes to the treasury collector");
  assert.equal(c.bal(NPC, nft(token)), 1n);
  const lot = service.ledger.heldLot(ACTOR.id, token);
  assert.equal(lot.cost, gross.toString(), "the trader's cost basis includes the fee");
  assert.equal((await service.fill({ player: alice, tradeId: trade.tradeId, signed: sign("alice.testnet", trade) })).replay, true);
});

test("caps stop the fourth trade of the day with one trader", { skip }, async (t) => {
  const { c, service, player, encounter } = setup(t);
  const alice = player("Alice", "alice.testnet");
  // Stock from earlier trade-ups (cost 0) in the verifier for four sales.
  for (let i = 1; i <= 4; i++) {
    c.deposit(NPC, `aura:ember:${i}`);
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
      assert.equal(trade.intents.side, "buy");
      assert.ok(BigInt(trade.price) < REFERENCE.common);
      assert.equal(trade.intents.buyerPays, o.terms.buyerPays, "the player pays the price plus the fee");
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
  c.setBal(NPC, ft, 0n);
  assert.equal((await encounter(alice)).menu.filter((o) => o.kind === "trade_buy").length, 0);
});

test("two buy orders accepted at once never promise more than the trader's purse", { skip }, async (t) => {
  const { c, service, player, encounter } = setup(t);
  const [wanted] = wantedEditions(ACTOR.id, DAY);
  const alice = player("Alice", "alice.testnet"),
    bob = player("Bob", "bob.testnet");
  c.s.owner.set(`aura:${wanted}:4`, "alice.testnet");
  c.s.owner.set(`aura:${wanted}:5`, "bob.testnet");
  const [ea, eb] = [await encounter(alice), await encounter(bob)];
  const [oa, ob] = [ea, eb].map((e) => e.menu.find((o) => o.kind === "trade_buy"));
  assert.ok(oa && ob, "both are offered a premium");
  // The purse covers either deal alone (price plus fee), not both.
  c.setBal(NPC, ft, BigInt(oa.terms.traderPays) + BigInt(ob.terms.traderPays) - 1n);
  const results = await Promise.allSettled([
    service.accept({ player: alice, actor: ACTOR, encounter: ea, offerId: oa.id }),
    service.accept({ player: bob, actor: ACTOR, encounter: eb, offerId: ob.id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const refused = results.find((r) => r.status === "rejected");
  assert.equal(refused.reason.code, "NPC_TRADE_BUDGET");
  assert.ok(service.ledger.reservedForBuys(ACTOR.id) <= c.bal(NPC, ft));
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

test("trader trades carry their on-chain proof: hand-over hashes and the fill", { skip }, async (t) => {
  const { c, service, player, encounter, db, sign } = setup(t);
  const alice = player("Alice", "alice.testnet");
  for (const id of ["aura:ember:1", "aura:ember:2", "aura:dew:3"]) c.s.owner.set(id, "alice.testnet");
  const enc = await encounter(alice);
  const offer = enc.menu.find((o) => o.kind === "trade_up");
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  // The relayer may sponsor exactly these three hand-overs to the trader.
  assert.deepEqual(service.handoversFor(alice), [{ accountId: "alice.testnet", receiver: NPC, tokens: trade.tokens }]);
  // Relayed nft_transfer jobs (as the relayer records them) become the proof.
  db.exec(`CREATE TABLE IF NOT EXISTS relay_jobs(account_id TEXT, receiver_id TEXT, method_name TEXT, transaction_hash TEXT, call TEXT, state TEXT, created_at INTEGER)`);
  const hashes = ["4Wn3n9sZ7nK5YbYdH1Wf3pX6c8fQx2mKjv9JQw7sCq1a", "5Wn3n9sZ7nK5YbYdH1Wf3pX6c8fQx2mKjv9JQw7sCq1b", "6Wn3n9sZ7nK5YbYdH1Wf3pX6c8fQx2mKjv9JQw7sCq1c"];
  trade.tokens.forEach((token, i) => {
    db.prepare("INSERT INTO relay_jobs VALUES(?,?,?,?,?,?,?)").run(
      "alice.testnet",
      NFTS,
      "nft_transfer",
      hashes[i],
      JSON.stringify({ args: { receiver_id: NPC, token_id: token } }),
      "confirmed",
      Date.now() + 1,
    );
    c.s.owner.set(token, NPC);
  });
  const done = await service.completeTradeUp({ player: alice, actor: ACTOR, offerId: offer.id });
  assert.deepEqual([...done.txHashes].sort(), [...hashes].sort());
  assert.ok(done.txHash && done.secureItemId === done.aura.id);
  assert.deepEqual(service.handoversFor(alice), []);
  const meta = JSON.parse(db.prepare("SELECT meta FROM history WHERE player_id=? AND kind='npc-trade'").get(alice).meta);
  assert.equal(meta.txHashes.length, 3);
  // A sale settles with the execute_intents transaction.
  const lot = "aura:polar:4";
  c.deposit(NPC, lot);
  service.ledger.addLot({ trader: ACTOR.id, tokenId: lot, cost: 0n, source: "trade_up" });
  const enc2 = await encounter(alice);
  const sellOffer = enc2.menu.find((o) => o.kind === "trade_sell" && o.terms.tokenId === lot);
  const sale = await service.accept({ player: alice, actor: ACTOR, encounter: enc2, offerId: sellOffer.id });
  // Without the price plus the fee in the verifier, nothing is sent.
  c.setBal("alice.testnet", ft, BigInt(sale.intents.buyerPays) - 1n);
  await assert.rejects(service.fill({ player: alice, tradeId: sale.tradeId, signed: sign("alice.testnet", sale) }), /Deposit enough wNEAR/);
  c.setBal("alice.testnet", ft, BigInt(sale.intents.buyerPays));
  const settled = await service.fill({ player: alice, tradeId: sale.tradeId, signed: sign("alice.testnet", sale) });
  assert.equal(c.bal("alice.testnet", nft(lot)), 1n);
  assert.equal(c.bal(NPC, ft), FLOAT + BigInt(sale.price), "the trader earns the price; the fee went to the treasury");
  const mine = service.myTrades(alice);
  const sold = mine.find((x) => x.tradeId === sale.tradeId);
  assert.equal(sold.state, "filled");
  assert.equal(sold.txHash, settled.txHash);
  const history = db.prepare("SELECT meta FROM history WHERE player_id=? AND kind='npc-trade' ORDER BY rowid DESC").get(alice);
  assert.equal(JSON.parse(history.meta).txHash, settled.txHash);
  await assert.rejects(service.recordTx({ player: alice, tradeId: sale.tradeId, transactionHash: "nope" }), /Invalid transaction hash/);
});

test("the keeper sweeps only the surplus above the float, and only with no open buy", { skip }, async (t) => {
  const { c, service } = setup(t);
  const provider = fakeProvider(() => YOCTO, { storage_usage: 1000 });
  const keeper = createTraderKeeper({ service, provider, rewardsId: "rewards.testnet" });
  c.setBal(NPC, ft, FLOAT + SWEEP_BUFFER + 3n * YOCTO);
  const r = await keeper.tick({ execute: false });
  const sweep = r.reports[0].actions.find((a) => a.step === "sweep");
  assert.equal(sweep.amount, String(3n * YOCTO));
  assert.equal(r.reports[0].execute, false, "no account key: dry run");
  c.setBal(NPC, ft, FLOAT);
  const quiet = await keeper.tick({ execute: false });
  assert.equal(quiet.reports[0].actions.length, 0);
  const books = await service.books();
  assert.equal(books.traders[0].accountId, NPC);
  assert.equal(books.traders[0].startFloat, String(FLOAT));
  assert.equal(books.traders[0].purse, String(FLOAT));
  assert.equal(books.venue, "near-intents");
});

test("traders files are testnet-only and keys must parse", () => {
  assert.throws(() => parseTraders({ network: "mainnet", traders: [] }));
  assert.throws(() =>
    parseTraders({ network: "testnet", traders: [{ actorId: "x1x", accountId: "npc.near", signingKey: KeyPair.fromRandom("ed25519").toString() }] }),
  );
});

test("stock editions always leave the treasury a margin over the mint cost", () => {
  assert.ok(STOCK_EDITIONS.length >= 2);
  for (const e of STOCK_EDITIONS) assert.ok(["rare", "epic"].includes(rarityOf(e)), `${e} is rare or epic`);
  assert.ok(!STOCK_EDITIONS.includes("ember"), "commons cannot carry the mint cost at 0.02");
  // Least-stocked first, never a claim-only edition.
  const first = pickStockEdition([], 0);
  assert.ok(STOCK_EDITIONS.includes(first));
  assert.notEqual(pickStockEdition([first], 0), first);
  // A real mint cost still sells at ≥ cost × 1.10 and below the book.
  for (const e of STOCK_EDITIONS) {
    const p = discountSellPrice(e, 22n * MILLI, null);
    assert.ok(p && p.price * 100n >= 22n * MILLI * 110n && p.price <= referenceValue(e));
  }
});

/** RPC stand-in: account balances plus wNEAR views for the keeper. */
function fakeProvider(amount, { storage_usage = 0, wnear = { registered: true, loose: 0n } } = {}) {
  return {
    query: async (q) => {
      if (q.request_type === "view_account") return { amount: String(amount()), storage_usage };
      const value =
        q.method_name === "storage_balance_of" ? (wnear.registered ? { total: "1250000000000000000000", available: "0" } : null)
        : q.method_name === "ft_balance_of" ? String(wnear.loose)
        : null;
      return { result: [...Buffer.from(JSON.stringify(value))] };
    },
  };
}

function stockKeeper(t, { liquid = YOCTO, awardKey } = {}) {
  const ctx = setup(t);
  const { c, service } = ctx;
  const signer = { publicKey: "award-pub", sign: (m) => `sig:${m.length}` };
  c.s.awardKey = awardKey ?? signer.publicKey;
  c.s.claims = new Map();
  c.s.minted = {};
  let amount = liquid;
  const calls = [];
  const account = {
    callFunctionRaw: async ({ contractId, methodName, args, deposit }) => {
      calls.push({ contractId, methodName, args, deposit });
      if (methodName === "redeem_aura") {
        const n = (c.s.minted[args.edition] || 0) + 1;
        c.s.minted[args.edition] = n;
        const tokenId = `aura:${args.edition}:${n}`;
        c.s.claims.set(args.claim_id, tokenId);
        c.s.owner.set(tokenId, args.receiver_id);
        amount -= 18n * MILLI; // storage + gas
      }
      if (methodName === "nft_transfer_call") {
        assert.equal(args.receiver_id, VERIFIER, "stock goes into the verifier");
        c.deposit(NPC, args.token_id);
        amount -= 2n * MILLI;
      }
      return { status: {}, transaction: { hash: `tx-${calls.length}` } };
    },
  };
  const provider = fakeProvider(() => amount);
  const keeper = createTraderKeeper({ service, provider, rewardsId: "rewards.testnet", awardSigner: signer, accountFor: () => account });
  return { ...ctx, keeper, calls, signer };
}

test("the keeper stocks an empty shelf with signed claims and escrows it", { skip }, async (t) => {
  const { c, keeper, calls, service, signer, encounter, player } = stockKeeper(t);
  for (let i = 0; i < STOCK_TARGET; i++) await keeper.tick({ execute: true });
  const redeems = calls.filter((x) => x.methodName === "redeem_aura");
  assert.equal(redeems.length, STOCK_TARGET, "one mint per tick until the shelf holds 3");
  const r0 = redeems[0];
  assert.equal(r0.contractId, NFTS);
  assert.equal(r0.args.receiver_id, NPC, "the trader redeems to itself");
  assert.match(r0.args.claim_id, /^earned:npc-stock:kupec-vojtech:\d{8}:1$/);
  assert.equal(r0.args.claim_id, stockClaimId(ACTOR.id, r0.args.claim_id.split(":")[3], 1));
  const msg = awardMessage(NFTS, { ...r0.args, expires_at: r0.args.expires_at_ms });
  assert.equal(r0.args.signature, signer.sign(msg));
  assert.equal(new Set(redeems.map((x) => x.args.edition)).size, STOCK_TARGET, "three different editions");
  assert.equal(c.stockOf(NPC), STOCK_TARGET, "all stock is in the verifier");
  const lots = service.ledger.held(ACTOR.id);
  assert.equal(lots.length, STOCK_TARGET);
  for (const lot of lots) assert.equal(BigInt(lot.cost), 21n * MILLI, "cost = measured spend + escrow allowance");
  // A full shelf mints nothing more.
  await keeper.tick({ execute: true });
  assert.equal(calls.filter((x) => x.methodName === "redeem_aura").length, STOCK_TARGET);
  // A brand-new explorer now sees sales above cost × 1.10.
  const enc = await encounter(player("Newbie", "newbie.testnet"));
  const sells = enc.menu.filter((o) => o.kind === "trade_sell");
  assert.ok(sells.length >= 1, "a fresh player sees offers");
  for (const o of sells) assert.ok(BigInt(o.terms.price) * 100n >= 21n * MILLI * 110n);
});

test("stocking needs the collection to trust the award key, liquid NEAR and a daily cap", { skip }, async (t) => {
  const wrong = stockKeeper(t, { awardKey: "someone-else" });
  const r = await wrong.keeper.tick({ execute: true });
  assert.deepEqual(r.reports[0].actions, [{ step: "stock", skipped: "award-signer" }]);
  const poor = stockKeeper(t, { liquid: YOCTO / 2n + 10n * MILLI });
  const p = await poor.keeper.tick({ execute: true });
  assert.equal(p.reports[0].actions[0].skipped, "low-liquid");
  assert.equal(poor.calls.length, 0);
  // Daily cap: sold-out stock refills at most 3 times a day.
  const busy = stockKeeper(t);
  for (let i = 0; i < 6; i++) {
    await busy.keeper.tick({ execute: true });
    for (const k of [...busy.c.s.balances.keys()]) if (k.startsWith(`${NPC}|nep171:`)) busy.c.s.balances.delete(k); // pretend everything sold
  }
  assert.equal(busy.calls.filter((x) => x.methodName === "redeem_aura").length, 3);
});

test("a sweep leaves a restocking reserve behind and sends the rest to the treasury", { skip }, async (t) => {
  const { c, service } = setup(t);
  const provider = fakeProvider(() => YOCTO / 2n); // no spare liquid
  const keeper = createTraderKeeper({ service, provider, rewardsId: "rewards.testnet" });
  c.setBal(NPC, ft, FLOAT + SWEEP_BUFFER + YOCTO);
  const sweep = (await keeper.tick({ execute: false })).reports[0];
  assert.equal(sweep.actions.find((a) => a.step === "sweep").amount, String(YOCTO - STOCK_RESERVE));
  assert.equal(sweep.stockReserve, String(STOCK_RESERVE));
});

const GOLD_U = 1_000_000;
// Patron rates follow staker-gates.json (patron_trader_rates = Staker + L4):
// a Tier 2 stake makes a Staker, and 900 XP is level 4.
const makePatron = (db, p, now) => {
  db.prepare("UPDATE players SET xp=900 WHERE id=?").run(p);
  return db
    .prepare("INSERT INTO positions(id,player_id,pool,active_u,contribution,matures_at,accrued_u,settled_at) VALUES(?,?,?,?,?,?,0,?)")
    .run(`pos-${p}`, p, "core", 50_000 * GOLD_U, 100, now - 1, now);
};

test("patron rates are better for the player and still keep the margin floor", () => {
  for (const edition of ["ember", "dew", "polar", "bloom", "storm", "moon", "comet"]) {
    for (const floor of [null, 5n * MILLI, 15n * MILLI, 40n * MILLI, 100n * MILLI, 400n * MILLI]) {
      const base = premiumBuyPrice(edition, floor),
        buy = premiumBuyPrice(edition, floor, { patron: true });
      if (base) assert.ok(buy && buy.price >= base.price, `${edition} patron premium is at least the normal one`);
      if (buy) assert.ok(buy.price * 110n <= buy.resale * 100n, `${edition} patron buy keeps the 10 % margin`);
      for (const cost of [0n, 10n * MILLI, 50n * MILLI]) {
        const normal = discountSellPrice(edition, cost, floor),
          sell = discountSellPrice(edition, cost, floor, { patron: true });
        if (normal) assert.ok(sell && sell.price <= normal.price, "patron price is never worse");
        if (sell) assert.ok(sell.price * 100n >= cost * 110n, "patron sale ≥ cost × 1.10");
      }
    }
  }
  assert.ok(discountSellPrice("polar", 0n, null, { patron: true }).price < discountSellPrice("polar", 0n, null).price);
  // Budget preference: non-patrons stop at the reserved share, patrons may use all of it.
  const budget = 100n * MILLI,
    reserve = (budget * PATRON_BUDGET_RESERVE_BPS) / 10000n;
  assert.equal(budgetLeftFor({ budget, spent: 0n }), budget - reserve);
  assert.equal(budgetLeftFor({ budget, spent: budget - reserve }), 0n);
  assert.equal(budgetLeftFor({ budget, spent: budget - reserve }, { patron: true }), reserve);
  assert.equal(budgetLeftFor({ budget, spent: budget }, { patron: true }), 0n);
});

test("only patrons (Staker + L4) see the rare → epic trade-up and patron sale prices", { skip }, async (t) => {
  const { c, service, player, encounter, db, now } = setup(t);
  const alice = player("Alice", "alice.testnet"),
    bob = player("Bob", "bob.testnet");
  makePatron(db, alice, now());
  for (const id of ["aura:polar:1", "aura:polar:2", "aura:bloom:3"]) c.s.owner.set(id, "alice.testnet");
  for (const id of ["aura:polar:4", "aura:polar:5", "aura:bloom:6"]) c.s.owner.set(id, "bob.testnet");
  c.deposit(NPC, "aura:storm:9");
  service.ledger.addLot({ trader: ACTOR.id, tokenId: "aura:storm:9", cost: 0n, source: "trade_up" });

  const bobEnc = await encounter(bob);
  assert.equal(bobEnc.menu.filter((o) => o.kind === "trade_up").length, 0, "no epic table for Tier 1");
  const bobSell = bobEnc.menu.find((o) => o.kind === "trade_sell");
  assert.equal(bobSell.terms.patron, false);

  const enc = await encounter(alice);
  const sell = enc.menu.find((o) => o.kind === "trade_sell");
  assert.equal(sell.terms.patron, true);
  assert.ok(BigInt(sell.terms.price) < BigInt(bobSell.terms.price), "patron pays less for the same lot");
  assert.match(sell.label, /patron rate/);
  const offer = enc.menu.find((o) => o.kind === "trade_up");
  assert.ok(offer, "the patron is offered the epic table");
  assert.equal(offer.terms.give, "rare");
  assert.equal(rarityOf(offer.terms.edition), "epic");
  // Bob cannot accept Alice's patron offer even with her menu in hand.
  await assert.rejects(service.accept({ player: bob, actor: ACTOR, encounter: enc, offerId: offer.id }), /patrons/);
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  for (const id of trade.tokens) c.s.owner.set(id, NPC);
  const done = await service.completeTradeUp({ player: alice, actor: ACTOR, offerId: offer.id });
  assert.equal(done.aura.rarity, "epic");
  // The trader gains three rares (cost 0) for an epic from game supply.
  assert.equal(service.ledger.held(ACTOR.id).filter((l) => rarityOf(l.token_id.split(":")[1]) === "rare").length, 3);
});

test("the keeper registers the trader's key, sweeps through the verifier and refills the float", { skip }, async (t) => {
  const { c, service, traders } = setup(t);
  const trader = traders.get(ACTOR.id);
  c.s.keys.delete(`${NPC}|${trader.signingPublicKey}`);
  c.setBal(NPC, ft, FLOAT + SWEEP_BUFFER + YOCTO);
  const calls = [];
  const account = {
    callFunctionRaw: async ({ contractId, methodName, args, deposit }) => {
      calls.push({ contractId, methodName, args, deposit });
      if (methodName === "add_public_key") c.s.keys.add(`${NPC}|${args.public_key}`);
      if (methodName === "ft_withdraw") c.setBal(NPC, ft, c.bal(NPC, ft) - BigInt(args.amount));
      if (methodName === "ft_transfer_call") c.setBal(NPC, ft, c.bal(NPC, ft) + BigInt(args.amount));
      return { status: {}, transaction: { hash: `tx-${calls.length}` } };
    },
  };
  const keeper = createTraderKeeper({ service, provider: fakeProvider(() => YOCTO), rewardsId: "rewards.testnet", stock: false, accountFor: () => account });
  const r = (await keeper.tick({ execute: true })).reports[0];
  assert.deepEqual(
    calls.map((x) => `${x.contractId}.${x.methodName}`),
    [`${VERIFIER}.add_public_key`, `${VERIFIER}.ft_withdraw`, `${WNEAR}.near_withdraw`, "rewards.testnet.fund_rewards"],
  );
  assert.equal(calls[0].args.public_key, trader.signingPublicKey);
  const sweep = r.actions.find((a) => a.step === "sweep");
  assert.equal(sweep.amount, String(YOCTO));
  assert.equal(calls[1].args.amount, String(YOCTO));
  assert.equal(calls[1].args.receiver_id, NPC, "the surplus comes back to the trader account first");
  assert.equal(calls[3].deposit, YOCTO + 5n * 10n ** 21n, "the surplus plus the rewards storage fee");
  assert.match(calls[3].args.receipt_id, /^npc-kupec-vojtech-\d{8}-1$/);
  assert.equal(c.bal(NPC, ft), FLOAT + SWEEP_BUFFER);
  // An interrupted sweep left the purse short: loose wNEAR goes back first, then wrapped NEAR.
  calls.length = 0;
  c.setBal(NPC, ft, FLOAT - YOCTO / 4n);
  const loose = { registered: true, loose: YOCTO / 10n };
  const refill = createTraderKeeper({ service, provider: fakeProvider(() => 2n * YOCTO, { wnear: loose }), rewardsId: "rewards.testnet", stock: false, accountFor: () => account });
  const restore = (await refill.tick({ execute: true })).reports[0].actions.find((a) => a.step === "restore-float");
  const want = YOCTO / 4n + SWEEP_BUFFER;
  assert.equal(restore.amount, String(want));
  assert.equal(restore.wrap, String(want - YOCTO / 10n));
  assert.deepEqual(
    calls.map((x) => `${x.contractId}.${x.methodName}`),
    [`${WNEAR}.near_deposit`, `${WNEAR}.ft_transfer_call`],
  );
  assert.equal(calls[1].args.receiver_id, VERIFIER);
  assert.equal(c.bal(NPC, ft), FLOAT + SWEEP_BUFFER);
});

test("a fill that stopped after it was sent is booked once the trader's nonce is used", { skip }, async (t) => {
  const { c, service, player, encounter, sign, tick } = setup(t);
  const alice = player("Alice", "alice.testnet");
  c.deposit(NPC, "aura:comet:2");
  service.ledger.addLot({ trader: ACTOR.id, tokenId: "aura:comet:2", cost: 0n, source: "trade_up" });
  const enc = await encounter(alice);
  const offer = enc.menu.find((o) => o.kind === "trade_sell");
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: offer.id });
  c.setBal("alice.testnet", ft, BigInt(trade.intents.buyerPays));
  c.s.failNext = true; // settled on chain, but the answer never came back
  await assert.rejects(service.fill({ player: alice, tradeId: trade.tradeId, signed: sign("alice.testnet", trade) }), /timeout/);
  assert.equal(service.ledger.trade(trade.tradeId).state, "issued");
  assert.equal((await service.reconcile()).settled, 1);
  assert.equal(service.ledger.trade(trade.tradeId).state, "filled");
  assert.equal(c.bal("alice.testnet", nft("aura:comet:2")), 1n);
  // An unsigned deal simply lapses at its deadline.
  c.deposit(NPC, "aura:moon:3");
  service.ledger.addLot({ trader: ACTOR.id, tokenId: "aura:moon:3", cost: 0n, source: "trade_up" });
  const enc2 = await encounter(alice);
  const other = await service.accept({ player: alice, actor: ACTOR, encounter: enc2, offerId: enc2.menu.find((o) => o.kind === "trade_sell").id });
  tick(10 * 60_000);
  await service.reconcile();
  assert.equal(service.ledger.trade(other.tradeId).state, "expired");
  await assert.rejects(service.fill({ player: alice, tradeId: other.tradeId, signed: sign("alice.testnet", other) }), /lapsed/);
});

test("a deal signed at one fee is refused after the verifier fee changes", { skip }, async (t) => {
  const { c, service, player, encounter, sign, tick } = setup(t, { fee: 0 });
  const alice = player("Alice", "alice.testnet");
  c.deposit(NPC, "aura:bloom:5");
  service.ledger.addLot({ trader: ACTOR.id, tokenId: "aura:bloom:5", cost: 0n, source: "trade_up" });
  const enc = await encounter(alice);
  const trade = await service.accept({ player: alice, actor: ACTOR, encounter: enc, offerId: enc.menu.find((o) => o.kind === "trade_sell").id });
  assert.equal(trade.intents.buyerPays, trade.price, "no fee, no extra");
  c.setBal("alice.testnet", ft, YOCTO);
  c.s.fee = TREASURY_FEE_PIPS;
  tick(61_000); // the fee cache refreshes after a minute
  await assert.rejects(service.fill({ player: alice, tradeId: trade.tradeId, signed: sign("alice.testnet", trade) }), /fee changed/);
  assert.deepEqual(c.s.executed, []);
});
