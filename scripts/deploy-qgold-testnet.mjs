// Deploys the QGOLD vault (contracts/qgold, docs/QGOLD-VAULT.md) on testnet and
// switches coin rewards to it:
//   1. creates the vault account through the official testnet helper,
//   2. deploys and initializes the pinned reproducible WASM (council = operator,
//      threshold 1, guardian = operator, treasury = operator, minter = rewards),
//   3. tops up the operating balance (sponsored holder records) to 1 NEAR,
//   4. DELETES the vault's full-access key: from then on code changes only go
//      through propose -> 48 h timelock -> apply_upgrade, and nobody can move
//      the backing (there is no admin withdraw),
//   5. upgrades the rewards contract in place (state kept; backup of the old
//      WASM in .data/contract-backups/) and sets its QGOLD vault once,
//   6. smoke test from the operator: deposit 0.05 NEAR -> QGOLD, ft_burn 1 QGOLD,
//      redeem 1 QGOLD instantly, audit ok, R not below its start,
//   7. writes public/native-qgold-vault-testnet.json and the new rewards code hash
//      into public/native-rewards-testnet.json.
// Testnet only. Run on the Mac (operator key in .data/near-operator.json):
//   node scripts/deploy-qgold-testnet.mjs --reviewed
// Then commit both manifests and deploy the VPS.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Account, KeyPairSigner, PublicKey, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

assert(process.argv.includes("--reviewed"), "Pass --reviewed after reviewing contracts/qgold and the rewards diff.");
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const root = new Account(operator.accountId, provider, signer);
const vaultId = process.env.NEAR_QGOLD_VAULT_ACCOUNT || "questlayer-qgold-vault-20261104.testnet";
const rewardsManifestPath = "public/native-rewards-testnet.json";
const rewardsManifest = JSON.parse(readFileSync(rewardsManifestPath, "utf8"));
const rewardsId = rewardsManifest.contractId;
assert(vaultId.endsWith(".testnet") && rewardsId.endsWith(".testnet"), "Testnet only");
const INITIAL_RATE = 10n ** 21n; // 0.001 NEAR per QGOLD

const pins = JSON.parse(readFileSync("contracts/wasm-sha256.json")).contracts;
const sha = (b) => createHash("sha256").update(b).digest("hex");
function wasmOf(name) {
  const path = `contracts/target/wasm32-unknown-unknown/release/${name}.wasm`;
  const bytes = readFileSync(path);
  assert.equal(sha(bytes), pins[name], `${path} is not the reproducible build (npm run contracts:docker or the CI artifact)`);
  return { bytes, sha: sha(bytes) };
}
const vaultWasm = wasmOf("questlayer_qgold");
const rewardsWasm = wasmOf("questlayer_rewards");

const journalPath = ".data/qgold-deploy-journal.json";
const transactions = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journalPath, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function view(id, method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
const call = (label, receiverId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  record(label, () => root.signAndSendTransaction({ receiverId, actions: [actions.functionCall(methodName, args, gas, deposit)], waitUntil: "FINAL" }));

async function ensureAccount(accountId) {
  try {
    return await provider.viewAccount({ accountId });
  } catch (e) {
    if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e;
  }
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: operator.publicKey }),
    signal: AbortSignal.timeout(30000),
  });
  assert(r.ok, "Testnet helper could not create " + accountId + ": " + (await r.text()).slice(0, 200));
  console.log(JSON.stringify({ step: "Created account through the testnet helper", accountId }));
  await new Promise((res) => setTimeout(res, 3000));
  return provider.viewAccount({ accountId });
}
const hasState = async (id) =>
  (await provider.query({ request_type: "view_state", account_id: id, prefix_base64: "", finality: "final" })).values?.some((v) => v.key === "U1RBVEU=");

// 1-2. Vault account and code.
await ensureAccount(vaultId);
const vault = new Account(vaultId, provider, signer);
if (!(await hasState(vaultId))) {
  const icon =
    "data:image/svg+xml," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#c08a2b"/><text x="16" y="21" font-family="sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#fff">G</text></svg>');
  await record("Deploy and initialize the QGOLD vault", () =>
    vault.signAndSendTransaction({
      receiverId: vaultId,
      actions: [
        actions.deployContract(vaultWasm.bytes),
        actions.functionCall(
          "new",
          {
            council: [operator.accountId],
            threshold: 1,
            guardian_id: operator.accountId,
            treasury_id: operator.accountId,
            minters: [rewardsId],
            initial_rate: INITIAL_RATE.toString(),
            metadata: { spec: "ft-1.0.0", name: "QuestLayer Gold", symbol: "QGOLD", icon, reference: null, reference_hash: null, decimals: 6 },
          },
          100n * TGAS,
          0n,
        ),
      ],
      waitUntil: "FINAL",
    }),
  );
}
const deployedCode = await provider.query({ request_type: "view_code", account_id: vaultId, finality: "final" });
assert.equal(sha(Buffer.from(deployedCode.code_base64, "base64")), vaultWasm.sha, "Vault code differs from the pinned build; upgrades go through the council timelock.");

// 3. Operating balance for sponsored holder records.
const audit0 = await view(vaultId, "audit");
if (BigInt(audit0.slack) < NEAR) {
  const top = NEAR - BigInt(audit0.slack);
  await record("Top up the vault operating balance", () =>
    root.signAndSendTransaction({ receiverId: vaultId, actions: [actions.transfer(top)], waitUntil: "FINAL" }),
  );
}

// 4. No key may stay on the vault.
const keys = (await provider.query({ request_type: "view_access_key_list", account_id: vaultId, finality: "final" })).keys;
for (const k of keys) {
  await record("Delete vault access key " + k.public_key, () =>
    vault.signAndSendTransaction({ receiverId: vaultId, actions: [actions.deleteKey(PublicKey.from(k.public_key))], waitUntil: "FINAL" }),
  );
}
assert.equal((await provider.query({ request_type: "view_access_key_list", account_id: vaultId, finality: "final" })).keys.length, 0, "The vault must have no access keys");

// 5. Rewards pay into the vault.
const rewardsAccount = new Account(rewardsId, provider, signer);
const rewardsInfo = await provider.viewAccount({ accountId: rewardsId });
const rewardsCode = await provider.query({ request_type: "view_code", account_id: rewardsId, finality: "final" });
if (sha(Buffer.from(rewardsCode.code_base64, "base64")) !== rewardsWasm.sha) {
  assert.equal(rewardsInfo.code_hash, rewardsManifest.codeHash, `${rewardsId}: deployed code differs from the manifest; stop and review.`);
  mkdirSync(".data/contract-backups", { recursive: true, mode: 0o700 });
  writeFileSync(`.data/contract-backups/${rewardsId}-${rewardsInfo.code_hash}.wasm`, Buffer.from(rewardsCode.code_base64, "base64"), { mode: 0o600 });
  const before = await view(rewardsId, "get_treasury");
  await record("Upgrade rewards: claims pay into the QGOLD vault", () =>
    rewardsAccount.signAndSendTransaction({ receiverId: rewardsId, actions: [actions.deployContract(rewardsWasm.bytes)], waitUntil: "FINAL" }),
  );
  assert.deepEqual(await view(rewardsId, "get_treasury"), before, "Upgrade changed the rewards treasury");
}
const rcfg = await view(rewardsId, "get_config");
if (!rcfg.qgold_vault) await call("Set the rewards QGOLD vault (once)", rewardsId, "set_qgold_vault", { account_id: vaultId });
assert.equal((await view(rewardsId, "get_config")).qgold_vault, vaultId);
rewardsManifest.codeHash = (await provider.viewAccount({ accountId: rewardsId })).code_hash;
rewardsManifest.wasmSha256 = rewardsWasm.sha;
rewardsManifest.qgoldVault = vaultId;

// 6. Smoke test.
const s0 = await view(vaultId, "get_state");
const mine = async () => BigInt(await view(vaultId, "ft_balance_of", { account_id: operator.accountId }));
const held0 = await mine();
const quote = await view(vaultId, "quote_deposit", { near: (5n * 10n ** 22n).toString() });
await call("Smoke: deposit 0.05 NEAR for QGOLD", vaultId, "deposit", { min_out: quote.qgold }, 5n * 10n ** 22n + 1_250_000_000_000_000_000_000n);
assert((await mine()) - held0 >= BigInt(quote.qgold), "Deposit minted less than quoted");
await call("Smoke: burn 1 QGOLD (in-game spend)", vaultId, "ft_burn", { amount: "1000000", memo: "smoke spend" }, 1n);
const rq = await view(vaultId, "quote_redeem", { account_id: operator.accountId, amount: "1000000" });
assert.equal(rq.instant, true, "A small redeem must be instant");
await call("Smoke: redeem 1 QGOLD instantly", vaultId, "redeem", { amount: "1000000", path: "near_instant", min_out: rq.amount }, 1n);
const audit = await view(vaultId, "audit");
assert.equal(audit.ok, true, "Vault audit failed: " + JSON.stringify(audit));
const s1 = await view(vaultId, "get_state");
assert(BigInt(s1.rate) >= BigInt(s0.rate), "R fell");

// 7. Manifests.
const info = await provider.viewAccount({ accountId: vaultId });
const manifest = {
  network: "testnet",
  verifiedAt: new Date().toISOString(),
  vaultContract: vaultId,
  tokenContract: vaultId,
  symbol: "QGOLD",
  decimals: 6,
  codeHash: info.code_hash,
  wasmSha256: vaultWasm.sha,
  initialRate: INITIAL_RATE.toString(),
  rewardsContract: rewardsId,
  council: [operator.accountId],
  threshold: 1,
  guardian: operator.accountId,
  treasury: operator.accountId,
  accessKeys: 0,
  methods: {
    state: "get_state",
    audit: "audit",
    deposit: "deposit",
    redeem: "redeem",
    claim: "claim_exit",
    exits: "get_account_exits",
    quoteDeposit: "quote_deposit",
    quoteRedeem: "quote_redeem",
    burn: "ft_burn",
  },
  exitPaths: ["near_instant", "near_queue"],
  smoke: { rate: s1.rate, supply: s1.supply, backing: s1.backing },
  transactions,
};
writeFileSync("public/native-qgold-vault-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(rewardsManifestPath, JSON.stringify(rewardsManifest, null, 2) + "\n");
// The rewards record now matches the reproducible build: drop its old exception.
const pinsFile = JSON.parse(readFileSync("contracts/wasm-sha256.json"));
delete pinsFile.testnetDeploymentsNotFromThisBuild[rewardsManifestPath + ":wasmSha256"];
writeFileSync("contracts/wasm-sha256.json", JSON.stringify(pinsFile, null, 2) + "\n");
console.log(JSON.stringify({ done: true, vaultId, rate: s1.rate, audit }));
