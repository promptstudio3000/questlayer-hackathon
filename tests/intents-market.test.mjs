import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";
import { openDatabase } from "../server/database.mjs";
import { IntentsMarket, createIntentsRoutes } from "../server/native/intents-market.mjs";
import {
  auraTokenDiff,
  intentMessage,
  netDeltas,
  signIntentWithKeyPair,
  verifyIntentLocally,
  versionedNonce,
} from "../server/native/intents.mjs";

const VERIFIER = "questlayer-intents-20261104.testnet",
  NFT = "nfts.questlayer-dev-20261101.testnet",
  WNEAR = "wrap.testnet",
  AURA = "aura:polar:1",
  PRICE = (10n ** 22n).toString(),
  SALT = "a1b2c3d4";
const keys = { "alice.testnet": KeyPair.fromRandom("ed25519"), "bob.testnet": KeyPair.fromRandom("ed25519") };

/** In-memory stand-in for the verifier's views and execute_intents. */
function fakeVerifier(now) {
  const balances = new Map(),
    used = new Set(),
    registered = new Set(Object.entries(keys).map(([a, k]) => `${a}|${k.getPublicKey()}`));
  const bal = (a, t) => balances.get(`${a}|${t}`) || 0n;
  const setBal = (a, t, v) => balances.set(`${a}|${t}`, v);
  const apply = (signedList) => {
    const bodies = signedList.map((s) => verifyIntentLocally(s, { verifier: VERIFIER, nowMs: now() }));
    for (const b of bodies) {
      assert.ok(registered.has(`${b.signerId}|${b.publicKey}`));
      assert.ok(!used.has(`${b.signerId}|${b.nonce}`), "nonce used");
    }
    if (Object.keys(netDeltas(bodies)).length) return { invariant_violated: { unmatched_deltas: netDeltas(bodies) } };
    return { bodies };
  };
  const reader = {
    contractId: VERIFIER,
    calls: [],
    async view(method, args) {
      this.calls.push(method);
      switch (method) {
        case "current_salt": return SALT;
        case "fee": return 0;
        case "is_valid_salt": return args.salt === SALT;
        case "has_public_key": return registered.has(`${args.account_id}|${args.public_key}`);
        case "is_nonce_used": return used.has(`${args.account_id}|${args.nonce}`);
        case "mt_balance_of": return bal(args.account_id, args.token_id).toString();
        case "mt_batch_balance_of": return args.token_ids.map((t) => bal(args.account_id, t).toString());
        case "mt_tokens_for_owner": return [...balances].filter(([k, v]) => k.startsWith(args.account_id + "|") && v > 0n).map(([k]) => ({ token_id: k.split("|")[1] }));
        case "simulate_intents": { const r = apply(args.signed); return { invariant_violated: r.invariant_violated ?? null }; }
        default: throw Error(`unexpected view ${method}`);
      }
    },
  };
  const solver = {
    accountId: "relayer.testnet",
    sent: [],
    account: {
      async callFunctionRaw({ contractId, methodName, args, deposit }) {
        assert.equal(contractId, VERIFIER);
        assert.equal(methodName, "execute_intents");
        assert.equal(deposit, 0n);
        const r = apply(args.signed);
        assert.ok(!r.invariant_violated);
        for (const b of r.bodies) {
          used.add(`${b.signerId}|${b.nonce}`);
          for (const i of b.intents)
            if (i.intent === "token_diff")
              for (const [t, v] of Object.entries(i.diff)) setBal(b.signerId, t, bal(b.signerId, t) + BigInt(v));
            else if (i.intent === "nft_withdraw") setBal(b.signerId, `nep171:${i.token}:${i.token_id}`, 0n);
        }
        solver.sent.push(args.signed.length);
        return { transaction: { hash: `TX${solver.sent.length}`.padEnd(44, "1") }, status: { SuccessValue: "" }, receipts_outcome: [] };
      },
    },
  };
  return { reader, solver, setBal, bal, used };
}

function signed(signerId, intents, now, ttl = 3600_000) {
  const deadlineMs = now + ttl;
  return signIntentWithKeyPair(keys[signerId], {
    message: intentMessage({ signerId, deadlineMs, intents }),
    nonce: versionedNonce({ salt: SALT, deadlineMs }),
    recipient: VERIFIER,
  });
}
function setup() {
  let t = Date.parse("2026-11-04T03:00:00Z");
  const now = () => t;
  const db = openDatabase(":memory:");
  const v = fakeVerifier(now);
  const market = new IntentsMarket(db, { verifier: v.reader, nftContract: NFT, wnear: WNEAR, solver: v.solver, now });
  return { db, v, market, now, advance: (ms) => (t += ms) };
}
const nft = `nep171:${NFT}:${AURA}`,
  ft = `nep141:${WNEAR}`;
const sell = () => auraTokenDiff({ side: "sell", nftContract: NFT, tokenId: AURA, price: PRICE, wnear: WNEAR });
const buy = (price = PRICE) => auraTokenDiff({ side: "buy", nftContract: NFT, tokenId: AURA, price, wnear: WNEAR });

test("a funded sell intent is listed and a matching buy settles atomically through the solver", async () => {
  const { v, market, now } = setup();
  v.setBal("alice.testnet", nft, 1n);
  v.setBal("bob.testnet", ft, BigInt(PRICE));
  const order = await market.submit(signed("alice.testnet", [sell()], now()));
  assert.equal(order.state, "open");
  assert.equal(order.side, "sell");
  assert.equal(market.list().length, 1);
  const filled = await market.fill(order.id, signed("bob.testnet", [buy()], now()));
  assert.equal(filled.state, "filled");
  assert.equal(filled.taker, "bob.testnet");
  assert.match(filled.transactionHash, /^TX1/);
  assert.equal(v.bal("bob.testnet", nft), 1n);
  assert.equal(v.bal("alice.testnet", nft), 0n);
  assert.equal(v.bal("alice.testnet", ft), BigInt(PRICE));
  assert.equal(v.bal("bob.testnet", ft), 0n);
  assert.deepEqual(v.solver.sent, [2]);
  assert.equal(market.list().length, 0);
  assert.equal(market.settlements()[0].kind, "trade");
  await assert.rejects(market.fill(order.id, signed("bob.testnet", [buy()], now())), /no longer open/);
});

test("unfunded, mismatched and self trades are refused before anything is sent", async () => {
  const { v, market, now } = setup();
  await assert.rejects(market.submit(signed("alice.testnet", [sell()], now())), /Deposit the Aura/);
  v.setBal("alice.testnet", nft, 1n);
  const order = await market.submit(signed("alice.testnet", [sell()], now()));
  await assert.rejects(market.fill(order.id, signed("bob.testnet", [buy()], now())), /Deposit enough wNEAR/);
  v.setBal("bob.testnet", ft, BigInt(PRICE));
  await assert.rejects(market.fill(order.id, signed("bob.testnet", [buy((10n ** 21n).toString())], now())), /does not match/);
  await assert.rejects(market.fill(order.id, signed("alice.testnet", [buy()], now())), /own order/);
  assert.deepEqual(v.solver.sent, []);
  assert.equal(market.row(order.id).state, "open");
});

test("reconcile closes expired, used and withdrawn orders", async () => {
  const { v, market, now, advance } = setup();
  v.setBal("alice.testnet", nft, 1n);
  const short = await market.submit(signed("alice.testnet", [sell()], now(), 60_000));
  const long = await market.submit(signed("alice.testnet", [sell()], now()));
  advance(120_000);
  v.setBal("alice.testnet", nft, 0n);
  const r = await market.reconcile();
  assert.deepEqual(r, { checked: 2, closed: 2 });
  assert.equal(market.row(short.id).state, "expired");
  assert.equal(market.row(long.id).state, "closed");
  assert.match(market.row(long.id).reason, /funded/);
});

test("withdrawals go back to the signer only and are submitted by the solver", async () => {
  const { v, market, now } = setup();
  v.setBal("alice.testnet", nft, 1n);
  const ok = await market.withdraw(
    signed("alice.testnet", [{ intent: "nft_withdraw", token: NFT, token_id: AURA, receiver_id: "alice.testnet" }], now()),
  );
  assert.match(ok.transactionHash, /^TX1/);
  assert.equal(v.bal("alice.testnet", nft), 0n);
  await assert.rejects(
    market.withdraw(signed("alice.testnet", [{ intent: "nft_withdraw", token: NFT, token_id: AURA, receiver_id: "eve.testnet" }], now())),
    /own account/,
  );
});

test("routes report disabled without a verifier and require sign-in for writes", async () => {
  const respond = (res, value) => (res.value = value);
  const check = (cond, message, status = 400) => { if (!cond) throw Object.assign(Error(message), { status }); };
  const req = (method) => ({ method });
  const off = createIntentsRoutes(null);
  const res = {};
  assert.equal(await off.handle(req("GET"), res, new URL("http://x/api/native/intents"), { respond, assert: check }), true);
  assert.deepEqual(res.value, { enabled: false });
  const { market } = setup();
  const on = createIntentsRoutes(market);
  const r2 = {};
  await on.handle(req("GET"), r2, new URL("http://x/api/native/intents"), { respond, assert: check });
  assert.equal(r2.value.enabled, true);
  assert.equal(r2.value.experimental, true);
  assert.equal(r2.value.salt, SALT);
  await assert.rejects(
    on.handle(req("POST"), {}, new URL("http://x/api/native/intents/orders"), { player: null, body: async () => ({}), respond, assert: check }),
    /Sign in/,
  );
});
