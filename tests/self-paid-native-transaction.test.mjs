// The managed signer splits reviewed quotes: storage-class deposits go to the
// relayer, money goes through a self-paid transaction. No network here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isRelayedDeposit,
  sendSelfPaid,
  RELAYED_DEPOSITS,
} from "../src/self-paid-native-transaction.ts";

const quote = (deposit, extra = {}, methodName = "buy") => ({
  network: "testnet",
  signerId: "alice.players.questlayer.testnet",
  receiverId: "questlayer-market-20261101.testnet",
  actions: [
    {
      type: "FunctionCall",
      params: {
        methodName,
        args: { listing_id: 1 },
        gas: "100000000000000",
        deposit,
      },
    },
  ],
  ...extra,
});
const key = {
  publicKey: "ed25519:4bxkVXVAiEQcT1CV5oM5bHQ8gxCEnJ9DBUBEaX7oGmVa",
  secretKey:
    "ed25519:3D4YudUahN1nawWogh8pAKSj92sEvMo7zU4JTSBx6Smb1eVmQmZf9sF3G1J1Z7qtx5yYmL9bUGgqMPA5Ggd2FXu7",
  accountId: "alice.players.questlayer.testnet",
  createdAt: 0,
};

test("only 0, 1 yocto and 0.05 NEAR deposits are routed to the relayer", () => {
  assert.deepEqual(RELAYED_DEPOSITS, ["0", "1", "50000000000000000000000"]);
  for (const d of RELAYED_DEPOSITS)
    assert.equal(isRelayedDeposit(quote(d, {}, "withdraw")), true, d);
  for (const d of [
    "2",
    "1000000000000000000000",
    "3520000000000000000000000",
    "1000000000000000000000000",
  ])
    assert.equal(isRelayedDeposit(quote(d, {}, "withdraw")), false, d);
  assert.equal(
    isRelayedDeposit(
      quote("0", { actions: [{ type: "Transfer", params: { deposit: "0" } }] }),
    ),
    false,
  );
});

test("self-paid sending validates shape and account before touching any RPC", async () => {
  await assert.rejects(
    sendSelfPaid(key, quote("1000", { network: "mainnet" })),
    (e) => e.code === "SELF_PAID_SHAPE",
  );
  await assert.rejects(
    sendSelfPaid(key, quote("1000", { actions: [] })),
    (e) => e.code === "SELF_PAID_SHAPE",
  );
  await assert.rejects(
    sendSelfPaid(
      { ...key, accountId: "bob.players.questlayer.testnet" },
      quote("1000"),
    ),
    (e) => e.code === "SELF_PAID_ACCOUNT",
  );
  await assert.rejects(
    sendSelfPaid({ ...key, accountId: undefined }, quote("1000")),
    (e) => e.code === "SELF_PAID_ACCOUNT",
  );
});

test("market calls that move money are self-paid even with a 1 yocto deposit", () => {
  for (const m of ["buy", "fill_sell_order", "fill_buy_order", "deposit_near"])
    assert.equal(isRelayedDeposit(quote("1", {}, m)), false, m);
  for (const m of ["cancel_order", "cancel_all_orders", "add_signing_key", "cancel"])
    assert.equal(isRelayedDeposit(quote("1", {}, m)), true, m);
});

test('a lost self-paid response survives reload without signing or paying again', async t => {
  const { sendJournaledSelfPaid } = await import('../src/self-paid-native-transaction.ts');
  const { readPendingNativeTransactions, checkPendingNativeTransaction } = await import('../src/confirmed-native-transaction.ts');
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const context = { playerId:'self_paid_test', storage, getAnchor:async()=>100, withLock:async(_,f)=>f() };
  let sends = 0;
  const send = async () => { sends++; throw Error('reply lost after the payment'); };
  const transaction = quote('1000000000000000000000000');
  await assert.rejects(sendJournaledSelfPaid(key,transaction,context,send), /receipt/);
  assert.equal(readPendingNativeTransactions(context.playerId,storage).length,1);
  t.mock.method(globalThis,'fetch',async()=>({ok:false,json:async()=>({error:'The saved payment is still being checked.'})}));
  await assert.rejects(sendJournaledSelfPaid(key,transaction,{...context},send));
  assert.equal(sends,1);
  const hash='8'.repeat(44), pending=readPendingNativeTransactions(context.playerId,storage)[0];
  await checkPendingNativeTransaction({...context,confirm:async()=>({confirmed:true,network:'testnet',accountId:transaction.signerId,contractId:transaction.receiverId,transactionHash:hash})},pending.id,hash);
  assert.equal(readPendingNativeTransactions(context.playerId,storage).length,0);
});
