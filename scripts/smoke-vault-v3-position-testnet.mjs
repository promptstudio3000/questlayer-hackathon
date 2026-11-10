// Smoke test of the first v3 self-service vault position on testnet, through the
// pinned factory questlayer-vaults-20261101b.testnet (factory v3, embedded vault
// 357c3b57, recorded in public/native-rewards-testnet.json `factory`).
//
// It does what the app does for a player (server/native/vaults.mjs prepare,
// src/native-vault-quote.ts), from a dedicated test sub-account of the operator:
//   1. create_position(pool_id, contribution_bps) on the factory with the exact
//      setup deposit (3.52 test NEAR) and 280 TGas. The factory creates
//      v<id>.<factory>, deploys the embedded vault and calls `new` with 25 TGas;
//      on_create then calls rewards register_factory_vault, and on_register marks
//      the position "ready". A "created" position is registered again with
//      register_position (the app's retry), never redeployed.
//   2. deposit_and_stake with the minimum stake (0.001 test NEAR), 280 TGas.
// and verifies: the child exists with the pinned vault code hash and no access
// keys, every receipt succeeded (`new` within its gas, register_factory_vault on
// rewards), the factory lists the position "ready", get_state is v3
// (version 2 plus busy_since, recoverable_at_epoch, min_harvest,
// next_harvest_epoch, recovery_policy ...-v3) with the right owner, pool,
// rewards and stake, and the server lists it ready for the smoke account
// (NEP-413 sign-in as that account, then GET /api/native/vaults?account=).
//
// Run on the Mac with the operator key, one command at a time:
//   node scripts/smoke-vault-v3-position-testnet.mjs --network testnet             (plan, read-only)
//   node scripts/smoke-vault-v3-position-testnet.mjs --network testnet --execute   (sends)
// Options: --label <name> (sub-account label, default vault-smoke-v3);
// --pool <id> (default aurora.pool.f863973.m0); --contribution-bps <0..10000>
// (default 5000); --stake <NEAR> (default 0.001, the minimum); --no-stake;
// --server <url> / --no-server; --operator <id> (dry run only; default the
// rewards owner). The smoke key is written to .data/<label>.json
// (chmod 600) before the account is created and is never printed.
//
// Costs and exit path: the 3.5 NEAR child reserve stays in the keyless child for
// good (no access key, no delete method) and 0.02 NEAR stays with the factory as
// position storage; the position uses one of the factory's 32 slots and one of the
// smoke account's 4. The stake comes back: request_exit (1 yocto) -> about 4
// epochs of pool unlock -> advance until owner_credit > 0 -> withdraw_owner
// (1 yocto) to the smoke account; the app does the same from Profile -> staking.
// Delete the smoke account only after that, if at all (owner payouts go to it).
// With --server the sign-in creates one explorer for the smoke account on that server.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { base58Hex, pinnedFactoryFor, rolloutOptions } from "./lib/vault-rollout.mjs";
import { TGAS, connect, loadOperator, planLog, readJson, writeJson } from "./lib/vault-rollout-io.mjs";
import {
  APP_GAS,
  MIN_STAKE_YOCTO,
  NEW_GAS_TGAS,
  childAccountId,
  nearToYocto,
  ownPosition,
  serverListingProblems,
  smokeAccountId,
  smokeFunding,
  summarizeCreateOutcome,
  v3StateProblems,
  yoctoToNear,
} from "./lib/vault-smoke.mjs";
import { readStakingPool } from "../server/native/staking-pool.mjs";
import { VAULT_POOLS } from "../server/native/vaults.mjs";

// The reviewed staking-pool code hash, as server/native/vaults.mjs prepare pins it.
const POOL_CODE_HASH = "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY";
const MANIFEST = "public/native-rewards-testnet.json";
const OUT = "output/qa/vault-v3-smoke";

const opts = rolloutOptions(process.argv.slice(2));
const rpc = connect(opts);
await rpc.assertChain();
const log = planLog(opts.execute);
const blockers = [];
const block = (ok, reason) => {
  if (ok) return true;
  if (opts.execute) assert.fail(reason);
  blockers.push(reason);
  log.info("BLOCKER", { reason });
  return false;
};
const manifest = readJson(MANIFEST);
const pins = readJson("contracts/wasm-sha256.json").contracts;
assert.equal(manifest.network, "testnet");
const rewardsId = manifest.contractId;
const factoryId = manifest.factory.contractId;
assert.equal(factoryId, "questlayer-vaults-20261101b.testnet", "This smoke test is for the 20261101b factory generation.");
assert.equal(pinnedFactoryFor(rewardsId), factoryId, `${rewardsId} registers children of ${pinnedFactoryFor(rewardsId)} only.`);
const poolId = opts.value("--pool") || VAULT_POOLS[0]?.id;
assert(VAULT_POOLS.some((p) => p.id === poolId), `Pool ${poolId} is not one of the app's reviewed pools.`);
const contributionBps = Number(opts.value("--contribution-bps") ?? 5000);
assert(Number.isInteger(contributionBps) && contributionBps >= 0 && contributionBps <= 10000, "--contribution-bps is 0..10000.");
const stake = opts.has("--no-stake") ? 0n : nearToYocto(opts.value("--stake") || "0.001");
assert(stake === 0n || (stake >= MIN_STAKE_YOCTO && stake <= 1000n * 10n ** 24n), "Stake between 0.001 and 1,000 test NEAR.");
const serverUrl = opts.has("--no-server") ? null : opts.value("--server") || process.env.QUESTLAYER_API_URL || "https://questlayer.promptstudio3000.com";
if (serverUrl) assert(["questlayer.promptstudio3000.com", "localhost", "127.0.0.1"].includes(new URL(serverUrl).hostname), "Unknown server host.");

// 1. Factory v3, as pinned and as the manifest (and so the server) records it.
const factoryCodeHash = base58Hex(pins.questlayer_vault_factory);
const vaultCodeHash = base58Hex(pins.questlayer_vault);
const fInfo = await rpc.account(factoryId);
const cfg = await rpc.view(factoryId, "get_config");
log.info("factory", { factoryId, codeHash: fInfo.code_hash, config: cfg });
block(fInfo.code_hash === factoryCodeHash, `${factoryId} runs ${fInfo.code_hash}, not the pinned factory v3 ${factoryCodeHash}. Run scripts/rollout-vault-factory-v3-testnet.mjs first.`);
block(cfg.vault_sha256 === pins.questlayer_vault, `${factoryId} embeds vault ${cfg.vault_sha256}, not the pinned v3 vault ${pins.questlayer_vault}.`);
block(
  manifest.factory.codeHash === fInfo.code_hash && manifest.factory.vaultCodeHash === vaultCodeHash && manifest.factory.vaultWasmSha256 === pins.questlayer_vault,
  `${MANIFEST} factory record is not v3 (codeHash ${manifest.factory.codeHash}); merge the factory v3 record (bc8331e6) and deploy the app first, or the server refuses the position (503).`,
);
block(cfg.rewards === rewardsId, `Factory points at ${cfg.rewards}, not ${rewardsId}.`);
block(Number(cfg.created) < Number(cfg.capacity), `Factory at capacity (${cfg.created}/${cfg.capacity}).`);
const setupDeposit = BigInt(cfg.setup_deposit);
block(String(setupDeposit) === String(manifest.factory.setupDeposit), `Setup deposit ${cfg.setup_deposit} differs from the manifest ${manifest.factory.setupDeposit}.`);

// 2. Pool readiness, exactly as the server checks it before offering create.
try {
  const b = await rpc.provider.viewBlock({ finality: "final" });
  const pool = await readStakingPool(rpc.provider, { accountId: poolId, expectedCodeHash: POOL_CODE_HASH }, b);
  log.info("pool", { poolId, keyless: pool.keyless, fingerprintMatches: pool.fingerprintMatches, paused: pool.paused });
  block(pool.keyless && pool.fingerprintMatches && !pool.paused, `${poolId} is not ready for a new position.`);
} catch (e) {
  block(false, `${poolId}: pool read failed (${e.message}).`);
}

// 3. Smoke account.
const rewardsCfg = await rpc.view(rewardsId, "get_config");
const operator = opts.execute ? loadOperator() : null;
const operatorId = operator?.accountId || opts.value("--operator") || rewardsCfg.owner;
if (operator) assert.equal(operator.accountId, rewardsCfg.owner, "The operator key file is not the rewards owner account.");
const label = opts.value("--label") || "vault-smoke-v3";
const smokeId = smokeAccountId(operatorId, label);
const keyFile = `.data/${label}.json`;
const exists = async (id) => {
  try {
    return await rpc.account(id);
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e.message || e) + JSON.stringify(e.data || e.cause || ""))) return null;
    throw e;
  }
};
const smokeInfo = await exists(smokeId);
const positions0 = await rpc.view(factoryId, "get_positions", { beneficiary: smokeId });
const existing = ownPosition(positions0, smokeId);
const funding = smokeFunding({ setupDeposit, stake, balance: smokeInfo ? BigInt(smokeInfo.amount) : 0n, positionExists: !!existing });
log.info("smoke account", {
  smokeId,
  exists: !!smokeInfo,
  balance: smokeInfo ? yoctoToNear(smokeInfo.amount) : null,
  keyFile,
  keyFilePresent: existsSync(keyFile),
  position: existing,
  needNear: yoctoToNear(funding.fund),
  topUpNear: yoctoToNear(funding.topUp),
});
block(!smokeInfo || existsSync(keyFile), `${smokeId} exists but ${keyFile} is missing; restore the key or pass another --label.`);
if (existing) log.info("resume", { note: `${smokeId} already owns position ${existing.id} (${existing.state}); the run verifies it instead of creating another` });

// 4. The plan.
const child = existing ? existing.account_id : childAccountId(cfg.created, factoryId);
if (!smokeInfo) {
  if (!existsSync(keyFile)) log.action(`Generate an ed25519 key for ${smokeId} and write it to ${keyFile} (chmod 600)`);
  log.action(`Create ${smokeId} from ${operatorId} with ${yoctoToNear(funding.fund)} test NEAR and that key (FullAccess)`, { signer: operatorId });
} else if (funding.topUp > 0n) log.action(`Top up ${smokeId} by ${yoctoToNear(funding.topUp)} test NEAR from ${operatorId}`, { signer: operatorId });
if (!existing)
  log.action(`create_position on ${factoryId}`, { signer: smokeId, args: { pool_id: poolId, contribution_bps: contributionBps }, deposit: `${yoctoToNear(setupDeposit)} NEAR`, gasTgas: Number(APP_GAS / TGAS), expectedChild: child, newGasTgas: NEW_GAS_TGAS });
else if (existing.state === "created") log.action(`register_position ${existing.id} on ${factoryId}`, { signer: smokeId, gasTgas: Number(APP_GAS / TGAS) });
log.action(`Verify ${child}: code ${vaultCodeHash}, no access keys, factory state ready, get_state v3 (owner ${smokeId}, pool ${poolId}, rewards ${rewardsId})`);
if (stake > 0n) log.action(`deposit_and_stake ${yoctoToNear(stake)} test NEAR into ${child}`, { signer: smokeId, gasTgas: Number(APP_GAS / TGAS) });
if (serverUrl) log.action(`NEP-413 sign-in to ${serverUrl} as ${smokeId}, then GET /api/native/vaults?account=${smokeId}: ${child} ready`);
log.info("exit path", { steps: ["request_exit (1 yocto)", "wait ~4 epochs; advance until owner_credit > 0", "withdraw_owner (1 yocto)"], notRecoverable: "3.5 NEAR child reserve + 0.02 NEAR factory storage" });
if (!opts.execute) {
  if (blockers.length) {
    log.info("dry run blocked", { blockers });
    process.exit(1);
  }
  log.info("dry run complete", { next: "re-run with --execute on the machine with the operator key" });
  process.exit(0);
}

// 5. Execute.
async function send(signer, signerId, receiverId, acts) {
  const out = await new Account(signerId, rpc.provider, signer).signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL" });
  return out;
}
const failure = (out) => [out.status, ...(out.receipts_outcome || []).map((r) => r.outcome.status)].find((s) => s?.Failure);
const result = { network: "testnet", startedAt: new Date().toISOString(), smokeId, factoryId, rewardsId, poolId, contributionBps, transactions: [] };

if (!smokeInfo) {
  if (!existsSync(keyFile)) {
    const key = KeyPair.fromRandom("ed25519");
    mkdirSync(".data", { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, JSON.stringify({ network: "testnet", accountId: smokeId, publicKey: key.getPublicKey().toString(), secretKey: key.toString(), role: "vault-v3-smoke" }, null, 2), { mode: 0o600, flag: "wx" });
    log.info("key written", { keyFile });
  }
}
assert.equal(statSync(keyFile).mode & 0o077, 0, `${keyFile} must be private (chmod 600).`);
const smokeKey = JSON.parse(readFileSync(keyFile, "utf8"));
assert(smokeKey.network === "testnet" && smokeKey.accountId === smokeId, `${keyFile} belongs to ${smokeKey.accountId}.`);
const smokeSigner = KeyPairSigner.fromSecretKey(smokeKey.secretKey);
if (!smokeInfo) {
  const out = await send(operator.signer, operatorId, smokeId, [actions.createAccount(), actions.transfer(funding.fund), actions.addFullAccessKey(PublicKey.fromString(smokeKey.publicKey))]);
  assert(!failure(out), `Creating ${smokeId} failed: ${JSON.stringify(failure(out))}`);
  result.transactions.push({ label: `Create ${smokeId}`, transaction: out.transaction.hash });
} else if (funding.topUp > 0n) {
  const out = await send(operator.signer, operatorId, smokeId, [actions.transfer(funding.topUp)]);
  assert(!failure(out), `Top-up failed: ${JSON.stringify(failure(out))}`);
  result.transactions.push({ label: `Top up ${smokeId}`, transaction: out.transaction.hash });
}
const keys = await rpc.keys(smokeId);
assert(keys.some((k) => k.public_key === smokeKey.publicKey && k.access_key.permission === "FullAccess"), `${smokeId} does not hold the key in ${keyFile}.`);

let position = existing;
if (!existing) {
  // Re-read right before sending: the child id is v<created>.
  const again = await rpc.view(factoryId, "get_config");
  assert(Number(again.created) < Number(again.capacity), "Factory reached capacity.");
  const expectedChild = childAccountId(again.created, factoryId);
  const out = await send(smokeSigner, smokeId, factoryId, [actions.functionCall("create_position", { pool_id: poolId, contribution_bps: contributionBps }, APP_GAS, setupDeposit)]);
  const summary = summarizeCreateOutcome(out, { childId: expectedChild, factoryId, rewardsId });
  result.create = { transaction: out.transaction.hash, expectedChild, ...summary };
  result.transactions.push({ label: "create_position", transaction: out.transaction.hash });
  log.info("create_position", result.create);
  assert(!summary.transactionFailed && summary.child?.ok, `Child creation or new() failed: ${JSON.stringify(summary.failures)}`);
  position = ownPosition(await rpc.view(factoryId, "get_positions", { beneficiary: smokeId }), smokeId);
  assert.equal(position?.account_id, expectedChild, "The factory recorded another child than expected.");
  if (!summary.registered?.ok) log.info("WARNING", { reason: "register_factory_vault did not succeed in the create transaction", failures: summary.failures });
}
if (position.state === "created") {
  const out = await send(smokeSigner, smokeId, factoryId, [actions.functionCall("register_position", { id: position.id }, APP_GAS, 0n)]);
  result.transactions.push({ label: "register_position", transaction: out.transaction.hash });
  log.info("register_position", { transaction: out.transaction.hash, failure: failure(out) || null });
  position = ownPosition(await rpc.view(factoryId, "get_positions", { beneficiary: smokeId }), smokeId);
}
assert.equal(position.state, "ready", `Position ${position.id} is ${position.state}, not ready (registration with ${rewardsId} did not complete).`);
const childInfo = await rpc.account(position.account_id);
assert.equal(childInfo.code_hash, vaultCodeHash, `${position.account_id} runs ${childInfo.code_hash}, not the pinned v3 vault.`);
assert.deepEqual(await rpc.keys(position.account_id), [], `${position.account_id} has access keys; factory children must be keyless.`);
const s0 = await rpc.view(position.account_id, "get_state");
const fresh = !existing || BigInt(s0.principal) === 0n;
const p0 = v3StateProblems(s0, { beneficiary: smokeId, pool: poolId, rewards: rewardsId, contributionBps: existing ? existing.contribution_bps : contributionBps, stake: fresh ? 0n : BigInt(s0.principal) });
assert.deepEqual(p0, [], `get_state is not a fresh v3 position: ${p0.join("; ")}`);
result.stateAfterCreate = s0;

if (stake > 0n && fresh) {
  const out = await send(smokeSigner, smokeId, position.account_id, [actions.functionCall("deposit_and_stake", {}, APP_GAS, stake)]);
  result.transactions.push({ label: `deposit_and_stake ${yoctoToNear(stake)}`, transaction: out.transaction.hash });
  assert(!failure(out), `deposit_and_stake failed: ${JSON.stringify(failure(out))}`);
  const s1 = await rpc.view(position.account_id, "get_state");
  const p1 = v3StateProblems(s1, { beneficiary: smokeId, pool: poolId, rewards: rewardsId, contributionBps: position.contribution_bps, stake });
  assert.deepEqual(p1, [], `get_state after the stake: ${p1.join("; ")}`);
  result.stateAfterStake = s1;
  log.info("staked", { child: position.account_id, principal: s1.principal, staked: s1.staked, tier: s1.tier, weighted_stake: s1.weighted_stake });
}

// 6. Server: sign in as the smoke account and read its positions.
if (serverUrl) {
  const origin = new URL(serverUrl).origin;
  const request = async (path, data, cookie) => {
    const r = await fetch(serverUrl + "/api" + path, {
      method: data ? "POST" : "GET",
      headers: { ...(data ? { "Content-Type": "application/json", Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const json = await r.json();
    assert.equal(r.status, 200, `${path}: ${r.status} ${json.error || ""}`);
    return { data: json, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const { data: c } = await request("/auth/near/challenge", { accountId: smokeId, name: "Vault smoke v3" });
  assert(c.network === "testnet" && c.message.includes(smokeId), "Unexpected sign-in challenge.");
  const signed = await signMessage({
    signerAccount: new Account(smokeId, rpc.provider, smokeSigner),
    payload: { message: c.message, recipient: c.recipient, nonce: new Uint8Array(Buffer.from(c.nonce, "base64")) },
  });
  const session = await request("/auth/near/verify", { challengeId: c.challengeId, accountId: smokeId, publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString("base64") });
  const listing = (await request(`/native/vaults?account=${encodeURIComponent(smokeId)}`, undefined, session.cookie)).data;
  const problems = serverListingProblems(listing, { childId: position.account_id, factoryId });
  result.server = { url: serverUrl, ready: problems.length === 0, problems, position: (listing.positions || []).find((p) => p.account_id === position.account_id) || null };
  assert.deepEqual(problems, [], `Server listing: ${problems.join("; ")}`);
  log.info("server lists ready", { child: position.account_id });
}

result.position = position;
result.finishedAt = new Date().toISOString();
mkdirSync(OUT, { recursive: true });
const path = `${OUT}/${result.finishedAt.replace(/[:.]/g, "-")}.json`;
writeJson(path, result);
log.info("smoke passed", { path, child: position.account_id, transactions: result.transactions, exit: "request_exit -> ~4 epochs -> advance -> withdraw_owner returns the stake; the 3.5 NEAR reserve stays in the child" });
