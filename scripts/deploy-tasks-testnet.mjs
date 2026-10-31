import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

// Only the dedicated project testnet account. Never replace an existing contract.
const contractId = "questlayer-tasks-20261031.testnet";
const policy = "sponsored-tasks-testnet-v1";
const keyPath = ".data/near-operator.json";
assert.equal(statSync(keyPath).mode & 0o077, 0);
const operator = JSON.parse(readFileSync(keyPath));
assert.equal(operator.network, "testnet");
assert.equal(operator.accountId, "auratrail-dev-20261030.testnet");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const wasm = readFileSync(
  "contracts/target/wasm32-unknown-unknown/release/questlayer_tasks.wasm",
);
const journalPath = ".data/native-tasks-deploy-journal.json";
const transactions = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath))
  : [];
const signer = KeyPairSigner.fromSecretKey(operator.secretKey);
const contract = new Account(contractId, provider, signer);
async function record(label, action) {
  const result = await action();
  assert(
    result.status && "SuccessValue" in result.status,
    `${label} did not confirm`,
  );
  const row = { label, transaction: result.transaction.hash };
  transactions.push(row);
  writeFileSync(journalPath, JSON.stringify(transactions, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(row));
}
async function view(method, args = {}) {
  const result = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(result.result).toString());
}
let info;
try {
  info = await provider.viewAccount({ accountId: contractId });
} catch (error) {
  if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(error)))
    throw error;
}
if (!info) {
  const response = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: contractId,
      newAccountPublicKey: operator.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert(
    response.ok,
    `Project testnet faucet returned ${response.status}; no other account was funded.`,
  );
  info = await provider.viewAccount({ accountId: contractId });
}
if (info.code_hash === "11111111111111111111111111111111") {
  await record("Deploy and initialize dedicated testnet task escrow", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      waitUntil: "FINAL",
      actions: [
        actions.deployContract(wasm),
        actions.functionCall(
          "new",
          { arbiter_id: operator.accountId },
          80n * 10n ** 12n,
          0n,
        ),
      ],
    }),
  );
}
const code = await provider.query({
  request_type: "view_code",
  account_id: contractId,
  finality: "final",
});
assert(
  Buffer.from(code.code_base64, "base64").equals(wasm),
  "Existing escrow differs; never replace it implicitly.",
);
const config = await view("get_config");
assert.equal(config.network, "testnet");
assert.equal(config.policy_version, policy);
assert.equal(config.arbiter_id, operator.accountId);
const keys = await provider.query({
  request_type: "view_access_key_list",
  account_id: contractId,
  finality: "final",
});
if (keys.keys.length) {
  assert.equal(
    keys.keys.length,
    1,
    "Unexpected account access; stop before changing any key.",
  );
  assert.equal(keys.keys[0].public_key, operator.publicKey);
  assert.equal(keys.keys[0].access_key.permission, "FullAccess");
  const publicKey = await signer.getPublicKey();
  await record("Remove deployment key from reviewed task escrow", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      waitUntil: "FINAL",
      actions: [actions.deleteKey(publicKey)],
    }),
  );
}
assert.equal(
  (
    await provider.query({
      request_type: "view_access_key_list",
      account_id: contractId,
      finality: "final",
    })
  ).keys.length,
  0,
);
info = await provider.viewAccount({ accountId: contractId });
const manifest = {
  schema: 1,
  network: "testnet",
  contractId,
  codeHash: info.code_hash,
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  policy,
  arbiterId: operator.accountId,
  keyless: true,
  verifiedAt: new Date().toISOString(),
  config,
  transactions,
  scope:
    "Bounded sponsored testnet tasks; immutable public text evidence; trusted arbitration. No mainnet approval or private-media workflow.",
};
mkdirSync("output/qa/W08-W10-native-tasks", { recursive: true });
for (const path of [
  "public/native-tasks-testnet.json",
  "output/qa/W08-W10-native-tasks/deployment.json",
])
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({ contractId, codeHash: info.code_hash, keyless: true }),
);
