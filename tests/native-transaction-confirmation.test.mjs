import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import {
  NativeTransactionConfirmation,
  nativeCodeFingerprint,
} from "../server/native/transaction-confirmation.mjs";
import { SOCIAL_CODE_HASH } from "../server/native/social-profile.mjs";
const read = (name) =>
  JSON.parse(readFileSync(new URL(`../public/${name}.json`, import.meta.url)));
const rewardsConfig = read("native-rewards-testnet"),
  marketManifest = read("native-market-testnet"),
  claimsManifest = read("native-claims-testnet");
const ACCOUNT = "alice.testnet",
  HASH = "H".repeat(44),
  BLOCK = "B".repeat(44),
  EXECUTED = "E".repeat(44);
const FACTORY = rewardsConfig.factory.contractId,
  VAULT = `v0.${FACTORY}`;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
function fixture(overrides = {}) {
  const db = openDatabase(":memory:"),
    player = createPlayer(db, "Confirmation Alice");
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    ACCOUNT,
    player,
    Date.now(),
  );
  const quote = {
    network: "testnet",
    signerId: ACCOUNT,
    receiverId: rewardsConfig.contractId,
    methodName: "withdraw",
    args: {},
    gas: "100000000000000",
    deposit: "1",
    ...overrides,
  };
  const result = {
    final_execution_status: "FINAL",
    transaction: {
      hash: HASH,
      signer_id: ACCOUNT,
      receiver_id: quote.receiverId,
      actions: [
        {
          FunctionCall: {
            method_name: quote.methodName,
            args: encode(quote.args),
            gas: Number(quote.gas),
            deposit: quote.deposit,
          },
        },
      ],
    },
    status: { SuccessValue: encode(true) },
    transaction_outcome: {
      block_hash: BLOCK,
      outcome: {
        executor_id: ACCOUNT,
        status: { SuccessReceiptId: "R".repeat(44) },
      },
    },
    receipts_outcome: [
      {
        block_hash: EXECUTED,
        outcome: {
          executor_id: quote.receiverId,
          status: { SuccessValue: encode(true) },
        },
      },
    ],
  };
  const code = new Map([
    [rewardsConfig.contractId, rewardsConfig.codeHash],
    [FACTORY, rewardsConfig.factory.codeHash],
    [VAULT, rewardsConfig.factory.vaultCodeHash],
    [
      marketManifest.marketContract,
      nativeCodeFingerprint(marketManifest.wasmSha256),
    ],
    [
      claimsManifest.contractId,
      nativeCodeFingerprint(claimsManifest.wasmSha256),
    ],
    ["v1.social08.testnet", SOCIAL_CODE_HASH],
  ]);
  const requests = [];
  const provider = {
    async viewNodeStatus() {
      return { chain_id: "testnet", sync_info: { syncing: false } };
    },
    async viewBlock() {
      return {
        header: {
          hash: BLOCK,
          height: 1000,
          timestamp_nanosec: String(BigInt(Date.now()) * 1000000n),
        },
      };
    },
    async query(input) {
      requests.push(input);
      if (input.request_type === "call_function")
        return {
          block_hash: input.block_id,
          result: [
            ...Buffer.from(
              JSON.stringify({
                network: "testnet",
                version: 1,
                nft_contract: claimsManifest.contractId,
              }),
            ),
          ],
        };
      return input.request_type === "view_access_key_list"
        ? { keys: [], block_hash: input.block_id, block_height: 1000 }
        : {
            code_hash: code.get(input.account_id),
            block_hash: input.block_id,
            block_height: 1000,
          };
    },
    async viewTransactionStatus(input) {
      requests.push(input);
      return result;
    },
  };
  const position = {
    id: "0",
    account_id: VAULT,
    beneficiary: ACCOUNT,
    state: "ready",
    pool: "aurora.pool.f863973.m0",
  };
  const vaults = {
    contractId: FACTORY,
    async validate() {
      return {};
    },
    async positions() {
      return [position];
    },
    async state() {
      return { beneficiary: ACCOUNT };
    },
  };
  const service = new NativeTransactionConfirmation(db, provider, {
    rewardsConfig,
    marketManifest,
    claimsManifest,
    vaults,
  });
  const confirm = (changes = {}) =>
    service.confirm(player, {
      accountId: ACCOUNT,
      transactionHash: HASH,
      quote,
      ...changes,
    });
  return {
    db,
    player,
    quote,
    result,
    provider,
    position,
    vaults,
    service,
    confirm,
    code,
    requests,
  };
}
test("final native withdrawal matches exact actor/action and both current and executed code", async () => {
  const f = fixture();
  const historyBefore = f.db.prepare("SELECT * FROM history").all();
  assert.equal((await f.confirm()).confirmed, true);
  assert(
    f.requests.some(
      (r) =>
        r.waitUntil === "FINAL" && r.txHash === HASH && r.accountId === ACCOUNT,
    ),
  );
  assert(f.requests.some((r) => r.block_id === BLOCK));
  assert(f.requests.some((r) => r.block_id === EXECUTED));
  assert.deepEqual(f.db.prepare("SELECT * FROM history").all(), historyBefore);
  f.db.close();
});
test("receipt identity, sole FunctionCall, amounts, gas and arguments cannot be substituted", async () => {
  for (const mutate of [
    (r) => (r.transaction.hash = "J".repeat(44)),
    (r) => (r.transaction.signer_id = "mallory.testnet"),
    (r) => (r.transaction.receiver_id = "mallory.testnet"),
    (r) => r.transaction.actions.push({ Transfer: { deposit: "1" } }),
    (r) => (r.transaction.actions[0].FunctionCall.method_name = "on_withdraw"),
    (r) => (r.transaction.actions[0].FunctionCall.deposit = "2"),
    (r) => (r.transaction.actions[0].FunctionCall.gas = 200000000000000),
    (r) =>
      (r.transaction.actions[0].FunctionCall.args = encode({
        recipient: "mallory.testnet",
      })),
    (r) => (r.transaction.actions[0].FunctionCall.args = "!!!!"),
  ]) {
    const f = fixture();
    mutate(f.result);
    await assert.rejects(f.confirm());
    f.db.close();
  }
});
test("optimistic, malformed, failed and false-callback results never establish payment", async () => {
  for (const mutate of [
    (r) => (r.final_execution_status = "EXECUTED_OPTIMISTIC"),
    (r) => (r.status = { Failure: { ActionError: "failed" } }),
    (r) => (r.receipts_outcome[0].outcome.status = { Failure: {} }),
    (r) => (r.status = { SuccessValue: encode(false) }),
    (r) => (r.status = { SuccessValue: "" }),
    (r) => (r.receipts_outcome = []),
    (r) => (r.receipts_outcome[0].outcome.executor_id = "unrelated.testnet"),
  ]) {
    const f = fixture();
    mutate(f.result);
    await assert.rejects(f.confirm());
    f.db.close();
  }
});
test("network, synchronization, stale anchors and changed current or historical code fail closed", async () => {
  for (const mutate of [
    (f) => (f.provider.viewNodeStatus = async () => ({ chain_id: "mainnet" })),
    (f) =>
      (f.provider.viewNodeStatus = async () => ({
        chain_id: "testnet",
        sync_info: { syncing: true },
      })),
    (f) => (f.service.clock = () => Date.now() + 300000),
    (f) => f.code.set(rewardsConfig.contractId, "different"),
    (f) => {
      const query = f.provider.query;
      f.provider.query = async (r) =>
        r.block_id === EXECUTED
          ? { code_hash: "changed-historically" }
          : query(r);
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.confirm());
    f.db.close();
  }
});
test("only a linked wallet may confirm, including after asynchronous receipt and code reads", async () => {
  for (const stage of ["before", "receipt", "historical"]) {
    const f = fixture(),
      revoke = () => f.db.prepare("DELETE FROM wallet_links").run();
    if (stage === "before") revoke();
    if (stage === "receipt") {
      const original = f.provider.viewTransactionStatus;
      f.provider.viewTransactionStatus = async (r) => {
        const value = await original(r);
        revoke();
        return value;
      };
    }
    if (stage === "historical") {
      const original = f.provider.query;
      f.provider.query = async (r) => {
        const value = await original(r);
        if (r.block_id === EXECUTED) revoke();
        return value;
      };
    }
    await assert.rejects(f.confirm(), /Link this NEAR wallet/);
    f.db.close();
  }
});
test("all read-only native RPC work is bounded", async () => {
  const f = fixture();
  f.service.timeoutMs = 5;
  f.provider.viewTransactionStatus = () => new Promise(() => {});
  await assert.rejects(f.confirm(), /confirmation is unavailable/);
  f.db.close();
});
test("unknown contracts, methods, network or malformed comparison contexts are rejected", async () => {
  for (const change of [
    { receiverId: "unreviewed.testnet" },
    { network: "mainnet" },
    { signerId: "mallory.testnet" },
    { methodName: "on_withdraw" },
    { deposit: "1e5" },
    { gas: "1" },
    { args: [] },
  ]) {
    const f = fixture(change);
    await assert.rejects(f.confirm());
    f.db.close();
  }
});
test("factory creation, owned registration and refund use reviewed terms and true callbacks", async () => {
  for (const input of [
    {
      methodName: "create_position",
      args: { pool_id: "aurora.pool.f863973.m0", contribution_bps: 5000 },
      deposit: rewardsConfig.factory.setupDeposit,
    },
    { methodName: "register_position", args: { id: "0" }, deposit: "0" },
    { methodName: "withdraw_refund", args: {}, deposit: "1" },
  ]) {
    const f = fixture({
      receiverId: FACTORY,
      gas: "280000000000000",
      ...input,
    });
    assert.equal((await f.confirm()).confirmed, true);
    f.result.status.SuccessValue = encode(false);
    await assert.rejects(f.confirm(), /did not complete/);
    f.db.close();
  }
  const f = fixture({
    receiverId: FACTORY,
    gas: "280000000000000",
    methodName: "register_position",
    args: { id: "7" },
    deposit: "0",
  });
  await assert.rejects(f.confirm(), /Only your own/);
  f.db.close();
});
test("vault confirmation requires a real owned ready factory position and keyless pinned state", async () => {
  for (const mutate of [
    () => {},
    (f) => (f.position.beneficiary = "mallory.testnet"),
    (f) => (f.position.state = "created"),
    (f) => (f.position.account_id = `v99.${FACTORY}`),
    (f) => {
      const query = f.provider.query;
      f.provider.query = async (r) =>
        r.request_type === "view_access_key_list"
          ? { keys: [{ public_key: "unexpected" }] }
          : query(r);
    },
  ].entries()) {
    const f = fixture({
      receiverId: VAULT,
      methodName: "withdraw_owner",
      gas: "280000000000000",
    });
    mutate[1](f);
    if (mutate[0] === 0) assert.equal((await f.confirm()).confirmed, true);
    else await assert.rejects(f.confirm());
    f.db.close();
  }
});
test("deposit, exit, refresh and advance callback false is final but not completed", async () => {
  for (const [methodName, deposit] of [
    ["deposit_and_stake", "1000000000000000000000"],
    ["request_exit", "1"],
    ["refresh", "0"],
    ["advance", "0"],
  ]) {
    const f = fixture({
      receiverId: VAULT,
      methodName,
      deposit,
      gas: "280000000000000",
    });
    assert.equal((await f.confirm()).confirmed, true);
    f.result.status.SuccessValue = encode(false);
    await assert.rejects(f.confirm(), /did not complete/);
    f.db.close();
  }
});
test("market buy/cancel/withdraw and NFT escrow listing distinguish successful callback from compensation", async () => {
  for (const input of [
    {
      receiverId: marketManifest.marketContract,
      methodName: "buy",
      args: { token_id: "aura:polar:1", listing_id: 1 },
      gas: "150000000000000",
      deposit: "1000000000000000000000",
    },
    {
      receiverId: marketManifest.marketContract,
      methodName: "cancel",
      args: { token_id: "aura:polar:1", listing_id: 1 },
      gas: "150000000000000",
      deposit: "1",
    },
    {
      receiverId: marketManifest.marketContract,
      methodName: "withdraw",
      gas: "150000000000000",
    },
    {
      receiverId: claimsManifest.contractId,
      methodName: "nft_transfer_call",
      args: {
        receiver_id: marketManifest.marketContract,
        token_id: "aura:polar:1",
        approval_id: null,
        memo: null,
        msg: JSON.stringify({ price: "1000000000000000000000" }),
      },
      gas: "200000000000000",
      deposit: "1",
    },
  ]) {
    const f = fixture(input);
    assert.equal((await f.confirm()).confirmed, true);
    f.result.status.SuccessValue = encode(false);
    await assert.rejects(f.confirm(), /did not complete/);
    f.db.close();
  }
});
test("collectible mint/redeem validates returned identity and equipment expects a void result", async () => {
  const f = fixture({
    receiverId: claimsManifest.contractId,
    methodName: "mint_avatar",
    deposit: "50000000000000000000000",
  });
  f.result.status.SuccessValue = encode({
    token_id: `avatar:${ACCOUNT}`,
    owner_id: ACCOUNT,
  });
  assert.equal((await f.confirm()).confirmed, true);
  f.result.status.SuccessValue = encode({
    token_id: `avatar:${ACCOUNT}`,
    owner_id: "mallory.testnet",
  });
  await assert.rejects(f.confirm());
  f.db.close();
  const a = fixture({
    receiverId: claimsManifest.contractId,
    methodName: "redeem_aura",
    deposit: "50000000000000000000000",
    args: {
      claim_id: "earned:example",
      edition: "moon",
      receiver_id: ACCOUNT,
      expires_at_ms: 1700000000000,
      signature: "a".repeat(88),
    },
  });
  a.result.status.SuccessValue = encode({
    token_id: "aura:moon:2",
    owner_id: ACCOUNT,
  });
  assert.equal((await a.confirm()).confirmed, true);
  a.result.status.SuccessValue = encode({
    token_id: "aura:gold:2",
    owner_id: ACCOUNT,
  });
  await assert.rejects(a.confirm());
  a.db.close();
  for (const [methodName, args] of [
    ["equip_aura", { token_id: "aura:moon:2", slot: "above" }],
    ["unequip_aura", { slot: "below" }],
  ]) {
    const u = fixture({
      receiverId: claimsManifest.contractId,
      methodName,
      args,
      deposit: "0",
    });
    u.result.status.SuccessValue = "";
    assert.equal((await u.confirm()).confirmed, true);
    u.result.status.SuccessValue = encode(false);
    await assert.rejects(u.confirm());
    u.db.close();
  }
});
test("SocialDB set returns a publication height, not boolean success; private or foreign paths cannot be confirmed", async () => {
  const input = {
    receiverId: "v1.social08.testnet",
    methodName: "set",
    gas: "80000000000000",
    deposit: "50000000000000000000000",
    args: {
      data: {
        [ACCOUNT]: {
          questlayer: {
            profile: {
              schema: "1",
              name: "Alice",
              avatar_contract: "",
              avatar_token_id: "",
              updated_at: "1700000000000",
              mutation_id: "profile_0123c224-91c6-4237-b28a-9c2656045c1d",
            },
          },
        },
      },
    },
  };
  const f = fixture(input);
  f.result.status.SuccessValue = encode({ block_height: "1000" });
  assert.equal((await f.confirm()).confirmed, true);
  f.result.status.SuccessValue = encode(true);
  await assert.rejects(f.confirm());
  f.quote.args.data[ACCOUNT].secret = "not-a-profile";
  await assert.rejects(f.confirm());
  f.db.close();
});

test("pre-sign anchors require a linked wallet and a fresh synchronized testnet block", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.service.anchor(f.player, ACCOUNT), {
      network: "testnet",
      accountId: ACCOUNT,
      afterBlock: 1000,
    });
    await assert.rejects(
      () => f.service.anchor(f.player, "other.testnet"),
      /Link/,
    );
    f.provider.viewNodeStatus = async () => ({ chain_id: "mainnet" });
    await assert.rejects(() => f.service.anchor(f.player, ACCOUNT), /testnet/);
  } finally {
    f.db.close();
  }
});
test("pre-sign anchor rejects stale blocks and rechecks ownership after waiting", async () => {
  const f = fixture(),
    original = f.provider.viewBlock;
  try {
    f.provider.viewBlock = async () => ({
      header: { hash: BLOCK, height: 1000, timestamp_nanosec: "1" },
    });
    await assert.rejects(() => f.service.anchor(f.player, ACCOUNT), /stale/);
    f.provider.viewBlock = async () => {
      f.db.prepare("DELETE FROM wallet_links").run();
      return original();
    };
    await assert.rejects(() => f.service.anchor(f.player, ACCOUNT), /Link/);
  } finally {
    f.db.close();
  }
});
test("an identical older receipt cannot resolve a newer request or clear its pending failure", async () => {
  const f = fixture();
  try {
    for (const height of [1000, 1001])
      await assert.rejects(
        () => f.confirm({ afterBlock: height }),
        (e) => e.code === "NATIVE_RECEIPT_BEFORE_REQUEST",
      );
    f.result.status = { Failure: { ActionError: "old failed withdrawal" } };
    await assert.rejects(
      () => f.confirm({ afterBlock: 1000 }),
      (e) => e.code === "NATIVE_RECEIPT_BEFORE_REQUEST",
    );
    for (const height of [null, 0, -1, "999", Number.MAX_SAFE_INTEGER + 1])
      await assert.rejects(() => f.confirm({ afterBlock: height }), /anchor/);
  } finally {
    f.db.close();
  }
});
test("newer inclusion block verifies with the SDK blockId parameter and exact returned hash", async () => {
  const f = fixture(),
    original = f.provider.viewBlock,
    requests = [];
  try {
    f.provider.viewBlock = async (input) => {
      requests.push(input);
      const block = await original();
      if (input.blockId) block.header.height = 1001;
      return block;
    };
    assert.equal((await f.confirm({ afterBlock: 1000 })).confirmed, true);
    assert(requests.some((x) => x.blockId === BLOCK));
    f.provider.viewBlock = async (input) => {
      const block = await original();
      if (input.blockId) block.header.hash = EXECUTED;
      return block;
    };
    await assert.rejects(
      () => f.confirm({ afterBlock: 999 }),
      /inclusion block/,
    );
  } finally {
    f.db.close();
  }
});
test("unknown final statuses and incomplete receipt status cannot become clearable failures", async () => {
  const f = fixture();
  try {
    for (const status of [
      undefined,
      {},
      { Unknown: "" },
      { SuccessValue: "", Failure: {} },
    ]) {
      f.result.status = status;
      await assert.rejects(
        () => f.confirm(),
        (e) => e.code !== "NATIVE_TRANSACTION_FAILED",
      );
    }
    f.result.status = { SuccessValue: encode(true) };
    f.result.receipts_outcome[0].outcome.status = {};
    await assert.rejects(
      () => f.confirm(),
      (e) => e.code !== "NATIVE_TRANSACTION_FAILED",
    );
  } finally {
    f.db.close();
  }
});

test("missing failure data and nonboolean callbacks never authorize clearing an uncertain receipt", async () => {
  const f = fixture();
  try {
    for (const value of [null, false, {}, []]) {
      f.result.status = { Failure: value };
      await assert.rejects(
        () => f.confirm(),
        (e) => !e.code?.startsWith("NATIVE_"),
      );
    }
    for (const value of [null, "true", 0, {}]) {
      f.result.status = { SuccessValue: encode(value) };
      await assert.rejects(
        () => f.confirm(),
        (e) => !e.code?.startsWith("NATIVE_"),
      );
    }
    f.result.status = { SuccessValue: encode(true) };
    f.result.receipts_outcome[0].outcome.status = { Unknown: "" };
    await assert.rejects(
      () => f.confirm(),
      (e) => !e.code?.startsWith("NATIVE_"),
    );
  } finally {
    f.db.close();
  }
});
test("link revoked during executed-code lookup cannot expose a terminal failure result", async () => {
  const f = fixture(),
    query = f.provider.query;
  try {
    f.result.status = { Failure: { ActionError: "failed" } };
    f.provider.query = async (input) => {
      const result = await query(input);
      if (input.block_id === EXECUTED)
        f.db.prepare("DELETE FROM wallet_links").run();
      return result;
    };
    await assert.rejects(
      () => f.confirm(),
      (e) => e.status === 403 && !e.code?.startsWith("NATIVE_"),
    );
  } finally {
    f.db.close();
  }
});
test("vault v2 partial exit and contribution change confirm only on a v2 position with exact arguments", async () => {
  for (const input of [
    {
      methodName: "request_partial_exit",
      args: { amount: "1000000000000000000000000" },
    },
    { methodName: "set_contribution", args: { contribution_bps: 2500 } },
  ]) {
    const f = fixture({
      receiverId: VAULT,
      gas: "280000000000000",
      deposit: "1",
      ...input,
    });
    f.vaults.state = async () => ({ beneficiary: ACCOUNT, version: 2 });
    assert.equal((await f.confirm()).confirmed, true);
    f.result.status.SuccessValue = encode(false);
    await assert.rejects(f.confirm(), /did not complete/);
    f.db.close();
    // A v1 vault has neither method.
    const v1 = fixture({
      receiverId: VAULT,
      gas: "280000000000000",
      deposit: "1",
      ...input,
    });
    v1.vaults.state = async () => ({ beneficiary: ACCOUNT, version: 1 });
    await assert.rejects(v1.confirm(), /no partial exit/);
    v1.db.close();
  }
  for (const input of [
    { methodName: "request_partial_exit", args: { amount: "999" } },
    { methodName: "request_partial_exit", args: { amount: 10 ** 24 } },
    {
      methodName: "request_partial_exit",
      args: { amount: "1000000000000000000000000", to: "mallory.testnet" },
    },
    { methodName: "set_contribution", args: { contribution_bps: 10001 } },
    { methodName: "set_contribution", args: { contribution_bps: "2500" } },
    {
      methodName: "set_contribution",
      args: { contribution_bps: 2500 },
      deposit: "0",
    },
  ]) {
    const f = fixture({
      receiverId: VAULT,
      gas: "280000000000000",
      deposit: "1",
      ...input,
    });
    f.vaults.state = async () => ({ beneficiary: ACCOUNT, version: 2 });
    await assert.rejects(f.confirm());
    f.db.close();
  }
});
