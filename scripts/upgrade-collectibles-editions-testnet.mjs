// Code-only testnet upgrade that makes the catalog v2 Aura editions mintable.
// No state migration: schema stays 3, every token, claim, equipment slot and
// the award signer are compared before and after. Only the project's own
// testnet operator key in .data/near-operator.json signs.
//
// Run on the Mac, one command at a time:
//   bash scripts/build-contracts.sh
//   node scripts/upgrade-collectibles-editions-testnet.mjs            (plan, read-only)
//   node scripts/upgrade-collectibles-editions-testnet.mjs --execute  (deploys)
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import { NATIVE_EDITIONS } from "../server/aura-catalog.mjs";

const execute = process.argv.includes("--execute");
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

const wasm = readFileSync(
    "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm",
  ),
  wasmSha256 = createHash("sha256").update(wasm).digest("hex"),
  reviewed = readFileSync("contracts/collectibles/WASM_SHA256", "utf8").trim();
assert.equal(
  wasmSha256,
  reviewed,
  "Build with `bash scripts/build-contracts.sh` first; the WASM must match contracts/collectibles/WASM_SHA256.",
);

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
        ["polar", "moon", "gold"].map(async (e) => [
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
  await record("deploy catalog v2 collectibles code (no state migration)", () =>
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
assert.deepEqual(await view("supported_editions"), [...NATIVE_EDITIONS]);

const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  contractId,
  schemaVersion: 3,
  codeHash: afterCode.hash,
  wasmSha256,
  supportedEditions: NATIVE_EDITIONS,
  tokensPreserved: Number(before.supply),
  equipmentPreserved: Object.keys(before.equipment).length,
  awardSignerPreserved: before.awardSigner === after.awardSigner,
  transactions,
};
mkdirSync("output/qa/W04-aura-catalog", { recursive: true });
writeFileSync(
  "public/native-editions-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W04-aura-catalog/testnet-upgrade-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify({ status: "verified", contractId, transactions: transactions.length }));
