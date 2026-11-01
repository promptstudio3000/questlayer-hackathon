// Upgrade the deployed testnet Aura market from version 1 (fixed-price
// escrow) to version 2 (adds NEP-413 signed orders) and optionally prove the
// signed-order flows with two project-controlled developer accounts.
//
// Runs on the operator's machine only: it reads .data/near-operator.json.
//   bash scripts/build-contracts.sh
//   node scripts/upgrade-market-v2-testnet.mjs            # upgrade + verify
//   node scripts/upgrade-market-v2-testnet.mjs --prove    # upgrade + live proof
//   node scripts/upgrade-market-v2-testnet.mjs --dry-run  # checks only
//
// The deploy and the `migrate` call are one atomic transaction: if migration
// fails, the old code and state remain. Testnet only; mainnet is refused.
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider } from "../server/near-provider.mjs";
import {
  nep413Digest,
  orderMessage,
  orderTerms,
  signedOrder,
  verifySignedOrderLocally,
} from "../server/native/signed-orders.mjs";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run"),
  PROVE = args.has("--prove");
const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const manifestPath = "public/native-market-testnet.json",
  manifest = JSON.parse(readFileSync(manifestPath));
const marketId = process.env.NEAR_MARKET_ACCOUNT || manifest.marketContract,
  nftId = manifest.nftContract;
assert.ok(marketId.endsWith(".testnet") && nftId.endsWith(".testnet"));
const wasm = readFileSync(
  "contracts/target/wasm32-unknown-unknown/release/questlayer_market.wasm",
);
const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  keyPair = KeyPair.fromString(operator.secretKey),
  market = new Account(marketId, provider, signer);
const outDir = "output/qa/W07-signed-orders";
mkdirSync(outDir, { recursive: true });
const transactions = [];
const log = (o) => console.log(JSON.stringify(o));
const view = async (contractId, method, a = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(a)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
async function listings() {
  const out = [];
  for (let from = 0; ; from += 32) {
    const page = await view(marketId, "get_listings", { from_index: from, limit: 32 });
    out.push(...page);
    if (page.length < 32) return out;
  }
}
const txHash = (r) => r.transaction?.hash || r.transaction_outcome?.id;

// ---- 1. Pre-upgrade snapshot ----
const before = await view(marketId, "get_stats");
assert.equal(before.network, "testnet");
assert.equal(before.nft_contract, nftId);
assert.equal(before.owner, operator.accountId);
const beforeListings = await listings();
writeFileSync(
  `${outDir}/pre-upgrade-snapshot.json`,
  JSON.stringify({ takenAt: new Date().toISOString(), marketId, stats: before, listings: beforeListings }, null, 2) + "\n",
);
log({ step: "Snapshot", version: before.version, listings: beforeListings.length, wasmSha256 });

if (before.version === 1) {
  const busy = beforeListings.filter((l) => l.state !== "active");
  assert.equal(busy.length, 0, `Wait for in-flight trades to settle: ${JSON.stringify(busy)}`);
  assert.equal(before.escrow, "0", "Pending purchase escrow must be zero before upgrading");
  assert.equal(before.withdrawing, "0", "Pending withdrawals must settle before upgrading");
  if (DRY) {
    log({ step: "Dry run: ready to upgrade", marketId });
    process.exit(0);
  }
  // ---- 2. Atomic deploy + migrate ----
  const result = await market.signAndSendTransaction({
    receiverId: marketId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall("migrate", {}, 100n * 10n ** 12n, 0n),
    ],
    waitUntil: "FINAL",
  });
  assert.ok(!result.status?.Failure, JSON.stringify(result.status?.Failure));
  transactions.push({ label: "Upgrade market to version 2 (deploy + migrate, atomic)", transaction: txHash(result) });
  log({ step: "Upgraded", transaction: txHash(result) });
} else {
  assert.equal(before.version, 2, "Unknown market version");
  const code = await provider.query({ request_type: "view_code", account_id: marketId, finality: "final" });
  assert.ok(
    Buffer.from(code.code_base64, "base64").equals(wasm),
    "Market is version 2 but runs different code; rebuild from this commit.",
  );
  log({ step: "Already version 2 with this exact code" });
}

// ---- 3. Verify state survived ----
const after = await view(marketId, "get_stats");
assert.equal(after.version, 2);
for (const k of ["funded", "escrow", "credits", "withdrawing", "withdrawn", "listing_count", "participant_count", "owner", "nft_contract", "paused"])
  if (before.version === 1) assert.deepEqual(after[k], before[k], `${k} changed during migration`);
if (before.version === 1)
  assert.deepEqual(await listings(), beforeListings, "Listings changed during migration");

// ---- 4. Optional live proof with two developer accounts ----
let proof = null;
if (PROVE) proof = await proveSignedOrders();

const deployment = {
  ...manifest,
  verifiedAt: new Date().toISOString(),
  version: 2,
  wasmSha256,
  signedOrders: {
    standard: after.signed_orders.standard,
    signature: after.signed_orders.signature,
    intents: "NEP-413 envelope compatible; not executed by any NEAR Intents verifier (see docs/SIGNED-AURA-ORDERS.md)",
  },
  transactions: [...(manifest.transactions || []), ...transactions.filter((t) => t.label.startsWith("Upgrade"))],
};
writeFileSync(manifestPath, JSON.stringify(deployment, null, 2) + "\n");
writeFileSync(`${outDir}/upgrade-proof.json`, JSON.stringify({ before, after, deployment }, null, 2) + "\n");
if (proof) {
  writeFileSync("public/native-signed-orders-testnet.json", JSON.stringify(proof, null, 2) + "\n");
  writeFileSync(`${outDir}/signed-order-proof.json`, JSON.stringify(proof, null, 2) + "\n");
}
log({ done: true, marketId, version: after.version, proved: Boolean(proof) });

async function proveSignedOrders() {
  const operatorId = operator.accountId,
    explorerId = `explorer.${operatorId}`,
    accounts = {
      [operatorId]: new Account(operatorId, provider, signer),
      [explorerId]: new Account(explorerId, provider, signer),
    };
  const call = async (label, who, contractId, methodName, a, deposit = 0n, expectFailure = false) => {
    let r;
    try {
      r = await accounts[who].callFunctionRaw({
        contractId, methodName, args: a, deposit, gas: 200n * 10n ** 12n, waitUntil: "FINAL",
      });
    } catch (error) {
      if (!expectFailure) throw error;
      transactions.push({ label, rejectedAsExpected: true, error: String(error.message || error).slice(0, 200) });
      log({ step: label, rejected: true });
      return null;
    }
    const failed = Boolean(r.status?.Failure) || (r.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);
    assert.equal(failed, expectFailure, `${label}: ${expectFailure ? "expected rejection" : "failed"}`);
    transactions.push({ label, transaction: txHash(r), rejectedAsExpected: expectFailure || undefined });
    log({ step: label, transaction: txHash(r) });
    return r;
  };
  const owner = async (t) => (await view(nftId, "nft_token", { token_id: t }))?.owner_id;
  // Find an Aura owned by one developer account; the other is the counterparty.
  let seller, token;
  for (const id of [operatorId, explorerId]) {
    const owned = await view(nftId, "nft_tokens_for_owner", { account_id: id, from_index: "0", limit: 50 });
    const aura = owned.find((t) => t.token_id.startsWith("aura:"));
    if (aura) { seller = id; token = aura.token_id; break; }
  }
  assert.ok(seller, "Neither developer account owns an Aura to trade");
  const buyer = seller === operatorId ? explorerId : operatorId;
  const price = 10n ** 22n; // 0.01 test NEAR
  const publicKey = keyPair.getPublicKey().toString();
  for (const id of [seller, buyer]) {
    const s = await view(marketId, "get_signer", { account_id: id });
    if (!s.keys.includes(publicKey))
      await call(`Register NEP-413 signing key for ${id}`, id, marketId, "add_signing_key", { public_key: publicKey }, 1n);
  }
  const sign = async (kind, maker, tokenId, p, ttlMs = 15 * 60_000) => {
    const { epoch } = await view(marketId, "get_signer", { account_id: maker });
    const message = orderMessage(orderTerms({ kind, market: marketId, nftContract: nftId, maker, tokenId, price: p, deadlineMs: Date.now() + ttlMs, epoch }));
    const nonce = randomBytes(32);
    // Developer CLI stand-in for a wallet's signMessage; same NEP-413 digest.
    const { signature } = keyPair.sign(nep413Digest({ message, nonce, recipient: marketId }));
    const order = signedOrder({ message, nonce, recipient: marketId, publicKey, signature });
    verifySignedOrderLocally(order, { market: marketId, nftContract: nftId });
    return order;
  };
  const deposit = (who, t) =>
    call(`Escrow ${t} for signed orders`, who, nftId, "nft_transfer_call",
      { receiver_id: marketId, token_id: t, approval_id: null, memo: null, msg: JSON.stringify({ deposit: true }) }, 1n);

  // A. Signed sell order filled at the exact price.
  await deposit(seller, token);
  assert.equal(await owner(token), marketId);
  const sell = await sign("sell", seller, token, price);
  assert.equal((await view(marketId, "check_order", { order: sell })).fillable, true);
  await call("Buyer fills signed sell order with the exact price", buyer, marketId, "fill_sell_order", { order: sell }, price);
  assert.equal(await owner(token), buyer);
  // B. Replay of the filled order is rejected on chain.
  await call("Replay of the filled order is rejected", buyer, marketId, "fill_sell_order", { order: sell }, price, true);
  // C. Cancellation: new owner escrows, signs, cancels; the fill is rejected.
  await deposit(buyer, token);
  const cancelled = await sign("sell", buyer, token, 2n * price);
  await call("Maker cancels a signed order on chain", buyer, marketId, "cancel_order", { order: cancelled }, 1n);
  assert.equal((await view(marketId, "check_order", { order: cancelled })).reason, "Order nonce already used");
  await call("Fill of the cancelled order is rejected", seller, marketId, "fill_sell_order", { order: cancelled }, 2n * price, true);
  // D. Signed buy offer from deposited credit, accepted by the escrowed owner.
  await call("Original seller deposits NEAR for an offer", seller, marketId, "deposit_near", {}, price);
  const offer = await sign("buy", seller, token, price);
  await call("Escrowed owner accepts the signed buy offer", buyer, marketId, "fill_buy_order", { order: offer }, 1n);
  assert.equal(await owner(token), seller);
  // E. Both parties withdraw proceeds.
  for (const id of [seller, buyer]) {
    const a = await view(marketId, "get_account", { account_id: id });
    if (a.credit !== "0") await call(`Withdraw market credit for ${id}`, id, marketId, "withdraw", {}, 1n);
  }
  const stats = await view(marketId, "get_stats");
  assert.equal(stats.escrow, "0");
  assert.equal(stats.withdrawing, "0");
  return {
    verifiedAt: new Date().toISOString(),
    network: "testnet",
    marketContract: marketId,
    nftContract: nftId,
    tokenId: token,
    seller,
    buyer,
    participants: "Both are project-controlled developer testnet accounts sharing the operator key",
    signerKind: "developer CLI NEP-413 signer (not a browser wallet signMessage)",
    price: price.toString(),
    sellOrderFilled: true,
    replayRejected: true,
    cancelledOrderRejected: true,
    buyOfferFilled: true,
    proceedsWithdrawn: true,
    intents: "Not executed by a NEAR Intents verifier",
    financialConservation: stats,
    transactions,
  };
}
