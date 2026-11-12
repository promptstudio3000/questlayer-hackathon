import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const marketId =
    process.env.NEAR_MARKET_ACCOUNT || "questlayer-market-20261031.testnet",
  // The Test Layer (scripts/deploy-testlayer.mjs) names its own collectibles.
  nftContractId = process.env.COLLECTIBLES_ACCOUNT || `nfts.${operator.accountId}`;
assert.ok(marketId.endsWith(".testnet"));
let accountInfo;
try {
  accountInfo = await provider.viewAccount({ accountId: marketId });
} catch (error) {
  if (!/does not exist|doesnotexist|unknown_account/i.test(rpcErrorText(error)))
    throw error;
}
if (!accountInfo) {
  const r = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: marketId,
      newAccountPublicKey: operator.publicKey,
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(
    r.ok,
    `Official testnet faucet did not create the market account (${r.status}).`,
  );
  console.log(
    JSON.stringify({
      step: "Create dedicated market account through official testnet helper",
      marketId,
      status: r.status,
    }),
  );
  for (let n = 0; n < 5; n++) {
    try {
      accountInfo = await provider.viewAccount({ accountId: marketId });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  assert.ok(accountInfo);
}
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  market = new Account(marketId, provider, signer),
  wasm = readFileSync(
    "contracts/target/wasm32-unknown-unknown/release/questlayer_market.wasm",
  );
const transactions = [];
const view = async (method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: marketId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
if (accountInfo.code_hash === "11111111111111111111111111111111") {
  const result = await market.signAndSendTransaction({
    receiverId: marketId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall(
        "new",
        { owner_id: operator.accountId, nft_contract_id: nftContractId },
        80n * 10n ** 12n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  assert.ok(!result.status?.Failure);
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  transactions.push({
    label: "Deploy testnet-only bounded NFT escrow market",
    transaction,
  });
  console.log(JSON.stringify({ step: "Deploy native market", transaction }));
} else {
  const code = await provider.query({
    request_type: "view_code",
    account_id: marketId,
    finality: "final",
  });
  assert.ok(
    Buffer.from(code.code_base64, "base64").equals(wasm),
    "Existing market code differs; do not replace it implicitly.",
  );
}
const stats = await view("get_stats");
assert.equal(stats.network, "testnet");
assert.equal(stats.nft_contract, nftContractId);
assert.equal(stats.owner, operator.accountId);
assert.equal(stats.version, 2);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  marketContract: marketId,
  nftContract: nftContractId,
  owner: operator.accountId,
  adminModel:
    "Project-controlled testnet upgrade/account keys; not audited for mainnet",
  storage: "Project-sponsored, bounded testnet storage",
  wasmSha256: createHash("sha256").update(wasm).digest("hex"),
  transactions,
  limits: {
    listings: stats.max_listings,
    participants: stats.max_participants,
    perAccount: stats.max_active_per_account,
  },
};
mkdirSync("output/qa/W07-market", { recursive: true });
writeFileSync(
  "public/native-market-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W07-market/deployment-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    network: "testnet",
    marketContract: marketId,
    version: stats.version,
  }),
);
