// Rewards-only, code-only upgrade of the testnet rewards contract to the PR #240
// build (M4: measured callback gas, PAYOUT_MAX_BATCH 8, nonce-recorded mint
// attempts and the reconcile methods). scripts/deploy-qgold-testnet.mjs also
// deploys rewards, but only together with a QGOLD upgrade; this path touches
// the rewards account alone.
//
// Why a plain code deploy: the root Borsh layout of `Rewards` is unchanged; the
// attempts live under new LookupMap prefixes (native-payout-attempts,
// native-withdraw-attempts, native-callback-nonce), so there is no migrate call.
// Callbacks issued by the old code carry no nonce; the new code still settles
// them, but cannot reconcile them if they fail, so the script deploys only while
// none is in flight. Proof: claim_payout and withdraw both add the minted amount
// to get_treasury().pending and only their callbacks take it out, so
// pending == "0" means no payout or withdrawal callback is outstanding. The
// script also reads per-day pending_leaves and the server's worker state, and
// checks pending again right before it sends the deploy.
//
// Run on the Mac with the operator key, one command at a time:
//   npm run contracts:docker            (or download the CI artifact contract-wasm-linux-amd64)
//   node scripts/upgrade-rewards-m4-testnet.mjs --network testnet             (plan, read-only)
//   node scripts/upgrade-rewards-m4-testnet.mjs --network testnet --execute   (deploys)
// Options: --wasm-dir <dir> (CI artifact; default contracts/target/...);
// --server <url> (default https://questlayer.promptstudio3000.com; worker state);
// --no-server (skip the server signals; the chain proof still applies);
// --payout-day <id> / --day <id> (repeatable, extra days to snapshot);
// --deploy-tx <hash> records the deploy of an earlier run that stopped after it.
// On success it moves the old rewards record to `previousDeployments` in
// public/native-rewards-testnet.json, records the new hashes (also
// globalRewards.rewardsCodeHash), and removes the rewards entry from
// contracts/wasm-sha256.json testnetDeploymentsNotFromThisBuild consistently with
// scripts/check-wasm-hashes.mjs. Then: commit both files, deploy the app so the
// server pins the new code hash, and update REWARDS_CODE in the VPS cron script
// sync-world-funding.py (printed at the end; this script never touches the VPS).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { base58Hex, codeHashOf, deployBalanceOk, droppedExports, rawStateDigest, recordReplacedDeployment, rolloutOptions, wasmExports } from "./lib/vault-rollout.mjs";
import { PINS_PATH, assertFullAccessKey, backupCode, connect, deployAction, loadOperator, pinnedWasm, planLog, readJson, sendActions, writeJson } from "./lib/vault-rollout-io.mjs";
import {
  M4_NEW_METHODS,
  M4_NEW_PREFIXES,
  compareRewardsSnapshots,
  isM4PayoutConfig,
  liquidAfterDeploy,
  m4ManifestFields,
  pragueHour,
  rewardsBusyReasons,
  snapshotTargets,
  treasuryMismatches,
  worldDayId,
} from "./lib/rewards-upgrade.mjs";

const argv = process.argv.slice(2);
const opts = rolloutOptions(argv);
const all = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : a.startsWith(flag + "=") ? [a.slice(flag.length + 1)] : [])).filter(Boolean);
const MANIFEST = "public/native-rewards-testnet.json";
const SNAPSHOTS = "output/qa/rewards-m4-upgrade";
const wasmDir = opts.value("--wasm-dir") || process.env.WASM_DIR || "contracts/target/wasm32-unknown-unknown/release";
const serverUrl = opts.has("--no-server") ? null : opts.value("--server") || process.env.QUESTLAYER_API_URL || "https://questlayer.promptstudio3000.com";
if (serverUrl) assert(["questlayer.promptstudio3000.com", "localhost", "127.0.0.1"].includes(new URL(serverUrl).hostname), "Unknown server host.");

const rpc = connect(opts);
await rpc.assertChain();
const log = planLog(opts.execute);
// A dry run reports every blocker and exits 1; --execute stops at the first.
const blockers = [];
const block = (ok, reason) => {
  if (ok) return true;
  if (opts.execute) assert.fail(reason);
  blockers.push(reason);
  log.info("BLOCKER", { reason });
  return false;
};
const manifest = readJson(MANIFEST);
const pins = readJson(PINS_PATH);
assert.equal(manifest.network, "testnet", `${MANIFEST} is not a testnet record.`);
const rewardsId = manifest.contractId;
assert(/^questlayer-rewards-.+\.testnet$/.test(rewardsId), "Testnet rewards account only.");
const newSha = pins.contracts.questlayer_rewards;
const newCodeHash = base58Hex(newSha);

// 1. The reviewed build.
let wasm = null;
try {
  wasm = pinnedWasm("questlayer_rewards", wasmDir);
  log.info("reviewed build", { sha256: wasm.sha256, codeHash: wasm.codeHash, bytes: wasm.size });
} catch (e) {
  block(false, e.message);
}

// 2. Live account against the manifest.
const info = await rpc.account(rewardsId);
const already = info.code_hash === newCodeHash;
log.info("live rewards", { rewardsId, codeHash: info.code_hash, balance: info.amount, storageUsage: info.storage_usage, manifestCodeHash: manifest.codeHash, pinnedCodeHash: newCodeHash });
if (already && manifest.codeHash === newCodeHash) {
  log.info("nothing to do", { reason: "rewards already runs the pinned M4 build and the manifest records it" });
  process.exit(0);
}
if (!already) assert.equal(info.code_hash, manifest.codeHash, `${rewardsId}: deployed code ${info.code_hash} is neither ${MANIFEST} codeHash nor the pinned build; stop and review.`);
// The manifest on this checkout must already record the live factory (v3,
// commit bc8331e6), or the manifest written below would drop that record.
const factoryInfo = manifest.factory ? await rpc.account(manifest.factory.contractId) : null;
block(
  !factoryInfo || factoryInfo.code_hash === manifest.factory.codeHash,
  `${MANIFEST} factory.codeHash ${manifest.factory?.codeHash} is not the live factory code ${factoryInfo?.code_hash}: this checkout lacks the factory v3 record (bc8331e6). Merge it first.`,
);
const rewardsCfg = await rpc.view(rewardsId, "get_config");
assert.equal(rewardsCfg.network, "testnet");

// 3. Methods: nothing removed; the M4 methods are new.
const liveCode = already ? null : await rpc.code(rewardsId);
if (liveCode) assert.equal(codeHashOf(liveCode), info.code_hash, "Downloaded code does not hash to the live code hash.");
if (wasm && liveCode) {
  const dropped = droppedExports(liveCode, wasm.bytes);
  block(dropped.length === 0, `The new rewards drops methods: ${dropped.join(", ")}`);
  const oldNames = new Set(wasmExports(liveCode)),
    newNames = new Set(wasmExports(wasm.bytes));
  const missing = M4_NEW_METHODS.filter((m) => !newNames.has(m));
  block(missing.length === 0, `The pinned build lacks M4 methods: ${missing.join(", ")}`);
  const early = M4_NEW_METHODS.filter((m) => oldNames.has(m));
  block(early.length === 0, `The live code already exports M4 methods (${early.join(", ")}); stop and review.`);
  log.info("methods", { old: oldNames.size, new: newNames.size, added: [...newNames].filter((n) => !oldNames.has(n)) });
}

// 4. Keys: the deploy is signed by the rewards account itself (operator FullAccess key);
//    the reward worker's function-call key stays as it is.
const keys = await rpc.keys(rewardsId);
const fullAccess = keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
const worker = keys.find((k) => k.public_key === manifest.workerPublicKey);
log.info("access keys", { fullAccess, workerKey: manifest.workerPublicKey, workerMethods: worker?.access_key.permission?.FunctionCall?.method_names ?? null });
block(fullAccess.length > 0, `${rewardsId} has no FullAccess key; the operator cannot deploy.`);
block(worker && worker.access_key.permission !== "FullAccess", "The reward worker key must stay a function-call key.");

// 5. Day ids from the public server endpoints (+ flags), then the quiet check.
const getJson = async (path) => {
  const r = await fetch(serverUrl + path, { signal: AbortSignal.timeout(30_000) });
  assert(r.ok, `${path}: HTTP ${r.status}`);
  return r.json();
};
let health = null,
  mapDay = null,
  distribution = null;
if (serverUrl) {
  try {
    [health, mapDay, distribution] = await Promise.all([getJson("/api/health"), getJson("/api/map/rewards/day"), getJson("/api/native/distribution")]);
    block(health.network === "testnet", `${serverUrl} serves ${health.network}, not testnet.`);
    block(distribution.contractId === rewardsId, `${serverUrl} audits ${distribution.contractId}, not ${rewardsId}.`);
    log.info("server", { url: serverUrl, build: health.source?.buildId, nativeRewards: health.nativeRewards, distribution: distribution.status, payoutsEnabled: mapDay.payouts !== null });
  } catch (e) {
    block(false, `Server ${serverUrl} unreadable (${e.message}). Fix it, or pass --no-server to rely on the chain proof alone.`);
  }
} else log.info("server skipped", { note: "--no-server: only the chain proof (treasury pending, per-day pending_leaves) is checked" });
const targets = snapshotTargets({ distribution, mapDay, extraDays: all("--day"), extraPayoutDays: all("--payout-day"), nowMs: Date.now() });
log.info("snapshot targets", targets);

async function snapshot(label) {
  const v = (method, args) => rpc.view(rewardsId, method, args);
  const each = async (ids, fn) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await fn(id)])));
  const views = {
    config: await v("get_config"),
    treasury: await v("get_treasury"),
    payoutConfig: await v("get_payout_config"),
    worldBudget: await v("get_world_budget"),
    days: await each(targets.days, (d) => v("get_day", { day_id: d })),
    mapDays: await each(targets.mapDays, (d) => v("get_map_day", { day_id: d })),
    payoutDays: await each(targets.payoutDays, (d) => v("get_payout_day", { day_id: d })),
    progress: await each(targets.payoutDays, (d) => v("get_payout_progress", { day_id: d, indexes: [] })),
    worldDays: await each(targets.dates.map(worldDayId), (d) => v("get_world_day", { day_id: d })),
    dateTotals: await each(targets.dates, (d) => v("get_date_totals", { date: d })),
  };
  let rawState = null;
  try {
    const r = await rpc.provider.query({ request_type: "view_state", account_id: rewardsId, prefix_base64: Buffer.from("STATE").toString("base64"), finality: "final" });
    const root = r.values.filter((x) => Buffer.from(x.key, "base64").toString("latin1") === "STATE");
    rawState = { blockHeight: r.block_height, digest: rawStateDigest(root), bytes: root[0] ? Buffer.from(root[0].value, "base64").length : 0 };
  } catch (e) {
    rawState = { unavailable: String(e.message || e).slice(0, 160) };
  }
  const s = { label, at: new Date().toISOString(), rewardsId, codeHash: (await rpc.account(rewardsId)).code_hash, views, rawState };
  mkdirSync(SNAPSHOTS, { recursive: true });
  const path = `${SNAPSHOTS}/${s.at.replace(/[:.]/g, "-")}-${label}.json`;
  writeJson(path, s);
  log.info("snapshot", { label, path, rawState });
  return s;
}

async function newPrefixesEmpty() {
  const found = {};
  for (const p of M4_NEW_PREFIXES) {
    try {
      const r = await rpc.provider.query({ request_type: "view_state", account_id: rewardsId, prefix_base64: Buffer.from(p).toString("base64"), finality: "final" });
      found[p] = r.values.length;
    } catch (e) {
      found[p] = `unavailable: ${String(e.message || e).slice(0, 80)}`;
    }
  }
  return found;
}

const before = await snapshot(opts.execute ? "before" : "dryrun-before");
const t0 = before.views.treasury;
block(treasuryMismatches(t0).length === 0, `Treasury not conserved: ${treasuryMismatches(t0).join("; ")}`);
const busy = rewardsBusyReasons({ treasury: t0, progress: before.views.progress, health, payouts: mapDay?.payouts, distribution, pragueHour: pragueHour(Date.now()) });
for (const r of busy) block(false, `Not quiet: ${r}`);
if (!busy.length) log.info("quiet", { treasuryPending: t0.pending, payoutDays: Object.keys(before.views.progress).length, proof: "treasury pending 0 => no payout or withdrawal callback in flight" });
if (!already) {
  const prefixes = await newPrefixesEmpty();
  log.info("new storage prefixes", prefixes);
  for (const [p, n] of Object.entries(prefixes)) if (typeof n === "number") block(n === 0, `Storage prefix ${p} already holds ${n} key(s); the M4 maps would read foreign data.`);
  block(!isM4PayoutConfig(before.views.payoutConfig), "get_payout_config already reports the M4 values on the old code hash; stop and review.");
}
if (wasm && liveCode) {
  block(deployBalanceOk({ balance: info.amount, storageUsage: info.storage_usage, oldCodeBytes: liveCode.length, newCodeBytes: wasm.size }), `${rewardsId} cannot pay storage for the new code; top it up first.`);
  const liquid = liquidAfterDeploy(before.views.worldBudget, liveCode.length, wasm.size);
  log.info("storage", { oldCodeBytes: liveCode.length, newCodeBytes: wasm.size, liquidBackingAfter: liquid.toString() });
  block(liquid >= 0n, `World liquid backing would go negative (${liquid}); top up the rewards account first.`);
}

// 6. The plan.
if (!already) {
  log.action(`Back up ${rewardsId} code ${info.code_hash} to .data/contract-backups/`);
  log.action(`Re-check get_treasury().pending == "0", then deploy the M4 rewards build to ${rewardsId} (signed by ${rewardsId})`, { from: info.code_hash, to: newCodeHash, sha256: newSha });
}
log.action("Post-check: code hash, raw STATE bytes, config/treasury/days/payout days/world days/date totals unchanged; get_payout_config max_batch 8 plus mint_tgas 15, callback_tgas 10, reconcile_after_ms 86400000; conservation", {});
log.action(`Record in ${MANIFEST}: old record -> previousDeployments, new codeHash/wasmSha256, globalRewards.rewardsCodeHash, callbackRecoveryUpgrade; drop the rewards entry from ${PINS_PATH} testnetDeploymentsNotFromThisBuild`, { codeHash: newCodeHash });
log.info("operator follow-up", { REWARDS_CODE: newCodeHash, file: "output/qa/global-release/runtime-20261107/sync-world-funding.py (VPS cron copy)", note: "update by hand after the app deploy; this script never touches the VPS" });
if (!opts.execute) {
  if (blockers.length) {
    log.info("dry run blocked", { blockers });
    process.exit(1);
  }
  log.info("dry run complete", { next: "re-run with --execute on the machine with the operator key" });
  process.exit(0);
}

// 7. Execute.
const operator = loadOperator();
await assertFullAccessKey(rpc, rewardsId, operator.publicKey);
let transactionHash = already ? opts.value("--deploy-tx") || null : null;
let backup = null;
if (!already) {
  backup = await backupCode(rpc, rewardsId, info.code_hash);
  log.info("backup", backup);
  const again = await rpc.view(rewardsId, "get_treasury");
  assert.equal(String(again.pending), "0", `A mint callback started during the run (pending ${again.pending}); stopping before deploy.`);
  assert.equal((await rpc.account(rewardsId)).code_hash, info.code_hash, "The code changed during the run; stopping.");
  const tx = await sendActions(rpc, operator.signer, rewardsId, [deployAction(wasm.bytes)]);
  transactionHash = tx.transactionHash;
  log.info("deployed", tx);
}
const after = await snapshot("after");
assert.equal(after.codeHash, newCodeHash, "Deployed code hash is not the pinned rewards build.");
assert.deepEqual(treasuryMismatches(after.views.treasury), [], "Treasury not conserved after the deploy.");
assert(isM4PayoutConfig(after.views.payoutConfig), `get_payout_config is not the M4 build's: ${JSON.stringify(after.views.payoutConfig)}`);
if (!already) {
  const changed = compareRewardsSnapshots(before, after);
  assert.deepEqual(changed, [], `Upgrade changed more than the payout config: ${JSON.stringify(changed)}`);
} else log.info("WARNING", { reason: "resumed after an earlier deploy: no before-snapshot from the old code; only conservation and the M4 config were checked", deployTx: transactionHash });
// The new views answer and nothing is recorded yet.
assert.equal(await rpc.view(rewardsId, "get_withdrawal_attempt", { account_id: operator.accountId }), null);
for (const d of targets.payoutDays.slice(0, 1)) log.info("attempt view", { day: d, index0: await rpc.view(rewardsId, "get_payout_attempt", { day_id: d, index: 0 }) });

// 8. Record.
let sourceCommit = null;
try {
  sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {}
const replacedAt = new Date().toISOString();
const recorded = recordReplacedDeployment({
  manifest,
  exceptions: pins.testnetDeploymentsNotFromThisBuild,
  manifestFile: MANIFEST,
  currentPath: "",
  historyKey: "previousDeployments",
  record: { contractId: rewardsId, codeHash: manifest.codeHash, wasmSha256: manifest.wasmSha256 },
  extra: { replacedAt, replacedBy: transactionHash, backup: backup?.path ?? null },
  hashKeys: { wasmSha256: "questlayer_rewards" },
  newHashes: { wasmSha256: newSha },
  built: pins.contracts,
});
const out = m4ManifestFields(recorded.manifest, {
  codeHash: newCodeHash,
  wasmSha256: newSha,
  previousCodeHash: manifest.codeHash,
  transactionHash,
  verifiedAt: replacedAt,
  sourceCommit,
  payoutConfig: after.views.payoutConfig,
});
pins.testnetDeploymentsNotFromThisBuild = recorded.exceptions;
writeJson(MANIFEST, out);
writeJson(PINS_PATH, pins);
log.info("manifest updated", {
  MANIFEST,
  PINS_PATH,
  codeHash: newCodeHash,
  next: [
    "node scripts/check-wasm-hashes.mjs (with the same WASM_DIR) and commit both files",
    "deploy the app so the server pins the new rewards code hash (until then native collection reports a code mismatch)",
    `on the VPS, set REWARDS_CODE='${newCodeHash}' in sync-world-funding.py (it asserts manifest codeHash == globalRewards.rewardsCodeHash == REWARDS_CODE)`,
  ],
});
