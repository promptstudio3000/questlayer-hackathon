// Relayer admission checks that need chain or game state: a sponsored call
// must not leak the relayer's budget or attached deposit (security pass F4-F6).
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { actions } from "near-api-js";
import { createPlayer } from "../server/database.mjs";
import { awardMessage } from "../server/native/award-vouchers.mjs";
import { SignedOrderIndex } from "../server/native/order-index.mjs";
import { STORAGE_DEPOSIT } from "../server/relayer/policy.mjs";
import { CONTRACTS, NOW, fixture } from "./relayer-fixture.mjs";

const GAS = 100_000_000_000_000n;
const fn = (method, args, deposit) =>
  actions.functionCall(method, args, GAS, deposit);
const code = (expected) => (error) => error.code === expected;
const counts = (f) => ({
  jobs: f.db.prepare("SELECT COUNT(*) AS n FROM relay_jobs").get().n,
  reserved: f.db.prepare("SELECT COUNT(*) AS n FROM subsidy_reservations").get().n,
});

function awardKey() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey
      .export({ type: "spki", format: "der" })
      .subarray(-32)
      .toString("base64"),
    sign: (message) =>
      sign(null, Buffer.from(message), pair.privateKey).toString("base64"),
  };
}

test("redeem_aura is sponsored only for a real, unredeemed, unexpired voucher (F5)", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  const award = awardKey(),
    claimed = new Map();
  f.state.view = (contract, method, args) => {
    assert.equal(contract, CONTRACTS.collectibles);
    if (method === "get_award_signer") return award.publicKey;
    if (method === "get_claim") return claimed.get(args.claim_id) ?? null;
    if (method === "edition_minted") return 3;
    throw Error(`unexpected view ${method}`);
  };
  const voucher = (claimId, { expires = NOW + 15 * 60000, key = award } = {}) => {
    const claim = {
      claim_id: claimId,
      edition: "polar",
      receiver_id: acct.accountId,
      expires_at: expires,
    };
    return {
      claim_id: claimId,
      edition: "polar",
      receiver_id: acct.accountId,
      expires_at_ms: expires,
      signature: key.sign(awardMessage(CONTRACTS.collectibles, claim)),
    };
  };
  const submit = async (args) =>
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, {
        action: fn("redeem_aura", args, STORAGE_DEPOSIT),
      }),
    });
  // A voucher the game never signed: the call would fail on chain and the
  // relayer-carried 0.05 NEAR would be refunded to the player.
  await assert.rejects(
    submit(voucher("earned:aura_forged", { key: awardKey() })),
    code("RELAY_CLAIM_SIGNATURE"),
  );
  // A genuine voucher with its fields changed.
  await assert.rejects(
    submit({ ...voucher("earned:aura_1"), claim_id: "earned:aura_2" }),
    code("RELAY_CLAIM_SIGNATURE"),
  );
  // An already redeemed claim: the contract returns the token and refunds
  // the whole deposit to the player.
  claimed.set("earned:aura_done", { token_id: "aura:polar:1" });
  await assert.rejects(
    submit(voucher("earned:aura_done")),
    code("RELAY_CLAIM_USED"),
  );
  await assert.rejects(
    submit(voucher("earned:aura_old", { expires: NOW + 30000 })),
    code("RELAY_CLAIM_EXPIRED"),
  );
  assert.deepEqual(counts(f), { jobs: 0, reserved: 0 });
  // The real voucher is admitted once; a second delegate for it is refused
  // while the first is in flight.
  const job = await submit(voucher("earned:aura_real"));
  assert.equal(job.state, "queued");
  await assert.rejects(
    submit(voucher("earned:aura_real")),
    code("RELAY_CLAIM_PENDING"),
  );
  assert.deepEqual(counts(f), { jobs: 1, reserved: 1 });
});

test("cancel_order is sponsored only for an open indexed order, within daily caps (F6)", async (t) => {
  const f = fixture({
    relayerOptions: { maxCancelsPerDay: 2, maxCancelsGlobalPerDay: 3 },
  });
  t.after(() => f.db.close());
  new SignedOrderIndex(f.db, { contractId: CONTRACTS.market });
  const bobPlayer = createPlayer(f.db, "Bob Dvořák", NOW);
  const alice = f.ready(),
    bob = { ...f.ready(bobPlayer, "bob-dvorak"), playerId: bobPlayer };
  const order = (maker, n) => ({
    message: JSON.stringify({ maker, n }),
    nonce: Buffer.alloc(32, n).toString("base64"),
    recipient: CONTRACTS.market,
    public_key: "ed25519:11111111111111111111111111111111",
    signature: Buffer.alloc(64, n).toString("base64"),
  });
  const index = (maker, n, { state = "open", deadline = NOW + 7 * 86400000 } = {}) => {
    const o = order(maker, n);
    f.db
      .prepare(
        `INSERT INTO signed_market_orders(id,market,maker,nonce,kind,token_id,price,deadline_ms,epoch,signed_order,state,fillable,received_at,checked_at)
         VALUES(?,?,?,?,'sell','aura:polar:1','1000',?,0,?,?,1,?,?)`,
      )
      .run(`${maker}:${o.nonce}`, CONTRACTS.market, maker, o.nonce, deadline, JSON.stringify(o), state, NOW, NOW);
    return o;
  };
  const cancel = async (acct, o) =>
    f.relayer.submit(acct.playerId ?? f.player, {
      signedDelegateBase64: await f.sign(acct, {
        receiverId: CONTRACTS.market,
        action: fn("cancel_order", { order: o }, 1n),
      }),
    });
  // Self-signed orders that never entered the book: each sponsored cancel
  // would take one of the market's 1024 nonce slots for up to 30 days.
  await assert.rejects(cancel(alice, order(alice.accountId, 1)), code("RELAY_ORDER_UNKNOWN"));
  index(alice.accountId, 2, { state: "filled" });
  await assert.rejects(cancel(alice, order(alice.accountId, 2)), code("RELAY_ORDER_UNKNOWN"));
  index(alice.accountId, 3, { deadline: NOW - 1 });
  await assert.rejects(cancel(alice, order(alice.accountId, 3)), code("RELAY_ORDER_UNKNOWN"));
  // Another maker's order, and a book order whose signed body was altered.
  const bobs = index(bob.accountId, 4);
  await assert.rejects(cancel(alice, bobs), code("RELAY_ORDER_UNKNOWN"));
  const a5 = index(alice.accountId, 5);
  await assert.rejects(cancel(alice, { ...a5, message: "{}" }), code("RELAY_ORDER_UNKNOWN"));
  assert.deepEqual(counts(f), { jobs: 0, reserved: 0 });

  assert.equal((await cancel(alice, a5)).state, "queued");
  await assert.rejects(cancel(alice, a5), code("RELAY_ORDER_PENDING"));
  const a6 = index(alice.accountId, 6),
    a7 = index(alice.accountId, 7);
  assert.equal((await cancel(alice, a6)).state, "queued");
  // Per-account cap (2 a day).
  await assert.rejects(cancel(alice, a7), code("RELAY_CANCEL_BUDGET"));
  // Service-wide cap (3 a day) across accounts.
  assert.equal((await cancel(bob, bobs)).state, "queued");
  await assert.rejects(cancel(bob, index(bob.accountId, 8)), code("RELAY_CANCEL_BUDGET"));
  // cancel_all_orders stays sponsored: it bumps the epoch and uses no nonce slot.
  const all = await f.relayer.submit(f.player, {
    signedDelegateBase64: await f.sign(alice, {
      receiverId: CONTRACTS.market,
      action: fn("cancel_all_orders", {}, 1n),
    }),
  });
  assert.equal(all.state, "queued");
  // The caps are per UTC day.
  f.advance(86400000);
  assert.equal((await cancel(alice, a7)).state, "queued");
});

test("a 0.05 NEAR SocialDB deposit is sponsored only while storage is short (F4)", async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const acct = f.ready();
  let storage = null;
  f.state.view = (contract, method, args) => {
    assert.equal(contract, CONTRACTS.social);
    assert.equal(method, "storage_balance_of");
    assert.equal(args.account_id, acct.accountId);
    return storage;
  };
  const uuid = "0f8c2a54-7b1e-4c3d-9a6f-2b5e8d1c4a7f";
  const profile = (n) => ({
    data: {
      [acct.accountId]: {
        questlayer: {
          profile: {
            schema: "1",
            name: "Alice",
            avatar_contract: "",
            avatar_token_id: "",
            updated_at: String(n),
            mutation_id: `profile_${uuid}`,
          },
        },
      },
    },
  });
  const publish = async (n, deposit) =>
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, {
        receiverId: CONTRACTS.social,
        action: fn("set", profile(n), deposit),
      }),
    });
  // No SocialDB storage yet: the first record carries the storage deposit.
  assert.equal((await publish(1, STORAGE_DEPOSIT)).state, "queued");
  // With enough storage the game quotes 1 yocto; another 0.05 NEAR is refused.
  storage = { total: "50000000000000000000000", available: "40000000000000000000000" };
  await assert.rejects(publish(2, STORAGE_DEPOSIT), code("RELAY_SOCIAL_STORAGE"));
  assert.equal((await publish(3, 1n)).state, "queued");
  // 0.01-0.02 NEAR free: a map note record is still quoted the deposit
  // (server/native/social-records.mjs), so admission must accept it.
  storage = { total: "50000000000000000000000", available: "15000000000000000000000" };
  assert.equal((await publish(4, STORAGE_DEPOSIT)).state, "queued");
  // Arbitrary SocialDB data is not sponsored at all.
  await assert.rejects(
    f.relayer.submit(f.player, {
      signedDelegateBase64: await f.sign(acct, {
        receiverId: CONTRACTS.social,
        action: fn("set", { data: { [acct.accountId]: { blob: "x".repeat(3000) } } }, 1n),
      }),
    }),
    code("RELAY_SOCIAL_SHAPE"),
  );
});
