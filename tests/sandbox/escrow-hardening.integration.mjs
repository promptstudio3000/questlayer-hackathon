// A06/A07 candidate against actual WASM. Synthetic keys and loopback only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { KeyPair, actions } from "near-api-js";
import { escrowLocalTransport, escrowReceiptSummary } from "./escrow-rpc.mjs";
const [helper, wasmDirectory, reportPath] = process.argv.slice(2);
assert.ok(helper && wasmDirectory && reportPath);
const { Sandbox, GenesisAccount } = await import(
  pathToFileURL(resolve(helper))
);
const N = 10n ** 24n,
  fee = 1250000000000000000000n,
  token = "qgold.testnet",
  escrow = "escrow.testnet";
const keys = new Map(),
  clients = new Map();
const genesis = [
  "owner",
  "qgold",
  "escrow",
  "poor",
  "alice",
  "bob",
  "grant",
  "selfpaid",
].map((name) => {
  const id = `${name}.testnet`,
    key = KeyPair.fromRandom("ed25519");
  keys.set(id, key);
  return new GenesisAccount(
    id,
    key.getPublicKey().toString(),
    key.toString(),
    100n * N,
  );
});
const report = {
  scope: "synthetic local chain only",
  startedAt: new Date().toISOString(),
  scenarios: [],
  transactions: [],
  releaseReady: false,
};
let sandbox, owner;
const t = async (id) => {
  if (!clients.has(id))
    clients.set(
      id,
      await escrowLocalTransport({
        rpcUrl: sandbox.rpcUrl,
        accountId: id,
        secretKey: keys.get(id).toString(),
      }),
    );
  return clients.get(id);
};
const view = (contract, method, args = {}) =>
  owner.view(contract, method, args);
const balance = (id) =>
  view(token, "ft_balance_of", { account_id: id }).then(BigInt);
const native = (id) =>
  owner.provider.viewAccount({ accountId: id }).then((r) => BigInt(r.amount));
async function call(
  contract,
  method,
  args = {},
  sender = "owner.testnet",
  deposit = 0n,
  failure = false,
) {
  const result = await (
    await t(sender)
  ).call(contract, method, args, deposit, 200n * 10n ** 12n);
  report.transactions.push({ method, ...escrowReceiptSummary(result) });
  assert.equal(!!result.status.Failure, failure, JSON.stringify(result.status));
  return result;
}
const done = (name) => {
  report.scenarios.push({ name, passed: true });
  console.log(`PASS ${name}`);
};
async function fund(
  id,
  { contract = escrow, assignee = null, to = null } = {},
) {
  const block = await owner.provider.viewBlock({ finality: "final" }),
    ms = BigInt(block.header.timestamp_nanosec) / 1000000n;
  const msg = to
    ? {
        kind: "transfer",
        id,
        to,
        condition: { type: "both_confirm" },
        expires_ms: String(ms + 86400000n),
      }
    : {
        kind: "task",
        id,
        reward: "1000",
        slots: 1,
        assignee,
        deadline_ms: String(ms + 86400000n),
      };
  return call(
    token,
    "ft_transfer_call",
    {
      receiver_id: contract,
      amount: to ? "1000" : "1100",
      msg: JSON.stringify(msg),
    },
    "alice.testnet",
    1n,
  );
}
try {
  sandbox = await Sandbox.start({
    version: "2.14.0",
    config: { additionalAccounts: genesis },
  });
  owner = await t("owner.testnet");
  report.wasm = {};
  for (const [contract, name] of [
    [token, "qgold"],
    [escrow, "qgold_escrow"],
    ["poor.testnet", "qgold_escrow"],
  ]) {
    const bytes = readFileSync(join(wasmDirectory, `questlayer_${name}.wasm`));
    report.wasm[name] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    await (await t(contract)).account.deployContract(bytes);
  }
  await call(token, "new", {
    council: ["owner.testnet"],
    threshold: 1,
    guardian_id: "owner.testnet",
    treasury_id: "owner.testnet",
    minters: ["owner.testnet"],
    initial_rate: "1000000000000000000000",
    metadata: {
      spec: "ft-1.0.0",
      name: "Local QGOLD",
      symbol: "QGOLD",
      decimals: 6,
    },
  });
  for (const account_id of ["alice.testnet", "owner.testnet"])
    await call(token, "mint_for", { account_id }, "owner.testnet", N);
  for (const contract of [escrow, "poor.testnet"]) {
    await call(contract, "new", {
      owner_id: "owner.testnet",
      token_id: token,
      publisher_id: "owner.testnet",
      moderator_id: "owner.testnet",
      guardian_id: "owner.testnet",
      treasury_id: "owner.testnet",
    });
    await call(
      token,
      "storage_deposit",
      { account_id: contract },
      "owner.testnet",
      fee,
    );
  }
  for (let i = 0; i < 4; i++) {
    const before = await native("grant.testnet");
    await fund(`grant-${i}`, { to: "grant.testnet" });
    await call(escrow, "confirm_transfer", { id: `grant-${i}` });
    await call(escrow, "withdraw_for", { account_id: "grant.testnet" });
    assert.equal(await balance("grant.testnet"), 1000n);
    await call(
      token,
      "ft_transfer",
      { receiver_id: "alice.testnet", amount: "1000" },
      "grant.testnet",
      1n,
    );
    await call(token, "storage_unregister", {}, "grant.testnet", 1n);
    assert.equal(
      await view(token, "storage_balance_of", { account_id: "grant.testnet" }),
      null,
    );
    assert.ok(
      (await native("grant.testnet")) < before,
      "recipient must not cash out a sponsored registration",
    );
  }
  done(
    "four real escrow payout/unregister cycles cannot cash out the lifetime grant",
  );
  await call(token, "storage_deposit", {}, "selfpaid.testnet", fee);
  await call(
    token,
    "storage_deposit_sponsored",
    { account_id: "selfpaid.testnet" },
    "owner.testnet",
    fee,
  );
  const beforeRefund = await native("selfpaid.testnet");
  await call(token, "storage_unregister", {}, "selfpaid.testnet", 1n);
  assert.ok(
    (await native("selfpaid.testnet")) > beforeRefund,
    "a player-paid NEP-145 deposit remains refundable",
  );
  done(
    "ordinary player-paid registration still refunds after a sponsor touches the account",
  );
  await fund("unassigned");
  await call(
    escrow,
    "open_dispute",
    { id: "unassigned", worker: "bob.testnet" },
    "bob.testnet",
    0n,
    true,
  );
  assert.deepEqual(
    (await view(escrow, "get_task", { id: "unassigned" })).open_disputes,
    [],
  );
  await call(escrow, "open_dispute", {
    id: "unassigned",
    worker: "bob.testnet",
  });
  await call(escrow, "resolve_dispute", {
    id: "unassigned",
    worker: "bob.testnet",
    pay: true,
  });
  const credit = await view(escrow, "get_credit", {
    account_id: "bob.testnet",
  });
  assert.equal(credit, "1000");
  await call(
    escrow,
    "resolve_dispute",
    { id: "unassigned", worker: "bob.testnet", pay: true },
    "owner.testnet",
    0n,
    true,
  );
  assert.equal(
    await view(escrow, "get_credit", { account_id: "bob.testnet" }),
    credit,
  );
  await fund("assigned", { assignee: "bob.testnet" });
  await call(
    escrow,
    "open_dispute",
    { id: "assigned", worker: "bob.testnet" },
    "bob.testnet",
  );
  done(
    "unassigned self-disputes fail; verified and assigned appeals retain exactly one payout",
  );
  const poor = await t("poor.testnet"),
    account = await owner.provider.viewAccount({ accountId: "poor.testnet" });
  const storage = BigInt(account.storage_usage) * 10n ** 19n;
  await poor.account.signAndSendTransaction({
    receiverId: "owner.testnet",
    actions: [actions.transfer(BigInt(account.amount) - storage - N / 10n)],
    waitUntil: "FINAL",
  });
  const before = await balance("alice.testnet");
  await fund("underfunded", { contract: "poor.testnet" });
  assert.equal(await balance("alice.testnet"), before);
  assert.equal(await balance("poor.testnet"), 0n);
  assert.equal(
    await view("poor.testnet", "get_task", { id: "underfunded" }),
    null,
  );
  done(
    "insufficient native storage reserve rejects admission atomically and refunds actual QGOLD",
  );
  report.stats = await view(escrow, "get_stats");
  assert.equal(report.stats.conserved, true);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { message: error.message, stack: error.stack };
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (sandbox) await sandbox.stop();
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
