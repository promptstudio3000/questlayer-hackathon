// In-place code upgrade of questlayer-yield-20261102.testnet to the PR #235
// build (H4: no Rhea supply over an inbound withdrawal; M5: storage reserve,
// kept payout records, reconcile_idle). The account holds live stNEAR and USDC
// deposits.
//
// Code only, no migrate call: the contract has no migrate method and #235 does
// not touch the Borsh layout of YieldVault, Token, Position or QueueEntry (new
// behaviour reuses existing fields; OP_RECONCILE is a new value of `op`). The
// script proves that on the live account instead of trusting it: it decodes the
// whole raw storage with the source layout (every byte consumed) before and
// after, and requires the storage to be byte-identical across the deploy.
//
// Flow (dry run prints every action and sends nothing):
//   1. pre-flight: pinned WASM, no method dropped, no op/outgoing/inbound/pending
//      on any token, accounting invariants, storage reserve under the new rule,
//      operator FullAccess key (execute only);
//   2. snapshot "before": raw state + digest, decoded state, get_config,
//      get_tokens, get_position of every holder, get_queue of every token, the
//      vault's balance on each token and its Rhea supply shares, all at one
//      block, written to output/qa/yield-vault-upgrade/;
//   3. set_deposits_paused(true) (withdrawals stay open), snapshot "paused":
//      only deposits_paused may differ from "before";
//   4. back up the deployed WASM to .data/contract-backups/, deploy;
//   5. snapshot "after": byte-identical storage to "paused", views equal apart
//      from the three new get_config fields;
//   6. set_deposits_paused(false) if it was false before, snapshot "final":
//      byte-identical storage to "before";
//   7. record the new hashes in public/native-yield-vault-testnet.json, keep the
//      old one under previousDeployments, update contracts/wasm-sha256.json.
// Any failed check stops the run with deposits still paused (safe: withdrawals
// keep working) and prints the rollback command.
//
// Run on the Mac with the operator key. Do not run while the 06:30 stNEAR
// harvest / treasury-mix LaunchAgent is due (it calls this vault).
//   npm run contracts:docker            (or --wasm-dir with the CI artifact)
//   node scripts/upgrade-yield-vault-testnet.mjs --network testnet             (plan, read-only)
//   node scripts/upgrade-yield-vault-testnet.mjs --network testnet --execute   (upgrades)
// Rollback (redeploys the backed-up WASM with the same checks; no manifest edit):
//   node scripts/upgrade-yield-vault-testnet.mjs --network testnet --rollback .data/contract-backups/<id>-<hash>.wasm [--execute]
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  codeHashOf,
  compareYieldSnapshots,
  decodeYieldRaw,
  droppedExports,
  positionAccounts,
  predictYieldStorageReserve,
  rawStateDigest,
  recordReplacedDeployment,
  rolloutOptions,
  sha256Hex,
  wasmExports,
  yieldAccountingMismatches,
  yieldBusyReasons,
} from "./lib/vault-rollout.mjs";
import { PINS_PATH, assertFullAccessKey, backupCode, callAction, connect, deployAction, loadOperator, pinnedWasm, planLog, readJson, sendActions, writeJson } from "./lib/vault-rollout-io.mjs";

const opts = rolloutOptions(process.argv.slice(2));
const MANIFEST = "public/native-yield-vault-testnet.json";
const rpc = connect(opts);
await rpc.assertChain();
const log = planLog(opts.execute);
const manifest = readJson(MANIFEST);
assert.equal(manifest.network, "testnet", `${MANIFEST} is not a testnet record.`);
const id = manifest.contractId;
assert(id.endsWith(".testnet"), "Testnet only.");
const rheaId = manifest.rheaId;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = "output/qa/yield-vault-upgrade";

// 1. Code to deploy and code expected on chain.
const rollbackPath = opts.value("--rollback");
let target, expectedLive;
if (rollbackPath) {
  const bytes = readFileSync(rollbackPath);
  const known = [manifest.codeHash, ...(manifest.previousDeployments || []).map((d) => d.codeHash)];
  target = { path: rollbackPath, bytes, sha256: sha256Hex(bytes), codeHash: codeHashOf(bytes), size: bytes.length };
  assert(known.includes(target.codeHash), `${rollbackPath} is no code this account is recorded to have run.`);
  expectedLive = pinnedWasm("questlayer_yield_vault", opts.value("--wasm-dir") || process.env.WASM_DIR || "contracts/target/wasm32-unknown-unknown/release").codeHash;
} else {
  target = pinnedWasm("questlayer_yield_vault", opts.value("--wasm-dir") || process.env.WASM_DIR || "contracts/target/wasm32-unknown-unknown/release");
  expectedLive = manifest.codeHash;
}
log.info(rollbackPath ? "rollback code" : "reviewed build", { path: target.path, sha256: target.sha256, codeHash: target.codeHash, bytes: target.size });

// 2. Snapshot: everything read at one block height.
async function snapshot(label) {
  const height = await rpc.finalHeight();
  const account = await rpc.account(id, height);
  const raw = await rpc.rawState(id, height);
  const decoded = decodeYieldRaw(raw.values);
  const holders = positionAccounts(decoded.positions);
  const views = {
    config: await rpc.view(id, "get_config", {}, height),
    tokens: await rpc.view(id, "get_tokens", {}, height),
    positions: {},
    queues: {},
  };
  for (const a of holders) views.positions[a] = await rpc.view(id, "get_position", { account_id: a }, height);
  for (const t of decoded.state.tokens) views.queues[t.id] = await rpc.view(id, "get_queue", { token_id: t.id, limit: 50 }, height);
  const external = { balances: {}, rheaSupplyShares: {} };
  for (const t of decoded.state.tokens) external.balances[t.id] = await rpc.view(t.id, "ft_balance_of", { account_id: id }, height);
  const rhea = await rpc.view(rheaId, "get_account", { account_id: id }, height);
  for (const s of rhea?.supplied || []) external.rheaSupplyShares[s.token_id] = s.shares;
  const snap = {
    label,
    contractId: id,
    blockHeight: height,
    takenAt: new Date().toISOString(),
    account: { codeHash: account.code_hash, amount: account.amount, storageUsage: account.storage_usage },
    raw: { digest: rawStateDigest(raw.values), values: raw.values },
    decoded,
    views,
    external,
  };
  mkdirSync(outDir, { recursive: true });
  const file = `${outDir}/${stamp}-${opts.execute ? "" : "dryrun-"}${rollbackPath ? "rollback-" : ""}${label}.json`;
  writeJson(file, snap);
  log.info("snapshot", { label, file, blockHeight: height, digest: snap.raw.digest, positions: Object.keys(decoded.positions).length, holders: holders.length });
  return snap;
}

const compare = (a, b, o = {}) => compareYieldSnapshots(a, b, { ...o, droppedConfigFields: !!rollbackPath });
let codeSwitched = false;
function mustMatch(what, diffs) {
  if (diffs.length) {
    log.info("ABORT", { what, diffs: diffs.slice(0, 20), count: diffs.length });
    log.info(
      "next",
      codeSwitched
        ? {
            depositsStayPaused: true,
            note: "Withdrawals keep working while deposits are paused. Compare the snapshot files; if the new code is at fault, redeploy the backup:",
            command: `node scripts/upgrade-yield-vault-testnet.mjs --network testnet --rollback .data/contract-backups/${id}-${expectedLive}.wasm --execute`,
          }
        : { depositsStayPaused: true, note: "No code was deployed. Someone changed the vault during the run; review the snapshot files, then resume deposits with set_deposits_paused(false) or re-run." },
    );
    process.exit(1);
  }
  log.info("match", { what });
}

// 3. Pre-flight.
const info = await rpc.account(id);
assert.equal(info.code_hash, rollbackPath ? expectedLive : manifest.codeHash, `${id}: deployed code ${info.code_hash} is not the expected ${expectedLive}; stop and review.`);
if (info.code_hash === target.codeHash) {
  log.info("nothing to deploy", { reason: "the account already runs this code" });
  process.exit(0);
}
const liveCode = await rpc.code(id);
assert.equal(codeHashOf(liveCode), info.code_hash);
if (!rollbackPath) {
  const dropped = droppedExports(liveCode, target.bytes);
  assert.deepEqual(dropped, [], `The new code drops methods: ${dropped.join(", ")}`);
  assert(!wasmExports(target.bytes).includes("migrate"), "The new code exports migrate: this script performs code-only upgrades; review the migration first.");
  log.info("exports", { added: wasmExports(target.bytes).filter((n) => !wasmExports(liveCode).includes(n)), dropped, migrate: false });
}
const before = await snapshot("before");
const busy = yieldBusyReasons(before.decoded.state);
assert.deepEqual(busy, [], `Not idle; retry later: ${busy.join("; ")}`);
const mismatches = yieldAccountingMismatches(before.decoded);
assert.deepEqual(mismatches, [], `Accounting invariant broken before the upgrade: ${mismatches.join("; ")}`);
const reserve = predictYieldStorageReserve({ balance: info.amount, storageUsage: info.storage_usage, oldCodeBytes: liveCode.length, newCodeBytes: target.size, positionCount: before.decoded.state.position_count });
log.info("storage reserve after deploy", reserve);
assert(reserve.ok, `After the deploy deposits would be refused (storage reserve): top ${id} up to at least ${reserve.needed} yoctoNEAR first.`);
const wasPaused = before.decoded.state.deposits_paused;

if (!wasPaused) log.action(`set_deposits_paused(true) on ${id} (withdrawals stay open)`);
log.action(`Back up ${id} code ${info.code_hash} to .data/contract-backups/`);
log.action(`Deploy ${rollbackPath ? "rollback" : "PR #235"} code to ${id}`, { from: info.code_hash, to: target.codeHash, migrate: "none (code only)" });
log.action("Post-check: storage byte-identical, every position, token total, queue, balance and Rhea share unchanged");
if (!wasPaused) log.action(`set_deposits_paused(false) on ${id}`);
if (!rollbackPath) log.action(`Record ${target.codeHash} in ${MANIFEST} (old code kept under previousDeployments) and update ${PINS_PATH}`);
if (!opts.execute) {
  log.info("dry run complete", { next: "re-run with --execute on the machine with the operator key" });
  process.exit(0);
}

// 4. Execute.
const operator = loadOperator();
assert.equal(operator.accountId, before.decoded.state.owner, "The operator key is not the yield vault owner.");
await assertFullAccessKey(rpc, id, operator.publicKey);
const transactions = [];
let paused = before;
if (!wasPaused) {
  const tx = await sendActions(rpc, operator.signer, operator.accountId, [callAction("set_deposits_paused", { paused: true })], id);
  transactions.push({ label: "Pause yield vault deposits for the code upgrade", transaction: tx.transactionHash });
  paused = await snapshot("paused");
  assert.equal(paused.decoded.state.deposits_paused, true);
  mustMatch("before vs paused (only deposits_paused)", compare(before, paused, { allowPausedFlag: true }));
}
assert.deepEqual(yieldBusyReasons(paused.decoded.state), [], "An operation started meanwhile; deposits stay paused, retry the run.");
const backup = await backupCode(rpc, id, info.code_hash);
log.info("backup", backup);
const deployed = await sendActions(rpc, operator.signer, id, [deployAction(target.bytes)]);
codeSwitched = true;
transactions.push({ label: rollbackPath ? `Roll back ${id} to ${target.codeHash}` : "Upgrade yield vault: no supply over an inbound Rhea withdrawal, storage reserve, reconcile_idle (H4, M5)", transaction: deployed.transactionHash });
log.info("deployed", deployed);
assert.equal((await rpc.account(id)).code_hash, target.codeHash, "Deployed code hash differs.");
const after = await snapshot("after");
mustMatch("paused vs after (code switch)", compare(paused, after, { newConfigFields: !rollbackPath }));
if (!rollbackPath) assert.equal(after.views.config.storage_reserve_ok, true, "storage_reserve_ok is false after the deploy; deposits stay paused until a top-up.");
let final = after;
if (!wasPaused) {
  const tx = await sendActions(rpc, operator.signer, operator.accountId, [callAction("set_deposits_paused", { paused: false })], id);
  transactions.push({ label: "Resume yield vault deposits", transaction: tx.transactionHash });
  final = await snapshot("final");
}
mustMatch("before vs final", compare(before, final, { newConfigFields: !rollbackPath }));

if (rollbackPath) {
  log.info("rolled back", { transactions, note: `Revert the manifest commit that recorded the upgrade if it was committed; ${MANIFEST} is unchanged by a rollback run.` });
  process.exit(0);
}

// 5. Record.
const pins = readJson(PINS_PATH);
const old = { codeHash: manifest.codeHash, wasmSha256: manifest.wasmSha256, verifiedAt: manifest.verifiedAt };
const recorded = recordReplacedDeployment({
  manifest,
  exceptions: pins.testnetDeploymentsNotFromThisBuild,
  manifestFile: MANIFEST,
  currentPath: "",
  historyKey: "previousDeployments",
  record: old,
  extra: { replacedAt: new Date().toISOString(), replacedBy: deployed.transactionHash, backup: backup.path },
  hashKeys: { wasmSha256: "questlayer_yield_vault" },
  newHashes: { wasmSha256: target.sha256 },
  built: pins.contracts,
});
const out = recorded.manifest;
Object.assign(out, { codeHash: target.codeHash, wasmSha256: target.sha256, verifiedAt: new Date().toISOString() });
out.upgrades = [...(out.upgrades || []), { at: out.verifiedAt, from: old.codeHash, to: target.codeHash, transactions, snapshots: `${outDir}/${stamp}-*.json`, stateDigest: final.raw.digest }];
pins.testnetDeploymentsNotFromThisBuild = recorded.exceptions;
writeJson(MANIFEST, out);
writeJson(PINS_PATH, pins);
assert(existsSync(backup.path));
log.info("manifest updated", { MANIFEST, PINS_PATH, next: "node scripts/check-wasm-hashes.mjs, then commit both files and the snapshot files" });
