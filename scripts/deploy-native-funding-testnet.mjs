import {
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, KeyPair, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { loadAwardSigner } from "../server/native/award-vouchers.mjs";
import { dayKey } from "../server/domain.mjs";
import { shiftDate } from "../server/spatial/calendar.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
// Account ids can be overridden for a new deployment generation; defaults are
// the 2026-10-31 pilot accounts.
const contractId =
    process.env.NEAR_REWARDS_ACCOUNT || "questlayer-rewards-20261031.testnet",
  factoryId =
    process.env.NEAR_VAULT_FACTORY_ACCOUNT ||
    "questlayer-vaults-20261031.testnet",
  vaultId =
    process.env.NEAR_VAULT_ACCOUNT || "questlayer-vault-20261031.testnet",
  vaultDepositYocto = BigInt(
    process.env.VAULT_DEPOSIT_YOCTO || (10n ** 23n).toString(),
  ),
  pool = "aurora.pool.f863973.m0";
const rewardSigner = loadAwardSigner(".data/reward-attestor.pem");
const workerPath = ".data/reward-worker.json";
if (!existsSync(workerPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  writeFileSync(
    workerPath,
    JSON.stringify({
      network: "testnet",
      accountId: contractId,
      secretKey: pair.toString(),
      publicKey: pair.getPublicKey().toString(),
    }),
    { mode: 0o600, flag: "wx" },
  );
}
assert.equal(statSync(workerPath).mode & 0o077, 0);
const worker = JSON.parse(readFileSync(workerPath));
const journal = ".data/native-funding-deploy-journal.json",
  transactions = existsSync(journal) ? JSON.parse(readFileSync(journal)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journal, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function view(account, method, args = {}) {
  const r = await provider.query({
    request_type: "call_function",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function provision(id, wasmPath, args) {
  let info;
  try {
    info = await provider.viewAccount({ accountId: id });
  } catch (e) {
    if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(e)))
      throw e;
  }
  if (!info) {
    const r = await fetch("https://helper.testnet.near.org/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newAccountId: id,
        newAccountPublicKey: operator.publicKey,
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert(r.ok, `Faucet failed (${r.status})`);
    for (let i = 0; i < 8; i++) {
      try {
        info = await provider.viewAccount({ accountId: id });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert(info);
    console.log(JSON.stringify({ created: id }));
  }
  const account = new Account(id, provider, signer),
    wasm = readFileSync(wasmPath);
  if (info.code_hash === "11111111111111111111111111111111")
    await record("Deploy and initialize " + id, () =>
      account.signAndSendTransaction({
        receiverId: id,
        actions: [
          actions.deployContract(wasm),
          actions.functionCall("new", args, 100n * 10n ** 12n, 0n),
        ],
        waitUntil: "FINAL",
      }),
    );
  else {
    const code = await provider.query({
      request_type: "view_code",
      account_id: id,
      finality: "final",
    });
    if (!Buffer.from(code.code_base64, "base64").equals(wasm)) {
      assert(
        process.argv.includes("--upgrade-reviewed"),
        "Deployed source differs; explicit reviewed upgrade required for " + id,
      );
      mkdirSync(".data/contract-backups", { recursive: true, mode: 0o700 });
      writeFileSync(
        `.data/contract-backups/${id}-${info.code_hash}.wasm`,
        Buffer.from(code.code_base64, "base64"),
        { mode: 0o600 },
      );
      const method =
          id === contractId
            ? "get_treasury"
            : id === factoryId
              ? "get_config"
              : "get_state",
        before = await view(id, method);
      await record("Upgrade reviewed compatible bytecode " + id, () =>
        account.signAndSendTransaction({
          receiverId: id,
          actions: [actions.deployContract(wasm)],
          waitUntil: "FINAL",
        }),
      );
      assert.deepEqual(
        await view(id, method),
        before,
        "Compatible upgrade must preserve contract state",
      );
    }
  }
  return {
    account,
    wasmSha256: createHash("sha256").update(wasm).digest("hex"),
    codeHash: (await provider.viewAccount({ accountId: id })).code_hash,
  };
}
const rewards = await provision(
  contractId,
  "contracts/target/wasm32-unknown-unknown/release/questlayer_rewards.wasm",
  {
    owner_id: operator.accountId,
    publisher_id: contractId,
    attestor: rewardSigner.publicKey,
  },
);
const cfg = await view(contractId, "get_config");
assert.equal(cfg.attestor, rewardSigner.publicKey);
for (const day of [dayKey(), shiftDate(dayKey())]) {
  const dayId = `plzen-${day}-v1`,
    manifest = await view(contractId, "get_day", { day_id: dayId });
  if (manifest && !manifest.storage_reserved)
    await record(
      "Reserve operating storage for existing native day " + day,
      () =>
        root.callFunctionRaw({
          contractId,
          methodName: "reserve_day_storage",
          args: { day_id: dayId },
          gas: 50n * 10n ** 12n,
          waitUntil: "FINAL",
        }),
    );
}
const keys = await provider.query({
  request_type: "view_access_key_list",
  account_id: contractId,
  finality: "final",
});
if (!keys.keys.some((k) => k.public_key === worker.publicKey))
  await record("Install bounded publisher and claim relay key", () =>
    rewards.account.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.addFunctionCallAccessKey(
          KeyPair.fromString(worker.secretKey).getPublicKey(),
          contractId,
          ["publish_day", "close_day", "claim", "maintain_vault"],
          4n * 10n ** 23n,
        ),
      ],
      waitUntil: "FINAL",
    }),
  );
const vault = await provision(
  vaultId,
  "contracts/target/wasm32-unknown-unknown/release/questlayer_vault.wasm",
  {
    beneficiary_id: operator.accountId,
    pool_id: pool,
    rewards_id: contractId,
    contribution_bps: 5000,
  },
);
await record("Allow only the isolated native vault as yield source", () =>
  root.callFunctionRaw({
    contractId,
    methodName: "set_vault",
    args: { account_id: vaultId, approved: true },
    gas: 30n * 10n ** 12n,
    waitUntil: "FINAL",
  }),
);
const treasury = await view(contractId, "get_treasury");
if (treasury.funded === "0")
  await record("Sponsor 0.2 test NEAR with separate 50/50 accounting", () =>
    root.callFunctionRaw({
      contractId,
      methodName: "fund_rewards",
      args: { source: "sponsor", receipt_id: `initial-pilot-${contractId.replace(/[^a-z0-9]/g, "-").slice(0, 48)}` },
      deposit: 2n * 10n ** 23n + BigInt(cfg.sponsor_storage_fee),
      gas: 50n * 10n ** 12n,
      waitUntil: "FINAL",
    }),
  );
const poolInfo = await provider.viewAccount({ accountId: pool });
assert.equal(
  poolInfo.code_hash,
  "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY",
);
assert.equal(
  (
    await provider.query({
      request_type: "view_access_key_list",
      account_id: pool,
      finality: "final",
    })
  ).keys.length,
  0,
);
assert.equal(await view(pool, "is_staking_paused"), false);
let state = await view(vaultId, "get_state");
if (state.deposited === "0")
  await record(
    `Deposit ${vaultDepositYocto} yoctoNEAR into the validator through the vault`,
    () =>
      root.callFunctionRaw({
        contractId: vaultId,
        methodName: "deposit_and_stake",
        args: {},
        deposit: vaultDepositYocto,
        gas: 200n * 10n ** 12n,
        waitUntil: "FINAL",
      }),
  );
state = await view(vaultId, "get_state");
assert.equal(state.stage, "idle");
assert.equal(state.deposited, vaultDepositYocto.toString());
const poolPosition = await view(pool, "get_account", { account_id: vaultId });
assert(BigInt(poolPosition.staked_balance) > 0n);
const factory = await provision(
  factoryId,
  "contracts/target/wasm32-unknown-unknown/release/questlayer_vault_factory.wasm",
  { rewards_id: contractId },
);
const factoryConfig = await view(factoryId, "get_config");
assert.equal(factoryConfig.vault_sha256, vault.wasmSha256);
if (
  !transactions.some(
    (t) => t.label === "Top up separate reward storage and gas reserve",
  )
) {
  await record("Top up separate reward storage and gas reserve", () =>
    factory.account.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.transfer(2n * 10n ** 24n)],
      waitUntil: "FINAL",
    }),
  );
}
const result = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  contractId,
  codeHash: rewards.codeHash,
  wasmSha256: rewards.wasmSha256,
  attestor: rewardSigner.publicKey,
  workerPublicKey: worker.publicKey,
  factory: {
    contractId: factoryId,
    codeHash: factory.codeHash,
    wasmSha256: factory.wasmSha256,
    vaultCodeHash: vault.codeHash,
    vaultWasmSha256: vault.wasmSha256,
    setupDeposit: factoryConfig.setup_deposit,
  },
  vaults: [
    {
      accountId: vaultId,
      beneficiary: operator.accountId,
      pool,
      codeHash: vault.codeHash,
      wasmSha256: vault.wasmSha256,
    },
  ],
  funding: "explicit sponsor; realized staking yield not yet demonstrated",
  vaultPolicy:
    "experimental keyless factory positions, immutable contribution, full exit; testnet only",
  state,
  poolPosition,
  transactions,
};
mkdirSync("output/qa/W05-W06-native", { recursive: true });
writeFileSync(
  "public/native-rewards-testnet.json",
  JSON.stringify(result, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W05-W06-native/deployment.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contractId,
    vaultId,
    staked: poolPosition.staked_balance,
    transactions: transactions.length,
  }),
);
