import test from "node:test";
import assert from "node:assert/strict";
import {
  sendConfirmedNative,
  readPendingNativeTransactions,
  checkPendingNativeTransaction,
  clearFailedNativeTransaction,
} from "../src/confirmed-native-transaction.ts";
const hash = "BYd9jW9ayic4wfdSdKmUWkWEg2KEtGgytYQituKuntrv";
class MemoryStorage {
  data = new Map();
  getItem(key) {
    return this.data.get(key) ?? null;
  }
  setItem(key, value) {
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}
const context = (playerId = "player_test", storage = new MemoryStorage()) => ({
  playerId,
  storage,
});
const tx = (account = "alice.testnet") => ({
  network: "testnet",
  signerId: account,
  receiverId: "market.testnet",
  actions: [
    {
      type: "FunctionCall",
      params: {
        methodName: "withdraw",
        args: {},
        gas: "150000000000000",
        deposit: "1",
      },
    },
  ],
});
const confirmation = (account = "alice.testnet") => ({
  confirmed: true,
  network: "testnet",
  accountId: account,
  contractId: "market.testnet",
  transactionHash: hash,
});
const pending = (c) => readPendingNativeTransactions(c.playerId, c.storage);
const wallet = (onSign = () => {}) => ({
  signAndSendTransaction: async () => {
    onSign();
    return {
      transaction: { hash },
      final_execution_status: "EXECUTED_OPTIMISTIC",
    };
  },
});
test("optimistic execution only clears after exact final confirmation; wallet mutation cannot alter stored review", async (t) => {
  const c = context(),
    input = tx();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.quote.deposit, "1");
    assert.equal(body.transactionHash, hash);
    assert.equal(pending(c)[0].transactionHash, hash);
    calls++;
    return Response.json(confirmation());
  });
  await sendConfirmedNative(
    {
      signAndSendTransaction: async (request) => {
        assert.equal(pending(c)[0].phase, "awaiting_wallet");
        request.actions[0].params.deposit = "2";
        return { transaction: { hash } };
      },
    },
    input,
    c,
  );
  assert.equal(calls, 1);
  assert.deepEqual(pending(c), []);
});
test("reload and exact retry verify the saved hash without another wallet signature", async (t) => {
  const c = context();
  let signatures = 0,
    online = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (!online) throw Error("offline");
    return Response.json(confirmation());
  });
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      tx(),
      c,
    ),
    /may already be complete/,
  );
  assert.equal(pending(c)[0].transactionHash, hash);
  online = true;
  const reloaded = { playerId: c.playerId, storage: c.storage };
  await sendConfirmedNative(
    wallet(() => signatures++),
    tx(),
    reloaded,
  );
  assert.equal(signatures, 1);
  assert.deepEqual(pending(c), []);
});
test("a different pending operation blocks new signing for the same account", async (t) => {
  const c = context();
  let signatures = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("offline");
  });
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      tx(),
      c,
    ),
  );
  const another = tx();
  another.actions[0].params.methodName = "buy";
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      another,
      c,
    ),
    /unchecked transaction/,
  );
  assert.equal(signatures, 1);
  assert.equal(pending(c).length, 1);
});
test("concurrent submissions reserve before opening the wallet", async (t) => {
  const c = context();
  let release,
    signatures = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(confirmation()));
  const first = sendConfirmedNative(
    {
      signAndSendTransaction: async () => {
        signatures++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    tx(),
    c,
  );
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      tx(),
      c,
    ),
    /will not be signed again/,
  );
  release({ transaction: { hash } });
  await first;
  assert.equal(signatures, 1);
});
test("definite wallet cancellation clears only its reservation; unknown wallet errors retain it", async () => {
  const c = context();
  let signatures = 0;
  await assert.rejects(
    sendConfirmedNative(
      {
        signAndSendTransaction: async () => {
          signatures++;
          throw Object.assign(Error("cancelled"), { code: 4001 });
        },
      },
      tx(),
      c,
    ),
    /cancelled/,
  );
  assert.equal(pending(c).length, 0);
  await assert.rejects(
    sendConfirmedNative(
      {
        signAndSendTransaction: async () => {
          signatures++;
          throw Error("connection lost");
        },
      },
      tx(),
      c,
    ),
    /may already have been sent/,
  );
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      tx(),
      c,
    ),
    /will not be signed again/,
  );
  assert.equal(signatures, 2);
  assert.equal(pending(c)[0].transactionHash, null);
});
test("missing wallet hash can be recovered by exact receipt verification without another signature", async (t) => {
  const c = context();
  await assert.rejects(
    sendConfirmedNative({ signAndSendTransaction: async () => ({}) }, tx(), c),
    /No transaction receipt/,
  );
  const entry = pending(c)[0];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    assert.equal(JSON.parse(options.body).transactionHash, hash);
    return Response.json(confirmation());
  });
  await checkPendingNativeTransaction(c, entry.id, hash);
  assert.deepEqual(pending(c), []);
});
test("incorrect manually supplied hash does not replace the recoverable missing-hash marker", async (t) => {
  const c = context();
  await assert.rejects(
    sendConfirmedNative({ signAndSendTransaction: async () => ({}) }, tx(), c),
  );
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "different actor", code: "BAD_RECEIPT" },
      { status: 409 },
    ),
  );
  await assert.rejects(
    checkPendingNativeTransaction(c, pending(c)[0].id, hash),
  );
  assert.equal(pending(c)[0].transactionHash, null);
});
test("false, substituted and unavailable confirmations retain one receipt rather than re-signing", async (t) => {
  const c = context();
  let signatures = 0,
    reply = confirmation();
  t.mock.method(globalThis, "fetch", async () => Response.json(reply));
  for (const change of [
    { confirmed: false },
    { accountId: "bob.testnet" },
    { contractId: "other.testnet" },
    { network: "mainnet" },
    { transactionHash: "other" },
  ]) {
    reply = { ...confirmation(), ...change };
    await assert.rejects(
      sendConfirmedNative(
        wallet(() => signatures++),
        tx(),
        c,
      ),
      /did not match/,
    );
  }
  assert.equal(signatures, 1);
  assert.equal(pending(c).length, 1);
});
test("corrupt, inaccessible and non-writing storage fail before signing and preserve existing bytes", async () => {
  for (const setup of [
    (s) =>
      s.setItem("questlayer:native-pending:v1:player_test", "corrupt-json"),
    (s) => {
      s.getItem = () => {
        throw Error("denied");
      };
    },
    (s) => {
      s.setItem = () => {};
    },
  ]) {
    const c = context();
    setup(c.storage);
    let signatures = 0;
    await assert.rejects(
      sendConfirmedNative(
        wallet(() => signatures++),
        tx(),
        c,
      ),
      /storage is unavailable/,
    );
    assert.equal(signatures, 0);
    if (c.storage.data.has("questlayer:native-pending:v1:player_test"))
      assert.equal(
        c.storage.data.get("questlayer:native-pending:v1:player_test"),
        "corrupt-json",
      );
  }
});
test("a storage failure after broadcast leaves an ambiguous marker and exposes the actual receipt reference", async (t) => {
  const c = context();
  let sent = false;
  const originalSet = c.storage.setItem.bind(c.storage);
  c.storage.setItem = (k, v) => {
    if (sent) throw Error("quota");
    originalSet(k, v);
  };
  await assert.rejects(
    sendConfirmedNative(
      {
        signAndSendTransaction: async () => {
          sent = true;
          return { transaction: { hash } };
        },
      },
      tx(),
      c,
    ),
    (error) => error.transactionHash === hash && error.message.includes(hash),
  );
  assert.equal(pending(c)[0].transactionHash, null);
});
test("pending records are isolated by player and wallet; a late old account response cannot clear a newer account", async (t) => {
  const c = context();
  let release;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.accountId === "alice.testnet")
      return new Promise((r) => {
        release = r;
      });
    return Response.json(confirmation("bob.testnet"));
  });
  const first = sendConfirmedNative(wallet(), tx(), c);
  while (!release) await new Promise((r) => setImmediate(r));
  await sendConfirmedNative(wallet(), tx("bob.testnet"), c);
  assert.equal(pending(c).length, 1);
  assert.equal(pending(c)[0].accountId, "alice.testnet");
  assert.deepEqual(
    readPendingNativeTransactions("other_player", c.storage),
    [],
  );
  release(Response.json(confirmation()));
  await first;
  assert.deepEqual(pending(c), []);
});
test("final failure is retained until acknowledged and freshly reverified; unknown/code-change cannot be discarded", async (t) => {
  const c = context();
  let code = "NATIVE_OPERATION_NOT_COMPLETED";
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "Final callback false; refresh balances", code },
      { status: 409 },
    ),
  );
  await assert.rejects(sendConfirmedNative(wallet(), tx(), c));
  const entry = pending(c)[0];
  assert.equal(entry.phase, "failed");
  await assert.rejects(
    clearFailedNativeTransaction(c, entry.id, false),
    /Review the current/,
  );
  code = "CODE_CHANGED";
  await assert.rejects(clearFailedNativeTransaction(c, entry.id, true));
  assert.equal(pending(c).length, 1);
  code = "NATIVE_OPERATION_NOT_COMPLETED";
  await clearFailedNativeTransaction(c, entry.id, true);
  assert.deepEqual(pending(c), []);
});
test("full journals reject new signatures without evicting unresolved receipts", async (t) => {
  const c = context();
  let signatures = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("offline");
  });
  for (let i = 0; i < 8; i++)
    await assert.rejects(
      sendConfirmedNative(
        wallet(() => signatures++),
        tx(`alice${i}.testnet`),
        c,
      ),
    );
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signatures++),
      tx("ninth.testnet"),
      c,
    ),
    /Check existing/,
  );
  assert.equal(signatures, 8);
  assert.equal(pending(c).length, 8);
});
