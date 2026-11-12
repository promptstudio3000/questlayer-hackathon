// Deploys the Test Layer's own testnet contract set (docs/TEST-LAYER.md).
//
// The Test Layer is the same game as QuestLayer World on a separate contract
// set, so Test QGOLD, test Auras and test trades never touch the real testnet
// economy. Nothing here is new contract code: every step is one of the existing,
// reviewed deploy scripts, run in an isolated work tree with the Test Layer's
// own account ids. That also rehearses a full fresh deployment, which mainnet
// needs later.
//
//   node scripts/deploy-testlayer.mjs            plan only (signs nothing)
//   node scripts/deploy-testlayer.mjs --execute  run every step not done yet
//
// Run where the operator key is (NEAR_OPERATOR_PATH, default .data/near-operator.json;
// the VPS runner since 12 Nov). Needs a git checkout with node_modules and the
// reproducible contracts/target builds. TESTLAYER_WORK moves the work tree. Steps:
//   0. work tree .data/testlayer/work (this checkout's HEAD, refreshed on every
//      run so a tree left by an earlier checkout never runs stale code) with its own .data/
//      holding only a copy of the operator key; every key the scripts create
//      (award signer, minters, recorder, publisher, factory, relayer) stays
//      there. All public/*-testnet.json records are removed in the work tree, so
//      a script that would read a real testnet manifest fails instead.
//   1. funds the operator from the faucet accounts in
//      scripts/data/testlayer-funds-testnet.txt (operator full-access key).
//   2. the collectibles slice (collectibles, player factory, relayer, badges,
//      npc-games) via deploy-mainnet-slice.mjs in testnet mode.
//   3. rewards + vault factory, QGOLD vault, ledger + soulbound QGOLD, market,
//      QGOLD escrow, creators: the per-contract testnet scripts.
//   4. copies each written record to public/<name>-testlayer.json in this
//      repository (testnet-deployment.json -> testlayer-deployment.json) and
//      shares the Intents verifier record (it only verifies signed intents).
// Re-running is safe: the scripts skip finished steps, the journal in the work
// tree's .data/ remembers transactions.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Paced RPC with 429 backoff and fastnear/drpc failover, here and in every step.
import "./lib/rpc-patience.mjs";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";
import { rpcErrorText } from "../server/near-provider.mjs";

const execute = process.argv.includes("--execute");
const repo = resolve(import.meta.dirname, "..");
const work = resolve(process.env.TESTLAYER_WORK || resolve(repo, ".data/testlayer/work"));
const operatorPath = resolve(process.env.NEAR_OPERATOR_PATH || resolve(repo, ".data/near-operator.json"));
const TAG = process.env.TESTLAYER_TAG || "tl1112";
const ORIGIN = process.env.TESTLAYER_ORIGIN || "https://test.questlayer.promptstudio3000.com";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
if (operator.network !== "testnet" || !operator.accountId.endsWith(".testnet"))
  throw new Error("The Test Layer is testnet only.");
const op = operator.accountId;
// Top-level ids keep the questlayer-<name>-<generation> shape: the vault
// factory contract accepts only questlayer-vaults-* and questlayer-rewards-*
// testnet accounts (contracts/vault-factory, "Pinned testnet factory only").
// The first runs used ql-<tag>-<name>; those accounts stay unused.
const top = (name) => `questlayer-${name}-${TAG}.testnet`;
const sub = (name) => `${name}-${TAG}.${op}`;

// Account ids of the Test Layer set. Top-level ids are created by the testnet
// helper (10 test NEAR each); sub-accounts of the operator are funded by it.
export const ACCOUNTS = {
  COLLECTIBLES_ACCOUNT: sub("nfts"),
  PLAYER_FACTORY_ACCOUNT: sub("play"),
  RELAYER_ACCOUNT: sub("relay"),
  BADGES_ACCOUNT: sub("badges"),
  NPC_GAMES_ACCOUNT: sub("npc-games"),
  NEAR_REWARDS_ACCOUNT: top("rewards"),
  NEAR_VAULT_FACTORY_ACCOUNT: top("vaults"),
  NEAR_VAULT_ACCOUNT: top("vault"),
  NEAR_QGOLD_VAULT_ACCOUNT: top("qgold-vault"),
  NEAR_LEDGER_ACCOUNT: top("ledger"),
  NEAR_QGOLD_ACCOUNT: top("qgold"),
  NEAR_MARKET_ACCOUNT: top("market"),
  NEAR_QGOLD_ESCROW_ACCOUNT: top("escrow"),
  NEAR_QGOLD_ESCROW_PUBLISHER: top("escrow-pub"),
  NEAR_CREATORS_ACCOUNT: top("creators"),
};
const env = { ...process.env, ...ACCOUNTS, NEAR_NETWORK: "testnet", APP_ORIGIN: ORIGIN };
// --reviewed: the same pinned builds (contracts/wasm-sha256.json) World runs,
// reviewed when they went live; each script still checks the WASM hashes.
const STEPS = [
  { name: "collectibles slice (+ factory, relayer, badges, npc-games)", script: "deploy-mainnet-slice.mjs", args: ["--execute"], record: "output/mainnet-slice-testnet/testnet-deployment.json" },
  { name: "rewards + vault factory", script: "deploy-native-funding-testnet.mjs", record: "public/native-rewards-testnet.json" },
  { name: "QGOLD vault", script: "deploy-qgold-testnet.mjs", args: ["--reviewed"], record: "public/native-qgold-vault-testnet.json" },
  { name: "ledger + soulbound QGOLD", script: "deploy-ledger-testnet.mjs", record: "public/native-ledger-testnet.json" },
  { name: "market", script: "deploy-market-testnet.mjs", record: "public/native-market-testnet.json" },
  { name: "QGOLD escrow", script: "deploy-qgold-escrow-testnet.mjs", args: ["--reviewed"], record: "public/native-qgold-escrow-testnet.json" },
  { name: "creators", script: "deploy-creators-testnet.mjs", record: "public/native-creators-testnet.json" },
];
const SHARED = ["native-intents"]; // records the Test Layer reuses as they are
// Build facts, not contract ids: the slice checks the collectibles build's edition list.
const KEEP = ["native-editions-testnet.json"];

const isLink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const log = (o) => console.log(JSON.stringify(o));
log({ plan: execute ? "execute" : "plan only", tag: TAG, origin: ORIGIN, work, accounts: ACCOUNTS, steps: STEPS.map((s) => s.name), shared: SHARED });
if (!execute) process.exit(0);

// 0. Work tree. Its code is refreshed from this checkout's HEAD on every run
// (git archive over the old tree), so a work tree left by an earlier run or an
// earlier checkout (the release runner keeps .data/ across jobs) never runs
// stale scripts or records. What the deploy wrote stays: work/.data (keys,
// journals) and the Test Layer records the scripts wrote into work/public.
const isRecord = (f) => (/-testnet\.json$/.test(f) || f === "testnet-deployment.json") && !KEEP.includes(f);
const workPublic = resolve(work, "public");
const written0 = {};
if (existsSync(work)) {
  for (const f of existsSync(workPublic) ? readdirSync(workPublic) : [])
    if (isRecord(f)) written0[f] = readFileSync(resolve(workPublic, f));
  // A git worktree from another checkout leaves a .git file pointing nowhere; nothing here needs git.
  const dotGit = resolve(work, ".git");
  if (existsSync(dotGit) || isLink(dotGit)) rmSync(dotGit, { force: true });
} else mkdirSync(work, { recursive: true, mode: 0o700 });
for (const link of ["contracts/target", "node_modules"]) if (isLink(resolve(work, link))) unlinkSync(resolve(work, link));
execFileSync("bash", ["-c", 'git archive --format=tar HEAD | tar -x -C "$1"', "_", work], { cwd: repo, stdio: ["ignore", "inherit", "inherit"] });
for (const f of readdirSync(workPublic)) if (isRecord(f)) rmSync(resolve(workPublic, f));
for (const [f, bytes] of Object.entries(written0)) writeFileSync(resolve(workPublic, f), bytes);
try {
  execFileSync("git", ["worktree", "prune"], { cwd: repo, stdio: "ignore" });
} catch {
  /* not a git checkout with worktrees: nothing to prune */
}
log({ step: "work tree refreshed from HEAD, real testnet records removed", work, keptTestLayerRecords: Object.keys(written0) });
mkdirSync(resolve(work, ".data"), { recursive: true, mode: 0o700 });
const opCopy = resolve(work, ".data/near-operator.json");
if (!existsSync(opCopy)) {
  copyFileSync(operatorPath, opCopy);
  chmodSync(opCopy, 0o600);
}
// The reproducible contract builds of this checkout (contracts/wasm-sha256.json pins them).
// Links are recreated on every run, so they always point at this checkout.
const target = resolve(work, "contracts/target");
if (existsSync(target) && !isLink(target)) rmSync(target, { recursive: true });
symlinkSync(resolve(repo, "contracts/target"), target);
symlinkSync(resolve(repo, "node_modules"), resolve(work, "node_modules"));

// 1. Fund the operator from the faucet accounts (each keeps 0.1 NEAR).
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com" });
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const fundsFile = resolve(repo, "scripts/data/testlayer-funds-testnet.txt");
const fundsJournal = resolve(work, ".data/testlayer-funds.json");
const swept = existsSync(fundsJournal) ? JSON.parse(readFileSync(fundsJournal, "utf8")) : {};
for (const id of readFileSync(fundsFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)) {
  if (swept[id]) continue;
  const acc = await provider.viewAccount({ accountId: id });
  const keep = 10n ** 23n;
  const amount = BigInt(acc.amount) - keep;
  if (amount <= 0n) continue;
  const r = await new Account(id, provider, signer).transfer({ receiverId: op, amount });
  swept[id] = r.transaction?.hash || r.transaction_outcome?.id;
  writeFileSync(fundsJournal, JSON.stringify(swept, null, 2));
  log({ step: "funded operator", from: id, near: Number(amount / 10n ** 21n) / 1000, tx: swept[id] });
}

// The reward worker key file names its contract account. One left by a run
// with other account ids is set aside, so the funding script makes a new one.
const workerFile = resolve(work, ".data/reward-worker.json");
if (existsSync(workerFile)) {
  const bound = JSON.parse(readFileSync(workerFile, "utf8")).accountId;
  if (bound !== ACCOUNTS.NEAR_REWARDS_ACCOUNT) {
    const aside = resolve(work, `.data/reward-worker.unused-${bound}.json`);
    copyFileSync(workerFile, aside);
    chmodSync(aside, 0o600);
    rmSync(workerFile);
    log({ step: "set aside reward worker key of another rewards account", account: bound });
  }
}

// 1b. Top-level accounts come from the operator through the `testnet`
// registrar, not from helper.testnet.near.org: the helper rate-limits the VPS
// IP for hours. An account that exists already is left alone, so the deploy
// scripts find it and skip their own helper call.
const NEAR = 10n ** 24n;
const opAccount = new Account(op, provider, signer);
for (const [key, id] of Object.entries(ACCOUNTS)) {
  if (!id.endsWith(".testnet") || id.endsWith(`.${op}`)) continue;
  try {
    await provider.viewAccount({ accountId: id });
    continue;
  } catch (e) {
    if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(e))) throw e;
  }
  const deposit = key === "NEAR_QGOLD_ESCROW_PUBLISHER" ? NEAR : 5n * NEAR;
  const r = await opAccount.callFunctionRaw({
    contractId: "testnet",
    methodName: "create_account",
    args: { new_account_id: id, new_public_key: operator.publicKey },
    deposit,
    gas: 100n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  if (r.status?.Failure) throw new Error(`create_account ${id} failed: ${JSON.stringify(r.status)}`);
  await provider.viewAccount({ accountId: id }); // throws if the registrar did not create it
  log({ step: "created account from the operator", account: id, near: Number(deposit / NEAR), tx: r.transaction?.hash || r.transaction_outcome?.id });
}

// 2-3. The deploy scripts, in order, inside the work tree.
// A step whose record is in the work tree finished in an earlier run and is
// not run again: the scripts' smoke tests are not repeatable (the escrow smoke
// compares an absolute payout balance). TESTLAYER_RERUN=<script> runs one anyway.
for (const s of STEPS) {
  if (existsSync(resolve(work, s.record)) && process.env.TESTLAYER_RERUN !== s.script) {
    log({ step: s.name, skipped: "done in an earlier run", record: s.record });
    continue;
  }
  log({ step: s.name, script: s.script });
  const patience = pathToFileURL(resolve(work, "scripts/lib/rpc-patience.mjs")).href;
  execFileSync(process.execPath, ["--import", patience, resolve(work, "scripts", s.script), ...(s.args || [])], { cwd: work, env, stdio: "inherit" });
}

// 4. Records into this repository under the Test Layer's names: the
// per-contract scripts write into work/public, the collectibles slice keeps its
// testnet records in work/output/mainnet-slice-testnet (it never replaces the
// live testnet ones). Runs on every execute, also when every step was reused.
const written = [];
const sources = [
  { dir: resolve(work, "public"), skip: KEEP },
  { dir: resolve(work, "output/mainnet-slice-testnet"), skip: [] },
];
for (const { dir, skip } of sources) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(.+)-testnet\.json$/);
    if ((!m && f !== "testnet-deployment.json") || skip.includes(f)) continue;
    const to = f === "testnet-deployment.json" ? "testlayer-deployment.json" : `${m[1]}-testlayer.json`;
    copyFileSync(resolve(dir, f), resolve(repo, "public", to));
    written.push(to);
  }
}
for (const name of SHARED) {
  const from = resolve(repo, `public/${name}-testnet.json`);
  if (existsSync(from)) {
    copyFileSync(from, resolve(repo, `public/${name}-testlayer.json`));
    written.push(`${name}-testlayer.json (shared)`);
  }
}
// Key file names only (never contents), for the key install.
const keyFiles = readdirSync(resolve(work, ".data")).filter((f) => /\.(json|pem)$/.test(f) && !/journal|deploy|funds/.test(f)).sort();
log({ status: "done", written, keys: resolve(work, ".data"), keyFiles, next: "install the keys (scripts/install-testlayer-keys-vps.sh or the runner), then commit public/*-testlayer.json" });
