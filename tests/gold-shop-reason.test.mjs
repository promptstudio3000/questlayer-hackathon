import test from "node:test";
import assert from "node:assert/strict";
import { setSpendRealm } from "../server/gold-spend/ledger.mjs";
import { createGoldSpendRoutes } from "../server/gold-spend/routes.mjs";
import { assert as domainAssert } from "../server/domain.mjs";
import { buyBlock } from "../src/gold-shop-reason.ts";
import { purchaseFixture, TOKEN } from "./fixtures/qgold-purchase.mjs";

test("shop buttons say in plain words why an item cannot be bought", () => {
  const q = { realm: "qgold", balanceU: 1_000, balanceKnown: true, pendingU: 0, hasAccount: true };
  assert.equal(buyBlock(q, 1_000), null);
  assert.equal(buyBlock(q, 2_500).kind, "short");
  assert.match(buyBlock(q, 2_500).label, /1,500 more needed/);
  // Collected on the map and still being paid out: on the way, not "poor".
  assert.equal(buyBlock({ ...q, pendingU: 5_000 }, 2_500).kind, "on-the-way");
  assert.equal(buyBlock({ ...q, hasAccount: false }, 10).kind, "account");
  // A failed balance read never greys the shop out: the burn checks on chain.
  assert.equal(buyBlock({ ...q, balanceU: 0, balanceKnown: false }, 7_500), null);
  assert.equal(buyBlock({ realm: "practice", balanceU: 3_000 }, 2_500), null);
  assert.equal(buyBlock({ realm: "practice", balanceU: 0, pendingU: 9_999 }, 2_500).kind, "short");
});

async function shopFor(qgold) {
  const f = purchaseFixture();
  setSpendRealm("qgold");
  const routes = createGoldSpendRoutes({ db: f.db, gold: f.gold, qgold: { contract: TOKEN, txStatus: async () => null, ...qgold } });
  let out;
  try {
    await routes.handle({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1/api/gold/shop"), {
      player: f.player,
      body: async () => ({}),
      assert: domainAssert,
      respond: (_, value) => (out = value),
    });
  } finally {
    setSpendRealm("practice");
    f.db.close();
  }
  return out;
}

test("the QGOLD shop reports the spendable account, payout on the way and read failures", async () => {
  const shop = await shopFor({
    accountIds: () => ["new.testnet", "old.testnet"],
    spendable: async () => ({ accountId: "old.testnet", balanceU: 9_000 }),
    pendingU: () => 4_000,
  });
  assert.equal(shop.realm, "qgold");
  assert.equal(shop.balanceU, 9_000);
  assert.equal(shop.balanceKnown, true);
  assert.equal(shop.pendingU, 4_000);
  assert.equal(shop.hasAccount, true);

  const failed = await shopFor({
    accountIds: () => ["a.testnet"],
    spendable: async () => {
      throw Error("rpc down");
    },
  });
  assert.equal(failed.balanceKnown, false);
  assert.equal(failed.hasAccount, true);
  assert.equal(buyBlock(failed, 7_500), null);

  const none = await shopFor({ accountIds: () => [], balanceU: async () => 0 });
  assert.equal(none.hasAccount, false);
  assert.equal(buyBlock(none, 2_500).kind, "account");
});

test("the top bar balance is the wallet, not the game counter", async () => {
  const f = purchaseFixture();
  f.db.prepare("UPDATE players SET gold_u=8000000 WHERE id=?").run(f.player);
  const call = async (realm, qgold) => {
    setSpendRealm(realm);
    const routes = createGoldSpendRoutes({ db: f.db, gold: f.gold, qgold });
    let out;
    await routes.handle({ method: "GET", headers: {} }, {}, new URL("http://127.0.0.1/api/gold/balance"), {
      player: f.player, body: async () => ({}), assert: domainAssert, respond: (_, v) => (out = v),
    });
    return out;
  };
  try {
    const q = await call("qgold", {
      contract: TOKEN, txStatus: async () => null, accountIds: () => ["explorer.testnet"],
      spendable: async () => ({ accountId: "explorer.testnet", balanceU: 462 }), pendingU: () => 30,
    });
    assert.deepEqual(q, { realm: "qgold", balanceU: 462, balanceKnown: true, pendingU: 30, hasAccount: true });
    // Local practice only: the game counter is the balance.
    assert.equal((await call("practice", null)).balanceU, 8_000_000);
  } finally {
    setSpendRealm("practice");
    f.db.close();
  }
});
