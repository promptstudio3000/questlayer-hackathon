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
//   0. work tree .data/testlayer/work (git worktree at HEAD) with its own .data/
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

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
const top = (name) => `ql-${TAG}-${name}.testnet`;
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
const STEPS = [
  { name: "collectibles slice (+ factory, relayer, badges, npc-games)", script: "deploy-mainnet-slice.mjs", args: ["--execute"] },
  { name: "rewards + vault factory", script: "deploy-native-funding-testnet.mjs" },
  { name: "QGOLD vault", script: "deploy-qgold-testnet.mjs" },
  { name: "ledger + soulbound QGOLD", script: "deploy-ledger-testnet.mjs" },
  { name: "market", script: "deploy-market-testnet.mjs" },
  { name: "QGOLD escrow", script: "deploy-qgold-escrow-testnet.mjs" },
  { name: "creators", script: "deploy-creators-testnet.mjs" },
];
const SHARED = ["native-intents"]; // records the Test Layer reuses as they are

const log = (o) => console.log(JSON.stringify(o));
log({ plan: execute ? "execute" : "plan only", tag: TAG, origin: ORIGIN, work, accounts: ACCOUNTS, steps: STEPS.map((s) => s.name), shared: SHARED });
if (!execute) process.exit(0);

// 0. Work tree.
if (!existsSync(work)) {
  mkdirSync(resolve(work, ".."), { recursive: true, mode: 0o700 });
  execFileSync("git", ["worktree", "add", "--detach", work, "HEAD"], { cwd: repo, stdio: "inherit" });
  for (const f of readdirSync(resolve(work, "public")))
    if (/-testnet\.json$/.test(f) || f === "testnet-deployment.json") rmSync(resolve(work, "public", f));
  log({ step: "work tree ready, real testnet records removed", work });
}
mkdirSync(resolve(work, ".data"), { recursive: true, mode: 0o700 });
const opCopy = resolve(work, ".data/near-operator.json");
if (!existsSync(opCopy)) {
  copyFileSync(operatorPath, opCopy);
  chmodSync(opCopy, 0o600);
}
// The reproducible contract builds of this checkout (contracts/wasm-sha256.json pins them).
const target = resolve(work, "contracts/target");
if (!existsSync(target)) symlinkSync(resolve(repo, "contracts/target"), target);
if (!existsSync(resolve(work, "node_modules"))) symlinkSync(resolve(repo, "node_modules"), resolve(work, "node_modules"));

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

// 2-3. The deploy scripts, in order, inside the work tree.
for (const s of STEPS) {
  log({ step: s.name, script: s.script });
  execFileSync(process.execPath, [resolve(work, "scripts", s.script), ...(s.args || [])], { cwd: work, env, stdio: "inherit" });
}

// 4. Records into this repository under the Test Layer's names.
const written = [];
for (const f of readdirSync(resolve(work, "public"))) {
  const m = f.match(/^(.+)-testnet\.json$/);
  if (!m && f !== "testnet-deployment.json") continue;
  const to = f === "testnet-deployment.json" ? "testlayer-deployment.json" : `${m[1]}-testlayer.json`;
  copyFileSync(resolve(work, "public", f), resolve(repo, "public", to));
  written.push(to);
}
for (const name of SHARED) {
  const from = resolve(repo, `public/${name}-testnet.json`);
  if (existsSync(from)) {
    copyFileSync(from, resolve(repo, `public/${name}-testlayer.json`));
    written.push(`${name}-testlayer.json (shared)`);
  }
}
log({ status: "done", written, keys: resolve(work, ".data"), next: "bash scripts/install-testlayer-keys-vps.sh, then commit public/*-testlayer.json" });
