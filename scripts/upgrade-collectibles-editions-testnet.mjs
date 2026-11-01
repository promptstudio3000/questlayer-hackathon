// Code-only testnet upgrade of the collectibles Aura editions: catalog v2
// (PR #32) and the NPC/monster-only editions (N5), whose CLAIM_ONLY_EDITIONS
// mint only for earned:npc: / earned:monster: claims.
// No state migration: schema stays 3, every token, minted counter, equipment
// slot and the award signer are compared before and after. Only the project's
// own testnet operator key in .data/near-operator.json signs.
//
// Deploy only the reviewed linux/amd64 build: macOS aarch64 builds hash
// differently. Run on the Mac, one command at a time:
//   npm run contracts:docker
//   node scripts/upgrade-collectibles-editions-testnet.mjs            (plan, read-only)
//   node scripts/upgrade-collectibles-editions-testnet.mjs --execute  (deploys)
// `--wasm <path>` deploys a downloaded CI artifact (contract-wasm-linux-amd64)
// instead of contracts/target. On success it rewrites the native-editions and
// native-claims manifests and drops their "deployed before this build" entries
// from contracts/wasm-sha256.json.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { AURA_CATALOG, NATIVE_EDITIONS, awardClaimPrefix } from "../server/aura-catalog.mjs";

const execute = process.argv.includes("--execute"),
  wasmArg = process.argv.indexOf("--wasm"),
  wasmPath =
    wasmArg > 0
      ? process.argv[wasmArg + 1]
      : "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm",
  CLAIM_ONLY = AURA_CATALOG.filter((e) => e.source !== "chest")
    .map((e) => [e.id, awardClaimPrefix(e.id)])
    .sort();
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.ok(operator.accountId.endsWith(".testnet"));
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer),
  contractId = process.env.COLLECTIBLES_ACCOUNT || `nfts.${operator.accountId}`,
  contract = new Account(contractId, provider, signer),
  YOCTO_PER_BYTE = 10n ** 19n,
  NEAR = 10n ** 24n;
assert.ok(
  contractId.endsWith("." + operator.accountId),
  "Only a sub-account of the operator can be upgraded here.",
);

const wasm = readFileSync(wasmPath),
  wasmSha256 = createHash("sha256").update(wasm).digest("hex"),
  reviewed = readFileSync("contracts/collectibles/WASM_SHA256", "utf8").trim(),
  hashes = JSON.parse(readFileSync("contracts/wasm-sha256.json", "utf8")),
  reviewDoc = readFileSync("docs/COLLECTIBLES-REVIEW.md", "utf8").match(/\b[0-9a-f]{64}\b/g) || [];
assert.equal(
  wasmSha256,
  reviewed,
  "Build with `npm run contracts:docker` first (macOS builds hash differently); the WASM must match contracts/collectibles/WASM_SHA256.",
);
assert.equal(wasmSha256, hashes.contracts.questlayer_collectibles, "Not the reproducible linux/amd64 build.");
assert.equal(reviewDoc.at(-1), wasmSha256, "This build has no recorded review in docs/COLLECTIBLES-REVIEW.md yet.");

const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const snapshot = async () => {
  const tokens = await view("nft_tokens", { from_index: "0", limit: 1000 }),
    owners = [...new Set(tokens.map((t) => t.owner_id))];
  return {
    version: await view("get_version"),
    supply: await view("nft_total_supply"),
    tokens,
    awardSigner: await view("get_award_signer"),
    minted: Object.fromEntries(
      await Promise.all(
        NATIVE_EDITIONS.map(async (e) => [
          e,
          await view("edition_minted", { edition: e }),
        ]),
      ),
    ),
    equipment: Object.fromEntries(
      await Promise.all(
        owners.map(async (id) => [
          id,
          await view("get_equipment", { account_id: id }),
        ]),
      ),
    ),
  };
};

const before = await snapshot();
assert.equal(before.version, 3, "Expected the V3 collectibles schema.");
assert.ok(
  BigInt(before.supply) <= 1000n,
  "More than 1,000 tokens: extend the snapshot before upgrading.",
);
const code = await provider.query({
    request_type: "view_code",
    account_id: contractId,
    finality: "final",
  }),
  account = await provider.query({
    request_type: "view_account",
    account_id: contractId,
    finality: "final",
  }),
  oldCode = Buffer.from(code.code_base64, "base64"),
  alreadyDeployed = oldCode.equals(wasm),
  storageAfter =
    BigInt(account.storage_usage) - BigInt(oldCode.length) + BigInt(wasm.length),
  needed = storageAfter * YOCTO_PER_BYTE + NEAR / 10n, // keep 0.1 NEAR headroom
  balance = BigInt(account.amount),
  topUp = needed > balance ? needed - balance : 0n;
let supportedBefore = null;
try {
  supportedBefore = await view("supported_editions");
} catch {
  supportedBefore = null;
}
mkdirSync(".data", { recursive: true });
writeFileSync(
  ".data/collectibles-before-editions.json",
  JSON.stringify(
    { contractId, before, codeHash: code.hash, codeBase64: code.code_base64 },
    null,
    2,
  ),
  { mode: 0o600 },
);
const plan = {
  network: "testnet",
  contractId,
  currentCodeHash: code.hash,
  currentCodeBytes: oldCode.length,
  newCodeBytes: wasm.length,
  wasmSha256,
  alreadyDeployed,
  supportedBefore,
  editionsAfter: NATIVE_EDITIONS,
  claimOnlyEditionsAfter: Object.fromEntries(CLAIM_ONLY),
  wasmPath,
  storageBytesAfter: storageAfter.toString(),
  balanceYocto: balance.toString(),
  topUpYocto: topUp.toString(),
  tokens: before.supply,
  backup: ".data/collectibles-before-editions.json",
};
console.log(JSON.stringify({ plan }, null, 2));
if (!execute) {
  console.log("Read-only plan. Re-run with --execute to deploy.");
  process.exit(0);
}

const transactions = [];
async function record(step, fn) {
  const result = await fn();
  assert.ok(!result.status?.Failure, `${step} failed`);
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  assert.ok(transaction);
  transactions.push({ step, transaction });
  console.log(JSON.stringify({ step, transaction }));
}
if (topUp > 0n)
  await record("top up contract storage for the larger code", () =>
    root.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.transfer(topUp)],
      waitUntil: "FINAL",
    }),
  );
if (!alreadyDeployed)
  await record("deploy NPC/monster editions collectibles code (no state migration)", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.deployContract(wasm)],
      waitUntil: "FINAL",
    }),
  );

const after = await snapshot(),
  afterCode = await provider.query({
    request_type: "view_code",
    account_id: contractId,
    finality: "final",
  });
assert.ok(Buffer.from(afterCode.code_base64, "base64").equals(wasm));
assert.deepEqual(after, before, "State changed during the code upgrade.");
// The contract lists editions in its own order; only the set must match.
assert.deepEqual(
  [...(await view("supported_editions"))].sort(),
  [...NATIVE_EDITIONS].sort(),
);
assert.deepEqual(
  (await view("claim_only_editions")).map(([id, prefix]) => [id, prefix]).sort(),
  CLAIM_ONLY,
);

const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  contractId,
  schemaVersion: 3,
  codeHash: afterCode.hash,
  wasmSha256,
  supportedEditions: NATIVE_EDITIONS,
  claimOnlyEditions: Object.fromEntries(CLAIM_ONLY),
  tokensPreserved: Number(before.supply),
  equipmentPreserved: Object.keys(before.equipment).length,
  awardSignerPreserved: before.awardSigner === after.awardSigner,
  transactions,
};
mkdirSync("output/qa/N5-npc-editions", { recursive: true });
writeFileSync(
  "public/native-editions-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/N5-npc-editions/testnet-upgrade-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
// The claims manifest carries the code fingerprint the server verifies.
const claims = JSON.parse(readFileSync("public/native-claims-testnet.json", "utf8"));
assert.equal(claims.contractId, contractId);
claims.wasmSha256 = wasmSha256;
claims.codeUpgrade =
  "Code-only NPC/monster Aura editions upgrade (N5); award signer, tokens and equipment unchanged. See public/native-editions-testnet.json.";
writeFileSync("public/native-claims-testnet.json", JSON.stringify(claims, null, 2) + "\n");
// Both records now match the reproducible build, so they leave the allowlist.
for (const file of ["native-claims-testnet.json", "native-editions-testnet.json"])
  delete hashes.testnetDeploymentsNotFromThisBuild?.[`public/${file}:wasmSha256`];
writeFileSync("contracts/wasm-sha256.json", JSON.stringify(hashes, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, transactions: transactions.length }));
