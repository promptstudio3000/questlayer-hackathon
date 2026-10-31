import test from "node:test";
import assert from "node:assert/strict";
import {
  sendConfirmedNative,
  readPendingNativeTransactions,
  checkPendingNativeTransaction,
  clearFailedNativeTransaction,
  initializePendingNativeTransactions,
  exportPendingNativeTransactions,
  importPendingNativeTransactions,
  NATIVE_PENDING_STORAGE_PREFIX,
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
const queues = new Map();
async function withLock(name, work) {
  const previous = queues.get(name) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  queues.set(
    name,
    previous.then(() => gate),
  );
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}
const context = (playerId = "player_test", storage = new MemoryStorage()) => ({
  playerId,
  storage,
  withLock,
  getAnchor: async () => 100,
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
  const reloaded = context(c.playerId, c.storage);
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
  while (!release) await new Promise((r) => setImmediate(r));
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

function defaultBrowser(
  t,
  local,
  session,
  locks = { request: (name, _options, work) => withLock(name, work) },
) {
  for (const [name, value] of Object.entries({
    localStorage: local,
    sessionStorage: session,
    navigator: { locks },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
}
async function unresolved(t, c = context(), account = "alice.testnet") {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("offline");
  });
  await assert.rejects(sendConfirmedNative(wallet(), tx(account), c));
  return c;
}
test("default browser uses durable storage and another tab sees the reservation without signing", async (t) => {
  const local = new MemoryStorage(),
    session = new MemoryStorage();
  defaultBrowser(t, local, session);
  const c = { playerId: "player_test" };
  let release,
    signs = 0;
  t.mock.method(globalThis, "fetch", async (path) =>
    Response.json(
      path.endsWith("/anchor")
        ? { network: "testnet", accountId: "alice.testnet", afterBlock: 100 }
        : confirmation(),
    ),
  );
  const first = sendConfirmedNative(
    {
      signAndSendTransaction: async () => {
        signs++;
        return new Promise((r) => (release = r));
      },
    },
    tx(),
    c,
  );
  while (!release) await new Promise((r) => setImmediate(r));
  assert.equal(session.data.size, 0);
  assert.equal(
    readPendingNativeTransactions(c.playerId)[0].phase,
    "awaiting_wallet",
  );
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signs++),
      tx(),
      { playerId: c.playerId },
    ),
    /will not be signed again/,
  );
  release({ transaction: { hash } });
  await first;
  assert.equal(signs, 1);
});
test("default browser refuses signing when Web Locks are unavailable", async (t) => {
  defaultBrowser(t, new MemoryStorage(), new MemoryStorage(), undefined);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  let signs = 0;
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signs++),
      tx(),
      { playerId: "player_test" },
    ),
    /coordinate.*tabs/,
  );
  assert.equal(signs, 0);
});
test("legacy session receipts migrate only after durable readback and survive session closure", async (t) => {
  const legacy = await unresolved(t),
    durable = new MemoryStorage();
  const c = {
    ...context(legacy.playerId, durable),
    legacyStorage: legacy.storage,
  };
  await initializePendingNativeTransactions(c);
  assert.equal(
    legacy.storage.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
    null,
  );
  assert.equal(pending(c)[0].transactionHash, hash);
  const reloaded = context(c.playerId, durable);
  let signs = 0;
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signs++),
      tx(),
      reloaded,
    ),
  );
  assert.equal(signs, 0);
});
test("migration retains both sources on conflicts, corrupt legacy or failed durable writes", async (t) => {
  const legacy = await unresolved(t),
    raw = legacy.storage.getItem(
      NATIVE_PENDING_STORAGE_PREFIX + legacy.playerId,
    );
  for (const mode of ["conflict", "corrupt", "quota"]) {
    const old = new MemoryStorage(),
      local = new MemoryStorage(),
      c = { ...context("player_test", local), legacyStorage: old };
    old.setItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId, raw);
    if (mode === "conflict") {
      const altered = JSON.parse(raw);
      altered.entries[0].quote.deposit = "7";
      local.setItem(
        NATIVE_PENDING_STORAGE_PREFIX + c.playerId,
        JSON.stringify(altered),
      );
    }
    if (mode === "corrupt")
      old.setItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId, "not-json");
    if (mode === "quota")
      local.setItem = () => {
        throw Error("quota");
      };
    const beforeOld = old.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
      beforeLocal = local.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId);
    await assert.rejects(initializePendingNativeTransactions(c));
    assert.equal(
      old.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
      beforeOld,
    );
    assert.equal(
      local.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
      beforeLocal,
    );
  }
});
test("migration merges different accounts and canonical repeats without discarding either pending operation", async (t) => {
  const old = await unresolved(t),
    local = await unresolved(t, context(), "bob.testnet");
  const c = { ...local, legacyStorage: old.storage };
  await initializePendingNativeTransactions(c);
  assert.deepEqual(
    pending(c)
      .map((e) => e.accountId)
      .sort(),
    ["alice.testnet", "bob.testnet"],
  );
  const copy = new MemoryStorage();
  copy.setItem(
    NATIVE_PENDING_STORAGE_PREFIX + c.playerId,
    c.storage.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
  );
  await initializePendingNativeTransactions({ ...c, legacyStorage: copy });
  assert.equal(pending(c).length, 2);
});
test("exports include missing-hash records and no error internals; imports cannot inherit failed state", async (t) => {
  const source = await unresolved(t),
    item = pending(source)[0];
  const raw = JSON.parse(
    source.storage.getItem(NATIVE_PENDING_STORAGE_PREFIX + source.playerId),
  );
  raw.entries[0].phase = "failed";
  raw.entries[0].error = "private provider diagnostic";
  raw.entries[0].errorCode = "NATIVE_TRANSACTION_FAILED";
  source.storage.setItem(
    NATIVE_PENDING_STORAGE_PREFIX + source.playerId,
    JSON.stringify(raw),
  );
  const exported = await exportPendingNativeTransactions(source);
  assert(!exported.includes("diagnostic"));
  const file = JSON.parse(exported);
  file.entries[0].phase = "failed";
  const target = context();
  assert.deepEqual(
    await importPendingNativeTransactions(target, JSON.stringify(file), [
      "alice.testnet",
    ]),
    { imported: 1, total: 1 },
  );
  assert.equal(pending(target)[0].phase, "submitted");
  assert.equal(pending(target)[0].id, item.id);
  assert.deepEqual(
    await importPendingNativeTransactions(target, exported, ["alice.testnet"]),
    { imported: 0, total: 1 },
  );
  const missing = context("player_missing");
  await assert.rejects(
    sendConfirmedNative(
      { signAndSendTransaction: async () => ({}) },
      tx(),
      missing,
    ),
  );
  assert.equal(
    JSON.parse(await exportPendingNativeTransactions(missing)).entries[0]
      .transactionHash,
    null,
  );
});
test("imports reject wrong identity, unlinked signer, unsupported network, extra fields and oversized input without changing existing bytes", async (t) => {
  const source = await unresolved(t),
    exported = await exportPendingNativeTransactions(source),
    target = await unresolved(t, context(), "bob.testnet");
  const before = target.storage.getItem(
    NATIVE_PENDING_STORAGE_PREFIX + target.playerId,
  );
  const variants = [
    (f) => (f.playerId = "other_player"),
    (f) => (f.network = "mainnet"),
    (f) => (f.entries[0].quote.network = "mainnet"),
    (f) => (f.entries[0].quote.extraSecret = "not-supported"),
    (f) => (f.entries[0].secret = "not-supported"),
    (f) => (f.entries[0].phase = "confirmed"),
  ];
  for (const change of variants) {
    const file = JSON.parse(exported);
    change(file);
    await assert.rejects(
      importPendingNativeTransactions(target, JSON.stringify(file), [
        "alice.testnet",
      ]),
    );
  }
  await assert.rejects(
    importPendingNativeTransactions(target, exported, ["bob.testnet"]),
    /Link every wallet/,
  );
  await assert.rejects(
    importPendingNativeTransactions(target, " ".repeat(100001), [
      "alice.testnet",
    ]),
    /100 KB/,
  );
  assert.equal(
    target.storage.getItem(NATIVE_PENDING_STORAGE_PREFIX + target.playerId),
    before,
  );
});
test("import conflicts preserve existing records and a restored receipt checks without signing", async (t) => {
  const source = await unresolved(t),
    exported = await exportPendingNativeTransactions(source),
    target = context();
  await importPendingNativeTransactions(target, exported, ["alice.testnet"]);
  const file = JSON.parse(exported);
  file.entries[0].quote.deposit = "77";
  await assert.rejects(
    importPendingNativeTransactions(target, JSON.stringify(file), [
      "alice.testnet",
    ]),
    /conflict/,
  );
  let signs = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json(confirmation()));
  await sendConfirmedNative(
    wallet(() => signs++),
    tx(),
    target,
  );
  assert.equal(signs, 0);
  assert.deepEqual(pending(target), []);
});
test("caller mutation while lock is queued cannot alter the transaction the wallet signs", async (t) => {
  const c = context(),
    input = tx();
  let release;
  const hold = withLock(
    `questlayer:native-journal:${NATIVE_PENDING_STORAGE_PREFIX + c.playerId}`,
    () => new Promise((r) => (release = r)),
  );
  while (!release) await new Promise((r) => setImmediate(r));
  let actual;
  t.mock.method(globalThis, "fetch", async () => Response.json(confirmation()));
  const sent = sendConfirmedNative(
    {
      signAndSendTransaction: async (request) => {
        actual = request;
        return { transaction: { hash } };
      },
    },
    input,
    c,
  );
  input.actions[0].params.deposit = "200";
  release();
  await hold;
  await sent;
  assert.equal(actual.actions[0].params.deposit, "1");
});
test("a late confirmation never deletes a record whose reviewed terms changed", async (t) => {
  const c = await unresolved(t);
  let release;
  t.mock.method(globalThis, "fetch", () => new Promise((r) => (release = r)));
  const checked = checkPendingNativeTransaction(c, pending(c)[0].id);
  while (!release) await new Promise((r) => setImmediate(r));
  const raw = JSON.parse(
    c.storage.getItem(NATIVE_PENDING_STORAGE_PREFIX + c.playerId),
  );
  raw.entries[0].quote.deposit = "2";
  c.storage.setItem(
    NATIVE_PENDING_STORAGE_PREFIX + c.playerId,
    JSON.stringify(raw),
  );
  release(Response.json(confirmation()));
  await assert.rejects(checked, /changed in another tab/);
  assert.equal(pending(c)[0].quote.deposit, "2");
});

test("pre-sign checkpoint is persisted, exported and sent on recovery", async (t) => {
  const c = context();
  let checked = false;
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.afterBlock, 100);
    checked = true;
    throw Error("offline");
  });
  await assert.rejects(
    sendConfirmedNative(
      {
        signAndSendTransaction: async () => {
          assert.equal(pending(c)[0].afterBlock, 100);
          return { transaction: { hash } };
        },
      },
      tx(),
      c,
    ),
  );
  assert(checked);
  const raw = await exportPendingNativeTransactions(c);
  assert.equal(JSON.parse(raw).entries[0].afterBlock, 100);
  const target = context();
  await importPendingNativeTransactions(target, raw, ["alice.testnet"]);
  assert.equal(pending(target)[0].afterBlock, 100);
});
test("failed checkpoint preparation never opens the wallet and releases only its unsubmitted reservation", async () => {
  const c = {
    ...context(),
    getAnchor: async () => {
      throw Error("anchor offline");
    },
  };
  let signs = 0;
  await assert.rejects(
    sendConfirmedNative(
      wallet(() => signs++),
      tx(),
      c,
    ),
    /anchor offline/,
  );
  assert.equal(signs, 0);
  assert.deepEqual(pending(c), []);
});
test("legacy receipt without a checkpoint remains recoverable but importing it cannot downgrade a newer bound", async (t) => {
  const c = await unresolved(t),
    exported = JSON.parse(await exportPendingNativeTransactions(c));
  delete exported.entries[0].afterBlock;
  await importPendingNativeTransactions(c, JSON.stringify(exported), [
    "alice.testnet",
  ]);
  assert.equal(pending(c)[0].afterBlock, 100);
  const target = context();
  await importPendingNativeTransactions(target, JSON.stringify(exported), [
    "alice.testnet",
  ]);
  t.mock.method(globalThis, "fetch", async (_, options) => {
    assert.equal(JSON.parse(options.body).afterBlock, undefined);
    return Response.json(confirmation());
  });
  await checkPendingNativeTransaction(target, pending(target)[0].id);
  assert.deepEqual(pending(target), []);
});

test("removing a reservation while its checkpoint is pending prevents the wallet from opening", async (t) => {
  let release,
    signs = 0;
  const c = {
    ...context(),
    getAnchor: () => new Promise((r) => (release = r)),
  };
  const sent = sendConfirmedNative(
    wallet(() => signs++),
    tx(),
    c,
  );
  while (!release) await new Promise((r) => setImmediate(r));
  const entry = pending(c)[0];
  t.mock.method(globalThis, "fetch", async () => Response.json(confirmation()));
  await checkPendingNativeTransaction(c, entry.id, hash);
  release(100);
  await assert.rejects(sent, /wallet was not opened/);
  assert.equal(signs, 0);
  assert.deepEqual(pending(c), []);
});

test("a reservation changed just after anchor persistence cannot reach the wallet", async () => {
  for (const action of ["remove", "change"]) {
    const c = context();
    let turns = 0,
      signs = 0;
    c.withLock = (name, work) =>
      withLock(name, () => {
        const result = work();
        if (++turns === 2) {
          const key = NATIVE_PENDING_STORAGE_PREFIX + c.playerId,
            raw = JSON.parse(c.storage.getItem(key));
          if (action === "remove") raw.entries = [];
          else raw.entries[0].quote.deposit = "9";
          c.storage.setItem(key, JSON.stringify(raw));
        }
        return result;
      });
    await assert.rejects(
      sendConfirmedNative(
        wallet(() => signs++),
        tx(),
        c,
      ),
      /wallet was not opened/,
    );
    assert.equal(signs, 0);
  }
});
