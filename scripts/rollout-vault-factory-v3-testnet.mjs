// Vault factory generation v3 on testnet (PR #235: stuck-operation recovery,
// harvest limits, settled basis). New self-service positions get vault v3;
// existing keyless children keep the code they were deployed with.
//
// Why this is an in-place factory deploy and not a new factory account:
// contracts/rewards register_factory_vault trusts exactly one factory, derived
// from its own name (questlayer-rewards-<gen> -> questlayer-vaults-<gen>), and has
// no owner call to repoint it. A factory under any other name would create
// children that can never register (they stay "created"; the server only lists
// "ready"). The pinned factory account has its operator FullAccess key and its
// state layout is unchanged (contracts/vault-factory is untouched since
// 2026-10-31; only the embedded vault WASM differs), so its code is replaced
// while it has created no positions. With positions already created, a v3
// generation needs a new rewards generation or a reviewed rewards change; this
// script then stops.
//
// The rewards side needs no call: the binding is by name, and new children
// register themselves through register_factory_vault exactly as before.
//
// Run on the Mac with the operator key, one command at a time:
//   npm run contracts:docker            (or download the CI artifact contract-wasm-linux-amd64)
//   node scripts/rollout-vault-factory-v3-testnet.mjs --network testnet             (plan, read-only)
//   node scripts/rollout-vault-factory-v3-testnet.mjs --network testnet --execute   (deploys)
// Options: --wasm-dir <dir> (CI artifact; default contracts/target/...);
// --deploy-tx <hash> records the deploy of an earlier run that stopped after it.
// On success it moves the old factory record to `factoryHistory` in
// public/native-rewards-testnet.json, records the new hashes and keeps
// contracts/wasm-sha256.json testnetDeploymentsNotFromThisBuild consistent
// with scripts/check-wasm-hashes.mjs. Then deploy the app so the server pins
// the new factory code hash (until then vault creation fails closed with 503).
import assert from "node:assert/strict";
import { codeHashOf, diffValues, droppedExports, pinnedFactoryFor, recordReplacedDeployment, rolloutOptions, wasmEmbeds, deployBalanceOk } from "./lib/vault-rollout.mjs";
import { PINS_PATH, assertFullAccessKey, backupCode, connect, deployAction, loadOperator, pinnedWasm, planLog, readJson, sendActions, writeJson } from "./lib/vault-rollout-io.mjs";

const opts = rolloutOptions(process.argv.slice(2));
const MANIFEST = "public/native-rewards-testnet.json";
const wasmDir = opts.value("--wasm-dir") || process.env.WASM_DIR || "contracts/target/wasm32-unknown-unknown/release";
const rpc = connect(opts);
await rpc.assertChain();
const log = planLog(opts.execute);
const manifest = readJson(MANIFEST);
assert.equal(manifest.network, "testnet", `${MANIFEST} is not a testnet record.`);
const f = manifest.factory;
const rewardsId = manifest.contractId;
const factoryId = f.contractId;

// 1. The reviewed build: vault v3 and the factory embedding exactly it.
const vault = pinnedWasm("questlayer_vault", wasmDir);
const factory = pinnedWasm("questlayer_vault_factory", wasmDir);
assert(wasmEmbeds(factory.bytes, vault.bytes), "The factory WASM does not embed the pinned vault WASM.");
log.info("reviewed build", { vault: { sha256: vault.sha256, codeHash: vault.codeHash, bytes: vault.size }, factory: { sha256: factory.sha256, codeHash: factory.codeHash, bytes: factory.size } });

// 2. Binding: rewards trusts this factory by name; the factory points at rewards.
assert.equal(pinnedFactoryFor(rewardsId), factoryId, `${rewardsId} only registers children of ${pinnedFactoryFor(rewardsId)}, not ${factoryId}.`);
const rewardsCfg = await rpc.view(rewardsId, "get_config");
assert.equal(rewardsCfg.network, "testnet");
const rewardsAccount = await rpc.account(rewardsId);
assert.equal(rewardsAccount.code_hash, manifest.codeHash, `${rewardsId}: deployed code differs from ${MANIFEST}; stop and review.`);

// 3. Live factory state.
const info = await rpc.account(factoryId);
const cfg0 = await rpc.view(factoryId, "get_config");
const positions0 = await rpc.view(factoryId, "get_positions", { beneficiary: null });
log.info("live factory", { factoryId, codeHash: info.code_hash, balance: info.amount, storageUsage: info.storage_usage, config: cfg0, positions: positions0.length });
assert.equal(cfg0.rewards, rewardsId, "Factory points at another rewards contract.");
const already = info.code_hash === factory.codeHash;
if (!already) {
  assert.equal(info.code_hash, f.codeHash, `${factoryId}: deployed code ${info.code_hash} is neither ${MANIFEST} factory.codeHash nor the new build; stop and review.`);
  assert.equal(cfg0.vault_sha256, f.vaultWasmSha256, "Factory embeds another vault than the manifest records.");
}
assert(
  Number(cfg0.created) === 0 && positions0.length === 0,
  `${factoryId} has created ${cfg0.created} position(s). Its code must not change under them (the server pins one vault code hash per factory). ` +
    "A v3 generation then needs a new rewards generation (register_factory_vault binds questlayer-vaults-<gen> by name) or a reviewed rewards change. Stopping.",
);
const liveCode = already ? factory.bytes : await rpc.code(factoryId);
assert.equal(codeHashOf(liveCode), info.code_hash);
const dropped = droppedExports(liveCode, factory.bytes);
assert.deepEqual(dropped, [], `The new factory drops methods: ${dropped.join(", ")}`);
assert(deployBalanceOk({ balance: info.amount, storageUsage: info.storage_usage, oldCodeBytes: liveCode.length, newCodeBytes: factory.size }), `${factoryId} cannot pay storage for the new code; top it up first.`);

const newRecord = {
  ...f,
  codeHash: factory.codeHash,
  wasmSha256: factory.sha256,
  vaultCodeHash: vault.codeHash,
  vaultWasmSha256: vault.sha256,
  setupDeposit: cfg0.setup_deposit,
  generation: "v3-20261109",
};
if (already && f.codeHash === factory.codeHash) {
  log.info("nothing to do", { reason: "factory already runs the pinned v3 build and the manifest records it" });
  process.exit(0);
}

// 4. The plan.
if (!already) {
  log.action(`Back up ${factoryId} code ${info.code_hash} to .data/contract-backups/`);
  log.action(`Deploy factory v3 to ${factoryId}`, { from: info.code_hash, to: factory.codeHash, embeddedVault: vault.sha256 });
}
log.action("Post-check: code hash, get_config unchanged except vault_sha256, created still 0", {});
log.action(`Record generation v3 in ${MANIFEST} (old factory record kept in factoryHistory) and update ${PINS_PATH} exceptions`, { factory: newRecord });
log.info("rewards", { note: `no rewards call: ${rewardsId} registers children of ${factoryId} by name; vault children created from now on get vault v3` });
if (!opts.execute) {
  log.info("dry run complete", { next: "re-run with --execute on the machine with the operator key" });
  process.exit(0);
}

// 5. Execute.
const operator = loadOperator();
await assertFullAccessKey(rpc, factoryId, operator.publicKey);
// If an earlier run deployed but stopped before recording, pass its hash.
let transactionHash = already ? opts.value("--deploy-tx") || null : null;
let backup = null;
if (!already) {
  backup = await backupCode(rpc, factoryId, info.code_hash);
  log.info("backup", backup);
  // Re-check right before sending: no position may have been created meanwhile.
  const again = await rpc.view(factoryId, "get_config");
  assert.equal(Number(again.created), 0, "A position was created during the run; stopping before deploy.");
  const tx = await sendActions(rpc, operator.signer, factoryId, [deployAction(factory.bytes)]);
  transactionHash = tx.transactionHash;
  log.info("deployed", tx);
}
const after = await rpc.account(factoryId);
assert.equal(after.code_hash, factory.codeHash, "Deployed code hash is not the pinned factory build.");
const cfg1 = await rpc.view(factoryId, "get_config");
assert.equal(cfg1.vault_sha256, vault.sha256, "Factory does not embed the reviewed vault v3.");
const changed = diffValues(cfg0, cfg1, { ignore: ["vault_sha256"] });
assert.deepEqual(changed, [], `Factory config changed beyond vault_sha256: ${JSON.stringify(changed)}`);
if (Number(cfg1.created) !== 0) log.info("WARNING", { reason: "a position was created around the deploy; check its code hash against factory.vaultCodeHash before recording", created: cfg1.created });
assert.equal(Number(cfg1.created), 0, "Stopping before the manifest update; review the new position.");

// 6. Record: keep the old generation's record, pin the new hashes.
const pins = readJson(PINS_PATH);
const recorded = recordReplacedDeployment({
  manifest,
  exceptions: pins.testnetDeploymentsNotFromThisBuild,
  manifestFile: MANIFEST,
  currentPath: "factory",
  historyKey: "factoryHistory",
  record: f,
  extra: { replacedAt: new Date().toISOString(), replacedBy: transactionHash, backup: backup?.path ?? null, createdPositions: 0 },
  hashKeys: { wasmSha256: "questlayer_vault_factory", vaultWasmSha256: "questlayer_vault" },
  newHashes: { wasmSha256: factory.sha256, vaultWasmSha256: vault.sha256 },
  built: pins.contracts,
});
const out = recorded.manifest;
out.factory = newRecord;
out.verifiedAt = new Date().toISOString();
out.transactions = [...(out.transactions || []), { label: "Upgrade vault factory: new positions get vault v3 (stuck-op recovery, harvest limits, settled basis)", transaction: transactionHash }];
pins.testnetDeploymentsNotFromThisBuild = recorded.exceptions;
assert.equal(codeHashOf(factory.bytes), out.factory.codeHash);
writeJson(MANIFEST, out);
writeJson(PINS_PATH, pins);
log.info("manifest updated", { MANIFEST, PINS_PATH, next: "node scripts/check-wasm-hashes.mjs, commit both files, then deploy the app so the server pins the new factory" });
