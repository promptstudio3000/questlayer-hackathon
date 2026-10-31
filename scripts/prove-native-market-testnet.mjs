import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPairSigner } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const deployment = JSON.parse(
    readFileSync("public/native-market-testnet.json"),
  ),
  earned = JSON.parse(readFileSync("public/earned-aura-testnet.json"));
assert.equal(deployment.network, "testnet");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  seller = new Account(operator.accountId, provider, signer),
  buyerId = `explorer.${operator.accountId}`,
  buyer = new Account(buyerId, provider, signer),
  marketId = deployment.marketContract,
  nftId = deployment.nftContract,
  tokenId = earned.tokenId,
  price = 10n ** 22n,
  transactions = [];
const view = async (contractId, method, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function call(
  label,
  account,
  contractId,
  methodName,
  args,
  deposit = 0n,
) {
  const result = await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    deposit,
    gas: 220n * 10n ** 12n,
    waitUntil: "FINAL",
  });
  assert.ok(!result.status?.Failure, label + " failed");
  const transaction =
    result.transaction?.hash || result.transaction_outcome?.id;
  transactions.push({ label, transaction });
  console.log(JSON.stringify({ step: label, transaction }));
  return result;
}
const owner = () => view(nftId, "nft_token", { token_id: tokenId }),
  listing = () => view(marketId, "get_listing", { token_id: tokenId });
assert.equal(
  (await owner()).owner_id,
  operator.accountId,
  "Proof starts with an owned earned Aura",
);
await call(
  "List earned Aura into actual NFT escrow",
  seller,
  nftId,
  "nft_transfer_call",
  {
    receiver_id: marketId,
    token_id: tokenId,
    approval_id: null,
    memo: null,
    msg: JSON.stringify({ price: price.toString() }),
  },
  1n,
);
let offer = await listing();
assert.equal(offer.seller, operator.accountId);
assert.equal(offer.state, "active");
assert.equal((await owner()).owner_id, marketId);
const firstListing = offer.id;
await call(
  "Cancel and return escrowed NFT to its owner",
  seller,
  marketId,
  "cancel",
  { token_id: tokenId, listing_id: offer.id },
  1n,
);
assert.equal(await listing(), null);
assert.equal((await owner()).owner_id, operator.accountId);
await call(
  "Relist with a new protected listing identifier",
  seller,
  nftId,
  "nft_transfer_call",
  {
    receiver_id: marketId,
    token_id: tokenId,
    approval_id: null,
    memo: null,
    msg: JSON.stringify({ price: price.toString() }),
  },
  1n,
);
offer = await listing();
assert.notEqual(offer.id, firstListing);
await call(
  "Buyer pays exact test NEAR and receives the NFT",
  buyer,
  marketId,
  "buy",
  { token_id: tokenId, listing_id: offer.id },
  price,
);
assert.equal((await owner()).owner_id, buyerId);
assert.equal(await listing(), null);
const credited = await view(marketId, "get_account", {
  account_id: operator.accountId,
});
assert.equal(credited.credit, price.toString());
await call(
  "Seller withdraws confirmed native sale proceeds",
  seller,
  marketId,
  "withdraw",
  {},
  1n,
);
const paid = await view(marketId, "get_account", {
  account_id: operator.accountId,
});
assert.equal(paid.credit, "0");
assert.equal(paid.withdrawing, "0");
const stats = await view(marketId, "get_stats");
assert.equal(stats.funded, price.toString());
assert.equal(stats.withdrawn, price.toString());
assert.equal(stats.escrow, "0");
assert.equal(stats.credits, "0");
assert.equal(stats.withdrawing, "0");
await call(
  "Buyer creates a visible sample testnet offer",
  buyer,
  nftId,
  "nft_transfer_call",
  {
    receiver_id: marketId,
    token_id: tokenId,
    approval_id: null,
    memo: null,
    msg: JSON.stringify({ price: (2n * price).toString() }),
  },
  1n,
);
const sample = await listing();
assert.equal(sample.seller, buyerId);
assert.equal(sample.state, "active");
assert.equal((await owner()).owner_id, marketId);
await call(
  "Restore seller appearance using their original owned Aura",
  seller,
  nftId,
  "equip_aura",
  { token_id: "aura:polar:1", slot: "above" },
);
const proof = {
  verifiedAt: new Date().toISOString(),
  network: "testnet",
  marketContract: marketId,
  nftContract: nftId,
  tokenId,
  seller: operator.accountId,
  buyer: buyerId,
  participants:
    "Both participants are project-controlled developer testnet accounts",
  price: price.toString(),
  firstListingId: firstListing,
  currentSampleOffer: sample,
  cancellationReturnedNFT: true,
  listingIdentifiersChanged: true,
  buyerOwnershipConfirmed: true,
  sellerCreditConfirmed: true,
  sellerWithdrawalConfirmed: true,
  financialConservation: stats,
  playerPrivateKeysOnServer: false,
  transactions,
};
mkdirSync("output/qa/W07-market", { recursive: true });
writeFileSync(
  "public/native-market-trades-testnet.json",
  JSON.stringify(proof, null, 2) + "\n",
);
writeFileSync(
  "output/qa/W07-market/trade-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    soldForTestNear: "0.01",
    sellerPaid: true,
    currentSampleOffer: sample.id,
    nftInEscrow: true,
  }),
);
