// Treasury native staking on testnet: real validator yield for the prize pool.
//
// Why: on testnet the stNEAR price is frozen, Rhea/Burrow lending pays ~0 %
// and the old treasury vault holds only 0.1 NEAR. Native validator staking is
// the one testnet asset that really earns: ~9-10 % APR gross, paid by the
// protocol every epoch (~7 h). This script stakes faucet test NEAR through a
// dedicated keyless treasury vault whose whole gain (contribution 100 %) goes
// to the rewards treasury. The principal stays the operator's; only realized
// validator rewards ever reach the prize pool (harvest -> 4 epoch unlock ->
// flush_game -> fund_rewards "yield"), each step a public transaction.
// The reward worker on the VPS runs harvest/advance/flush by itself once the
// vault is listed in public/native-rewards-testnet.json `vaults`.
//
//   node scripts/treasury-stake-testnet.mjs status              # read only
//   node scripts/treasury-stake-testnet.mjs faucet <n>          # n helper accounts x 10 NEAR -> operator
//   node scripts/treasury-stake-testnet.mjs deploy <near>       # create vault, approve, stake <near>, drop key
//   node scripts/treasury-stake-testnet.mjs deposit <near>      # top up (vault must be idle)
//
// Mac only (operator key in .data/). Build the vault first with
// `bash scripts/build-contracts-docker.sh`: the deployed bytes must equal the
// reproducible hash pinned in contracts/wasm-sha256.json.
// Public record: public/treasury-stake-testnet.json (transaction hashes, no keys).
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const NEAR = 10n ** 24n,
  TGAS = 10n ** 12n;
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);
const toYocto = (s) => {
  assert.match(String(s ?? ""), /^\d+(\.\d{1,6})?$/, "Amount in NEAR, e.g. 250");
  const [i, f = ""] = String(s).split(".");
  return BigInt(i) * NEAR + BigInt(f.padEnd(6, "0")) * 10n ** 18n;
};
const log = (o) => console.log(JSON.stringify(o));

const manifestPath = "public/native-rewards-testnet.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rewardsId = manifest.contractId;
const VAULT_ID = process.env.TREASURY_STAKE_VAULT || "questlayer-stake-20261111.testnet";
const POOL = process.env.TREASURY_STAKE_POOL || "stakely_v2.pool.f863973.m0"; // 3 % pool fee, lowest of the allowlist
const POOL_CODE = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY"; // official staking-pool factory build
const WASM = "contracts/target/wasm32-unknown-unknown/release/questlayer_vault.wasm";
const pinned = JSON.parse(readFileSync("contracts/wasm-sha256.json", "utf8")).contracts.questlayer_vault;
const listed = (manifest.vaults || []).some((v) => v.accountId === VAULT_ID);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (hex) => {
  let n = BigInt("0x" + hex),
    out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
};

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
assert.equal(operator.network, "testnet", "Testnet only.");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600).");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const operatorPublicKey = KeyPair.fromString(operator.secretKey).getPublicKey().toString();
const root = new Account(operator.accountId, provider, signer);

const recordPath = "public/treasury-stake-testnet.json";
const record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : {
      network: "testnet",
      about:
        "Treasury native staking: faucet test NEAR staked with a testnet validator through a keyless QuestLayer vault. Only realized validator rewards (gain above the high-water basis, contribution 100 %) are paid into the rewards treasury; the principal is the operator's and is never counted as yield.",
      vault: VAULT_ID,
      pool: POOL,
      rewardsContract: rewardsId,
      beneficiary: operator.accountId,
      contributionBps: 10000,
      faucet: [],
      transactions: [],
    };
const save = () => {
  record.updatedAt = new Date().toISOString();
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
};
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => Boolean(r?.status?.Failure) || (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);
async function step(label, fn) {
  const r = await fn();
  assert.ok(!failed(r), label + " failed: " + JSON.stringify(r.status).slice(0, 400));
  const transaction = txOf(r);
  record.transactions.push({ label, transaction, at: new Date().toISOString() });
  save();
  log({ label, transaction, explorer: `https://testnet.nearblocks.io/txns/${transaction}` });
  return r;
}
const accountOf = async (account_id) => {
  try {
    return await provider.query({ request_type: "view_account", account_id, finality: "final" });
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(rpcErrorText(e))) return null;
    throw e;
  }
};
const view = async (account_id, method_name, args = {}) =>
  JSON.parse(
    Buffer.from(
      (
        await provider.query({
          request_type: "call_function",
          account_id,
          method_name,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          finality: "final",
        })
      ).result,
    ).toString(),
  );
async function helperAccount(id) {
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: operatorPublicKey }),
    signal: AbortSignal.timeout(40000),
  });
  assert.ok(r.ok, `Testnet helper refused ${id} (${r.status})`);
  for (let i = 0; i < 10; i++) {
    const a = await accountOf(id);
    if (a) return a;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error(`${id} did not appear`);
}
async function deposit(amount) {
  assert.ok(amount >= NEAR && amount <= 1000n * NEAR, "Deposit 1-1000 NEAR per call.");
  const state = await view(VAULT_ID, "get_state");
  assert.equal(state.stage, "idle", `Vault is busy (${state.stage}/${state.operation}); deposit after it settles.`);
  const liquid = BigInt((await accountOf(operator.accountId)).amount);
  assert.ok(liquid >= amount + NEAR / 2n, `Operator has ${near(liquid)} NEAR; run faucet first.`);
  await step(`Stake ${near(amount)} NEAR through the treasury vault`, () =>
    root.callFunctionRaw({ contractId: VAULT_ID, methodName: "deposit_and_stake", args: {}, deposit: amount, gas: 200n * TGAS, waitUntil: "FINAL" }),
  );
  const after = await view(VAULT_ID, "get_state");
  assert.equal(after.stage, "idle", "Deposit did not settle: " + after.stage);
  record.deposited = after.deposited;
  save();
}

if (command === "status") {
  const op = await accountOf(operator.accountId);
  const vault = await accountOf(VAULT_ID);
  const state = vault ? await view(VAULT_ID, "get_state") : null;
  const fee = await view(POOL, "get_reward_fee_fraction");
  const gain = state ? BigInt(state.staked) + BigInt(state.unstaked) - BigInt(state.high_water_basis) : 0n;
  log({
    operator: operator.accountId,
    operatorLiquid: op ? near(op.amount) : null,
    vault: VAULT_ID,
    exists: Boolean(vault),
    listedInManifest: listed,
    pool: POOL,
    poolFee: `${fee.numerator}/${fee.denominator}`,
    stage: state?.stage,
    operation: state?.operation || null,
    epoch: state?.epoch,
    unlockEpoch: state?.unlock_epoch,
    principal: state ? near(state.principal) : null,
    staked: state ? near(state.staked) : null,
    unharvestedGain: near(gain > 0n ? gain : 0n),
    gamePaid: state ? near(state.game_paid) : null,
    // ~9.8 % gross testnet APR = 0.0267 %/day (2.5 %/yr inflation x 90 % to validators / staked share), minus pool fee.
    estimatedPerDay: state ? near((BigInt(state.principal) * 267n * BigInt(fee.denominator - fee.numerator)) / (1000000n * BigInt(fee.denominator))) : null,
  });
  process.exit(0);
}

if (command === "faucet") {
  const n = Number(rest[0] || 1);
  assert.ok(Number.isInteger(n) && n > 0 && n <= 60, "faucet <1..60>");
  for (let i = 0; i < n; i++) {
    const id = `ql-stake-${Math.floor(Date.now() / 1000)}-${i}.testnet`;
    const acc = await helperAccount(id);
    const from = new Account(id, provider, signer);
    const r = await from.signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(operator.accountId)], waitUntil: "FINAL" });
    assert.ok(!failed(r), "delete failed: " + JSON.stringify(r.status));
    record.faucet.push({ account: id, received: acc.amount, deleteTransaction: txOf(r), at: new Date().toISOString() });
    save();
    log({ faucet: id, toOperator: near(acc.amount), transaction: txOf(r) });
    await new Promise((res) => setTimeout(res, 1500));
  }
  log({ operatorLiquid: near((await accountOf(operator.accountId)).amount) });
  process.exit(0);
}

if (command === "deposit") {
  await deposit(toYocto(rest[0]));
  process.exit(0);
}

assert.equal(command, "deploy", "Unknown command: " + command);
const amount = toYocto(rest[0]);
const wasm = readFileSync(WASM);
const sha = createHash("sha256").update(wasm).digest("hex");
assert.equal(sha, pinned, `Vault WASM ${sha} is not the reproducible build ${pinned}; run scripts/build-contracts-docker.sh.`);
const codeHash = base58(sha);
const poolInfo = await accountOf(POOL);
assert.equal(poolInfo.code_hash, POOL_CODE, "Pool code is not the official staking pool.");
assert.equal((await provider.query({ request_type: "view_access_key_list", account_id: POOL, finality: "final" })).keys.length, 0, "Pool has access keys.");
assert.equal(await view(POOL, "is_staking_paused"), false, "Pool staking is paused.");
assert.equal((await view(rewardsId, "get_config")).owner, operator.accountId, "Operator must own the rewards contract.");

let info = await accountOf(VAULT_ID);
if (!info) {
  info = await helperAccount(VAULT_ID);
  log({ created: VAULT_ID, reserve: near(info.amount) });
}
const vaultAccount = new Account(VAULT_ID, provider, signer);
if (info.code_hash === "11111111111111111111111111111111")
  await step(`Deploy and initialize ${VAULT_ID}`, () =>
    vaultAccount.signAndSendTransaction({
      receiverId: VAULT_ID,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall(
          "new",
          { beneficiary_id: operator.accountId, pool_id: POOL, rewards_id: rewardsId, contribution_bps: 10000 },
          100n * TGAS,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    }),
  );
info = await accountOf(VAULT_ID);
assert.equal(info.code_hash, codeHash, "Deployed code hash differs from the reproducible build.");
const state = await view(VAULT_ID, "get_state");
assert.equal(state.beneficiary, operator.accountId);
assert.equal(state.rewards, rewardsId);
assert.equal(state.pool, POOL);
assert.equal(state.contribution_bps, 10000);
record.codeHash = info.code_hash;
record.wasmSha256 = sha;
save();

if (!record.transactions.some((t) => t.label.startsWith("Approve")))
  await step(`Approve ${VAULT_ID} as a yield source of ${rewardsId}`, () =>
    root.callFunctionRaw({ contractId: rewardsId, methodName: "set_vault", args: { account_id: VAULT_ID, approved: true }, deposit: 0n, gas: 30n * TGAS, waitUntil: "FINAL" }),
  );
if (state.deposited === "0") await deposit(amount);

// Keyless: after this nobody (not even the operator) can move the vault's
// funds except through the contract's own rules.
const keys = (await provider.query({ request_type: "view_access_key_list", account_id: VAULT_ID, finality: "final" })).keys;
if (keys.length && !rest.includes("--keep-key"))
  await step(`Remove the last access key of ${VAULT_ID} (keyless vault)`, () =>
    vaultAccount.signAndSendTransaction({ receiverId: VAULT_ID, actions: keys.map((k) => actions.deleteKey(PublicKey.from(k.public_key))), waitUntil: "FINAL" }),
  );
// The worker maintains vaults listed in the manifest. The entry is added by a
// follow-up commit once the vault exists, so no VPS build ever lists a vault
// that is not on chain yet (the yield audit reads every listed vault).
log({
  done: true,
  manifestEntry: { accountId: VAULT_ID, beneficiary: operator.accountId, pool: POOL, codeHash, wasmSha256: sha },
  listedInManifest: listed,
  nextStep: listed ? "bash scripts/deploy-vps.sh" : `add manifestEntry to ${manifestPath} vaults, merge, then bash scripts/deploy-vps.sh`,
});
