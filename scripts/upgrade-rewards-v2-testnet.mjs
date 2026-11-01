// Reviewed in-place testnet upgrade to rewards v2 and vault v2.
//
// rewards v2: street finds (manifest v2 `finds`) pay 15 XP instead of 2, same GOLD.
// vault v2:   request_partial_exit(amount) and set_contribution(bps).
//
// Both are plain code deploys: the contract state layouts are unchanged (new data
// lives under new storage keys), so there is no migrate call. The script
//   1. checks every deployed code hash against public/native-rewards-testnet.json,
//   2. backs up the deployed WASM to .data/contract-backups/,
//   3. deploys the rewards contract, then proves treasury, config and every known
//      day read back unchanged apart from the new v2 fields,
//   4. upgrades the treasury vault only while no pool promise is in flight and
//      proves its accounting reads back unchanged,
//   5. redeploys the vault factory (new positions get vault v2) only while it has
//      created no keyless v1 positions, since the server pins one vault code hash,
//   6. backfills street finds for published v2 days the v1 contract ignored, only
//      for coins nobody has collected (record_day_finds; needs DATABASE_PATH),
//   7. updates the manifest's code hashes so the server keeps verifying them.
// Testnet only; uses the operator key on this machine; refuses to run without
// --upgrade-reviewed. `--backfill-only` runs step 6 alone (e.g. after copying the
// VPS database). `--skip-vault` / `--skip-factory` leave those accounts alone.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";

const flag = (f) => process.argv.includes(f);
assert(flag("--upgrade-reviewed"), "Pass --upgrade-reviewed after reviewing the contract diff.");
const backfillOnly = flag("--backfill-only");
const manifestPath = "public/native-rewards-testnet.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const operator = JSON.parse(readFileSync(process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json", "utf8"));
assert(manifest.network === "testnet" && operator.network === "testnet", "Testnet only.");
const rewardsId = manifest.contractId;
assert(rewardsId.endsWith(".testnet"), "Testnet only.");
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com" });
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const log = (step, data = {}) => console.log(JSON.stringify({ step, ...data }));
const view = async (id, method, args = {}) =>
  JSON.parse(Buffer.from((await provider.query({ request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" })).result).toString());
const without = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const wasm = (name) => readFileSync(`contracts/target/wasm32-unknown-unknown/release/${name}.wasm`);
const transactions = [];

async function backupAndDeploy(id, expectedHash, bytes) {
  const info = await provider.viewAccount({ accountId: id });
  assert.equal(info.code_hash, expectedHash, `${id}: deployed code differs from the manifest; stop and review.`);
  const code = await provider.query({ request_type: "view_code", account_id: id, finality: "final" });
  mkdirSync(".data/contract-backups", { recursive: true, mode: 0o700 });
  writeFileSync(`.data/contract-backups/${id}-${info.code_hash}.wasm`, Buffer.from(code.code_base64, "base64"), { mode: 0o600 });
  const tx = await new Account(id, provider, signer).signAndSendTransaction({ receiverId: id, actions: [actions.deployContract(bytes)], waitUntil: "FINAL" });
  const codeHash = (await provider.viewAccount({ accountId: id })).code_hash;
  log("deployed", { id, from: info.code_hash, to: codeHash, transactionHash: tx.transaction.hash });
  return { codeHash, wasmSha256: sha(bytes), transactionHash: tx.transaction.hash };
}

const dbPath = process.env.DATABASE_PATH || ".data/questlayer-hackathon.sqlite";
const db = existsSync(dbPath) ? new DatabaseSync(dbPath, { readOnly: true }) : null;
const dayIds = db ? db.prepare("SELECT id FROM native_days WHERE state IN ('prepared','published') ORDER BY day,id").all().map((r) => r.id) : [];

if (!backfillOnly) {
  // 3. Rewards.
  const before = { treasury: await view(rewardsId, "get_treasury"), config: await view(rewardsId, "get_config"), days: {} };
  for (const d of dayIds) before.days[d] = await view(rewardsId, "get_day", { day_id: d });
  const rewardsWasm = wasm("questlayer_rewards");
  const rewards = await backupAndDeploy(rewardsId, manifest.codeHash, rewardsWasm);
  const after = { treasury: await view(rewardsId, "get_treasury"), config: await view(rewardsId, "get_config"), days: {} };
  for (const d of dayIds) after.days[d] = await view(rewardsId, "get_day", { day_id: d });
  assert.equal(after.config.version, 2, "Rewards v2 expected after deploy.");
  assert.deepEqual(after.treasury, before.treasury, "Upgrade changed the treasury.");
  assert.deepEqual(without(after.config, ["version", "coin_xp", "find_xp", "max_finds"]), without(before.config, ["version"]), "Upgrade changed the config.");
  for (const d of dayIds)
    assert.deepEqual(before.days[d] && without(after.days[d], ["finds", "find_xp", "coin_xp"]), before.days[d], `Upgrade changed day ${d}.`);
  manifest.codeHash = rewards.codeHash;
  manifest.wasmSha256 = rewards.wasmSha256;
  transactions.push({ label: "Upgrade rewards v2: street find XP", transaction: rewards.transactionHash });

  // 4. Treasury vault(s) with an operator key.
  const vaultWasm = wasm("questlayer_vault");
  if (!flag("--skip-vault"))
    for (const v of manifest.vaults || []) {
      const s0 = await view(v.accountId, "get_state");
      assert(["idle", "unlocking", "awaiting_cash"].includes(s0.stage), `${v.accountId}: pool promise in flight (${s0.stage}); retry later.`);
      const up = await backupAndDeploy(v.accountId, v.codeHash, vaultWasm);
      const s1 = await view(v.accountId, "get_state");
      const moving = ["version", "epoch", "weighted_stake", "tier", "contribution_policy", "exit_policy", "partial_exit", "pending_contribution_bps"];
      assert.equal(s1.version, 2, "Vault v2 expected after deploy.");
      assert.deepEqual(without(s1, moving), without(s0, moving), `Upgrade changed ${v.accountId} accounting.`);
      Object.assign(v, { codeHash: up.codeHash, wasmSha256: up.wasmSha256 });
      transactions.push({ label: `Upgrade vault v2: ${v.accountId}`, transaction: up.transactionHash });
    }

  // 5. Factory: new positions get vault v2.
  const f = manifest.factory;
  if (f && !flag("--skip-factory")) {
    const cfg0 = await view(f.contractId, "get_config");
    if (cfg0.created > 0) log("factory skipped", { reason: "keyless v1 positions exist; the server pins one vault code hash", created: cfg0.created });
    else {
      const up = await backupAndDeploy(f.contractId, f.codeHash, wasm("questlayer_vault_factory"));
      const cfg1 = await view(f.contractId, "get_config");
      assert.equal(cfg1.vault_sha256, sha(vaultWasm), "Factory does not embed the reviewed vault v2.");
      assert.deepEqual(without(cfg1, ["vault_sha256"]), without(cfg0, ["vault_sha256"]), "Upgrade changed the factory config.");
      const vaultCodeHash = (manifest.vaults || [])[0]?.codeHash;
      Object.assign(f, { codeHash: up.codeHash, wasmSha256: up.wasmSha256, vaultWasmSha256: cfg1.vault_sha256 });
      if (vaultCodeHash && manifest.vaults[0].wasmSha256 === cfg1.vault_sha256) f.vaultCodeHash = vaultCodeHash;
      else log("factory vaultCodeHash", { note: "set factory.vaultCodeHash to the code hash of the new vault WASM before creating positions" });
      transactions.push({ label: "Upgrade vault factory: new positions get vault v2", transaction: up.transactionHash });
    }
  }
  manifest.vaultPolicy = "experimental keyless factory positions; owner-adjustable contribution settled at the old rate; full or partial exit; testnet only";
}

// 6. Street-find backfill for v2 days published while the contract ignored finds.
const backfill = [];
if (!db) log("finds backfill skipped", { reason: `no database at ${dbPath}; rerun with DATABASE_PATH and --backfill-only` });
else {
  const config = await view(rewardsId, "get_config");
  assert.equal(config.version, 2, "Rewards v2 is not deployed yet.");
  const publisher = new Account(config.publisher, provider, signer);
  for (const row of db.prepare("SELECT id, body FROM native_days WHERE state='published' AND id LIKE '%-v2'").all()) {
    const finds = JSON.parse(row.body).finds || [];
    const chain = await view(rewardsId, "get_day", { day_id: row.id });
    if (!chain || chain.closed || !finds.length || chain.finds.length) continue;
    const taken = new Set(db.prepare("SELECT item_index FROM native_reward_claims WHERE day_id=? AND kind='coin'").all(row.id).map((r) => r.item_index));
    const open = finds.filter((i) => !taken.has(i));
    if (!open.length) continue;
    const tx = await publisher.callFunctionRaw({ contractId: rewardsId, methodName: "record_day_finds", args: { day_id: row.id, finds: open }, gas: 30n * 10n ** 12n, deposit: 0n, waitUntil: "FINAL" });
    backfill.push({ dayId: row.id, finds: open.length, transactionHash: tx.transaction.hash });
    transactions.push({ label: `Backfill street finds ${row.id}`, transaction: tx.transaction.hash });
  }
  log("finds backfilled", { backfill });
}

manifest.verifiedAt = new Date().toISOString();
manifest.streetFinds = { since: manifest.streetFinds?.since || manifest.verifiedAt, coinXp: 2, findXp: 15, view: "get_day(day_id).finds", backfill: [...(manifest.streetFinds?.backfill || []), ...backfill] };
manifest.transactions = [...(manifest.transactions || []), ...transactions];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
log("manifest updated", { manifestPath, transactions: transactions.length });
