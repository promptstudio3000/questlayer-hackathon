// Only this project's owned testnet operator signs. No player wallet key is read.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer),
  contractId = `nfts.${operator.accountId}`,
  contract = new Account(contractId, provider, signer);
const base =
  process.env.CLAIM_API_URL || "https://questlayer.promptstudio3000.com";
assert.ok(
  ["questlayer.promptstudio3000.com", "127.0.0.1", "localhost"].includes(
    new URL(base).hostname,
  ),
);
const info = await (await fetch(base + "/api/native/claim-signer")).json();
assert.equal(info.network, "testnet");
assert.equal(info.contractId, contractId);
assert.equal(Buffer.from(info.publicKey, "base64").length, 32);
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
const before = {
  version: await view("get_version"),
  tokens: await view("nft_tokens", { from_index: "0", limit: 1000 }),
  supply: await view("nft_total_supply"),
  equipment: await view("get_equipment", { account_id: operator.accountId }),
  code: await provider.query({
    request_type: "view_code",
    account_id: contractId,
    finality: "final",
  }),
  state: await provider.query({
    request_type: "view_state",
    account_id: contractId,
    prefix_base64: "",
    finality: "final",
  }),
};
writeFileSync(
  ".data/collectibles-before-v3.json",
  JSON.stringify(before, null, 2),
  { mode: 0o600 },
);
const wasm = readFileSync(
    "contracts/target/wasm32-unknown-unknown/release/questlayer_collectibles.wasm",
  ),
  transactions = [];
async function record(step, fn) {
  const result = await fn();
  assert.ok(!result.status?.Failure);
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  assert.ok(transaction);
  transactions.push({ step, transaction });
  console.log(JSON.stringify({ step, transaction }));
}
if (before.version === 2)
  await record("Atomic V2 to V3 state-preserving migration", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall("migrate_v3", {}, 150n * 10n ** 12n, 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
else {
  assert.equal(before.version, 3);
  assert.ok(
    Buffer.from(before.code.code_base64, "base64").equals(wasm),
    "Existing V3 code differs; review the upgrade explicitly.",
  );
}
assert.equal(await view("get_version"), 3);
assert.equal(await view("nft_total_supply"), before.supply);
assert.deepEqual(
  await view("nft_tokens", { from_index: "0", limit: 1000 }),
  before.tokens,
);
assert.deepEqual(
  await view("get_equipment", { account_id: operator.accountId }),
  before.equipment,
);
if ((await view("get_award_signer")) !== info.publicKey)
  await record(
    "Configure application attestation public key, not a wallet access key",
    () =>
      root.callFunctionRaw({
        contractId,
        methodName: "set_award_signer",
        args: { public_key: info.publicKey },
        deposit: 1n,
        gas: 40n * 10n ** 12n,
        waitUntil: "FINAL",
      }),
  );
assert.equal(await view("get_award_signer"), info.publicKey);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  contractId,
  version: 3,
  application: base,
  attestationPublicKey: info.publicKey,
  existingTokensPreserved: true,
  existingEquipmentPreserved: true,
  supplyBefore: before.supply,
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  transactions,
};
mkdirSync("output/qa/W06-claims", { recursive: true });
writeFileSync(
  "public/native-claims-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W06-claims/upgrade-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    version: 3,
    preservedTokens: before.supply,
    configured: true,
  }),
);
