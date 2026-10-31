// Project testnet funding only. The sponsor's storage fee never becomes reward income.
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
const config = JSON.parse(readFileSync("public/native-rewards-testnet.json")),
  key = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(key.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: config.contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const chain = await provider.viewAccount({ accountId: config.contractId });
assert.equal(chain.code_hash, config.codeHash);
const cfg = await view("get_config"),
  fee = BigInt(cfg.sponsor_storage_fee);
assert.equal(fee, 5n * 10n ** 21n);
if (existsSync("public/native-storage-proof.json")) {
  const previous = JSON.parse(readFileSync("public/native-storage-proof.json"));
  if (previous.codeHash === config.codeHash) {
    console.log(
      JSON.stringify({
        alreadyVerified: true,
        verifiedAt: previous.verifiedAt,
        noNewTransactions: true,
      }),
    );
    process.exit(0);
  }
}
const operator = new Account(
    key.accountId,
    provider,
    KeyPairSigner.fromSecretKey(key.secretKey),
  ),
  before = await view("get_treasury");
async function fund(id, amount) {
  return operator.signAndSendTransaction({
    receiverId: config.contractId,
    actions: [
      actions.functionCall(
        "fund_rewards",
        { source: "sponsor", receipt_id: id },
        50n * 10n ** 12n,
        amount,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
}
const denied = await fund(
  "storage-rejection-" + config.codeHash.slice(0, 8),
  1n,
);
assert(denied.status.Failure);
assert.deepEqual(await view("get_treasury"), before);
const grant = 2n * 10n ** 18n,
  accepted = await fund(
    "storage-covered-" + config.codeHash.slice(0, 8),
    fee + grant,
  );
assert(!accepted.status.Failure);
const after = await view("get_treasury");
assert.equal(BigInt(after.funded), BigInt(before.funded) + grant);
assert.equal(
  BigInt(after.coins.available),
  BigInt(before.coins.available) + grant / 2n,
);
assert.equal(
  BigInt(after.zones.available),
  BigInt(before.zones.available) + grant / 2n,
);
assert.equal(after.coins.reserved, before.coins.reserved);
assert.equal(after.zones.reserved, before.zones.reserved);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  contractId: config.contractId,
  codeHash: config.codeHash,
  sponsorStorageFee: fee.toString(),
  rewardGrant: grant.toString(),
  attached: (fee + grant).toString(),
  underfundedPublicSponsorRejected: true,
  failedFundingPreservedBalances: true,
  reservedClaimsUnchanged: true,
  surchargeExcludedFromRewardIncome: true,
  allocation: "50/50",
  transactions: [
    {
      label: "Reject sponsor without storage funding",
      transaction: denied.transaction.hash,
      expectedFailure: true,
    },
    {
      label: "Accept separately covered sponsor record",
      transaction: accepted.transaction.hash,
    },
  ],
  treasuryAfter: after,
};
writeFileSync(
  "public/native-storage-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W05-W06-native/storage-live-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    verified: true,
    rejected: denied.transaction.hash,
    accepted: accepted.transaction.hash,
  }),
);
