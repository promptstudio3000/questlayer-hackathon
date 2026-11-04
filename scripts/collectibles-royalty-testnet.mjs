// NEP-199 royalty on Aura resales (testnet), Mac side. docs/ONCHAIN-TRADES.md,
// "Aura resales on other marketplaces".
//
// Marketplaces that sell an Aura through nft_transfer_payout (Mintbase's
// interop market) pay 2 % of the sale to a dedicated royalties account, the
// same rate as the P2P fee on the NEAR Intents verifier. This script creates
// that account, turns the royalty on, sweeps what arrived into the global
// prize pool, and can prove one real Mintbase sale on testnet:
//
//   node scripts/collectibles-royalty-testnet.mjs                         # status, sends nothing
//   node scripts/collectibles-royalty-testnet.mjs set [--execute]         # royalties account + set_royalty(2 %)
//   node scripts/collectibles-royalty-testnet.mjs sweep [--dry-run]       # royalties account -> fund_rewards
//   node scripts/collectibles-royalty-testnet.mjs mintbase-proof [--execute]
//   node scripts/collectibles-royalty-testnet.mjs off --execute           # set_royalty(None)
//
// Run it after scripts/upgrade-collectibles-editions-testnet.mjs --execute has
// deployed the royalty build. The royalties account only ever receives
// royalties, so everything above its gas reserve is royalty. Each sweep uses
// the receipt id aura-royalties-<date>, so a rerun cannot fund twice. The
// public record (no keys) is public/native-royalties-testnet.json.
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";
import { fundingAttachment, fundingAlreadyRecorded } from "../server/native/stnear-treasury.mjs";

const [command = "status", ...rest] = process.argv.slice(2);
const execute = rest.includes("--execute"),
  dryRun = rest.includes("--dry-run");
const TGAS = 10n ** 12n,
  NEAR = 10n ** 24n,
  YOCTO_PER_BYTE = 10n ** 19n,
  ROYALTY_BPS = 200, // 2 %
  ACCOUNT_FUND = NEAR / 20n, // 0.05 NEAR: storage + gas for sweeps
  RESERVE = NEAR / 20n, // never swept
  MIN_SWEEP = 10n ** 22n, // 0.01 NEAR; each sweep pays a 0.005 NEAR receipt fee
  PROOF_PRICE = NEAR / 10n, // 0.1 test NEAR
  MINTBASE_MARKET = process.env.MINTBASE_MARKET || "market-v2-beta.mintspace2.testnet";
const near = (y) => (Number(BigInt(y)) / 1e24).toFixed(6);
const log = (o) => console.log(JSON.stringify(o));

const operatorPath = process.env.NEAR_OPERATOR_KEY_PATH || ".data/near-operator.json";
const operator = JSON.parse(readFileSync(operatorPath, "utf8"));
assert.equal(operator.network, "testnet", "Testnet only.");
assert.equal(statSync(operatorPath).mode & 0o077, 0, "Operator key file must be private (chmod 600).");
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet", "Testnet RPC only.");

const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  operatorPublicKey = KeyPair.fromString(operator.secretKey).getPublicKey().toString(),
  root = new Account(operator.accountId, provider, signer),
  contractId = JSON.parse(readFileSync("public/native-claims-testnet.json", "utf8")).contractId,
  rewardsId = process.env.NEAR_REWARDS_ACCOUNT || JSON.parse(readFileSync("public/native-rewards-testnet.json", "utf8")).contractId,
  royaltiesId = `royalties.${operator.accountId}`,
  buyerId = `mb-buyer.${operator.accountId}`;
assert.ok(contractId.endsWith("." + operator.accountId), "The collectibles contract must belong to the operator.");
assert.ok(rewardsId.endsWith(".testnet") && MINTBASE_MARKET.endsWith(".testnet"));

const view = async (account_id, method_name, args = {}) => {
  const r = await provider.query({
    request_type: "call_function",
    account_id,
    method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  return JSON.parse(Buffer.from(r.result).toString());
};
const accountOf = async (account_id) => {
  try {
    return await provider.query({ request_type: "view_account", account_id, finality: "final" });
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(rpcErrorText(e))) return null;
    throw e;
  }
};
const txOf = (r) => r.transaction?.hash || r.transaction_outcome?.id;
const failed = (r) => Boolean(r?.status?.Failure) || (r?.receipts_outcome || []).some((o) => o.outcome?.status?.Failure);

const recordPath = "public/native-royalties-testnet.json";
const record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : { network: "testnet", contract: contractId, royalty: null, rewardsContract: rewardsId, receiptPrefix: "aura-royalties-", transactions: [], sweeps: [], mintbaseProof: null };
assert.equal(record.contract, contractId, "The record belongs to another collectibles contract.");
const save = () => {
  record.updatedAt = new Date().toISOString();
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
};
async function send(label, from, receiverId, methodName, args, deposit, gas = 100n * TGAS) {
  const r = await from.signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(methodName, args, gas, deposit)],
    waitUntil: "FINAL",
  });
  assert.ok(!failed(r), `${label} failed: ${JSON.stringify(r.status)}`);
  log({ step: label, transaction: txOf(r) });
  return txOf(r);
}

let royalty;
try {
  royalty = await view(contractId, "get_royalty");
} catch (e) {
  if (!/MethodNotFound|method is not found/i.test(String(e?.message || e))) throw e;
  log({ contractId, royalty: "not supported", next: "Deploy the royalty build first: node scripts/upgrade-collectibles-editions-testnet.mjs --execute" });
  process.exit(command === "status" ? 0 : 1);
}
const payee = await accountOf(royaltiesId);
const sweepable = payee
  ? (() => {
      const free = BigInt(payee.amount) - BigInt(payee.storage_usage) * YOCTO_PER_BYTE - RESERVE;
      return free > 0n ? free : 0n;
    })()
  : 0n;
log({
  contractId,
  royalty,
  royaltiesAccount: royaltiesId,
  royaltiesBalance: payee ? near(payee.amount) : null,
  sweepable: near(sweepable),
  rewardsContract: rewardsId,
  mintbaseMarket: MINTBASE_MARKET,
});
if (command === "status") process.exit(0);

if (command === "set" || command === "off") {
  const target = command === "off" ? null : { account_id: royaltiesId, bps: ROYALTY_BPS };
  const plan = { createRoyaltiesAccount: command === "set" && !payee, setRoyalty: target, alreadySet: JSON.stringify(royalty) === JSON.stringify(target) };
  log({ plan, execute });
  if (!execute) {
    log({ note: "Dry run. Re-run with --execute." });
    process.exit(0);
  }
  if (plan.createRoyaltiesAccount) {
    const r = await root.createAccount({ newAccountId: royaltiesId, publicKey: operatorPublicKey, nearToTransfer: ACCOUNT_FUND });
    record.transactions.push({ label: `Create ${royaltiesId} (royalty payee)`, transaction: txOf(r) });
    save();
    log({ step: "Royalties account created", transaction: txOf(r) });
  }
  if (!plan.alreadySet) {
    const tx = await send(target ? `Royalty on: ${ROYALTY_BPS / 100} % to ${royaltiesId}` : "Royalty off", root, contractId, "set_royalty", { royalty: target }, 1n, 30n * TGAS);
    record.transactions.push({ label: target ? `set_royalty ${ROYALTY_BPS} bps to ${royaltiesId}` : "set_royalty off", transaction: tx });
  }
  record.royalty = await view(contractId, "get_royalty");
  assert.deepEqual(record.royalty, target);
  save();
  log({ step: "Royalty", royalty: record.royalty, next: `commit ${recordPath} and deploy the VPS` });
  process.exit(0);
}

if (command === "sweep") {
  assert.ok(payee, "No royalties account yet: run set --execute first.");
  const date = new Date().toISOString().slice(0, 10);
  const receiptId = `aura-royalties-${date}`;
  let entry = record.sweeps.find((s) => s.receiptId === receiptId);
  if (entry?.fundTransaction) {
    log({ step: "Already swept today", receiptId });
    process.exit(0);
  }
  if (!entry) {
    if (sweepable < MIN_SWEEP) {
      log({ step: "Nothing to sweep", sweepable: near(sweepable), minimum: near(MIN_SWEEP) });
      process.exit(0);
    }
    // The receipt fee is paid on top, from the same account.
    const amount = sweepable - fundingAttachment(0n);
    entry = { receiptId, amount: amount.toString(), startedAt: new Date().toISOString() };
    if (dryRun) {
      log({ dryRun: true, wouldSweep: near(amount), receiptId, rewardsContract: rewardsId });
      process.exit(0);
    }
    record.sweeps.push(entry);
    save();
  }
  const amount = BigInt(entry.amount);
  const payer = new Account(royaltiesId, provider, signer);
  let tx = null,
    already = false;
  try {
    const r = await payer.signAndSendTransaction({
      receiverId: rewardsId,
      actions: [actions.functionCall("fund_rewards", { source: "sponsor", receipt_id: receiptId }, 50n * TGAS, fundingAttachment(amount))],
      waitUntil: "FINAL",
    });
    if (failed(r)) {
      assert.ok(fundingAlreadyRecorded(r.status), "fund_rewards failed: " + JSON.stringify(r.status));
      already = true;
    } else tx = txOf(r);
  } catch (error) {
    if (!fundingAlreadyRecorded(error)) throw error;
    already = true;
  }
  entry.fundTransaction = already ? "already-funded" : tx;
  entry.rewardsContract = rewardsId;
  entry.finishedAt = new Date().toISOString();
  save();
  log({ step: "Royalties in the prize pool", amount: near(amount), receiptId, transaction: entry.fundTransaction });
  process.exit(0);
}

if (command === "mintbase-proof") {
  // One real resale on Mintbase's testnet interop market: the operator lists a
  // fresh Aura for 0.1 test NEAR, a throwaway buyer account buys it, and the
  // royalties account must receive exactly what nft_payout promised.
  assert.deepEqual(royalty, { account_id: royaltiesId, bps: ROYALTY_BPS }, "Turn the royalty on first: set --execute.");
  const [lockSeconds, fallbackCut, listingDeposit] = await Promise.all([
    view(MINTBASE_MARKET, "get_listing_lock_seconds"),
    view(MINTBASE_MARKET, "get_fallback_cut"),
    view(MINTBASE_MARKET, "get_listing_storage_deposit"),
  ]);
  const banned = await view(MINTBASE_MARKET, "banned_accounts");
  assert.ok(!banned.includes(contractId), "Mintbase's market has banned this contract.");
  // Mintbase keeps its cut first and asks the contract to split the rest.
  const netToContract = (PROOF_PRICE * BigInt(10_000 - fallbackCut)) / 10_000n;
  const expectedRoyalty = (netToContract / 10_000n) * BigInt(ROYALTY_BPS) + ((netToContract % 10_000n) * BigInt(ROYALTY_BPS)) / 10_000n;
  const plan = {
    market: MINTBASE_MARKET,
    seller: operator.accountId,
    buyer: buyerId,
    price: near(PROOF_PRICE),
    mintbaseCutBps: fallbackCut,
    listingLockSeconds: lockSeconds,
    listingStorageDeposit: near(listingDeposit),
    expectedRoyalty: near(expectedRoyalty),
    cost: "about 0.33 test NEAR (Aura mint storage, listing deposit, buyer account and price; the price returns to the operator)",
  };
  log({ plan, execute });
  if (!execute) {
    log({ note: "Dry run. Re-run with --execute." });
    process.exit(0);
  }
  const transactions = [];
  const step = async (label, from, receiverId, method, args, deposit, gas) => {
    transactions.push({ label, transaction: await send(label, from, receiverId, method, args, deposit, gas) });
  };
  // A fresh common Aura for the operator (oracle), so no player's Aura moves.
  const before = new Set((await view(contractId, "nft_tokens_for_owner", { account_id: operator.accountId, from_index: "0", limit: 1000 })).map((t) => t.token_id));
  const metadata = {
    title: "Northern Lights",
    description: "QuestLayer cosmetic. Testnet royalty proof on Mintbase.",
    copies: 256,
    extra: JSON.stringify({ slot: "above", rarity: "rare", origin: "questlayer-original" }),
    media: null,
    media_hash: null,
    reference: null,
    reference_hash: null,
  };
  await step("Mint a proof Aura to the operator", root, contractId, "mint_aura", { edition: "polar", receiver_id: operator.accountId, metadata }, NEAR / 10n, 150n * TGAS);
  const tokenId = (await view(contractId, "nft_tokens_for_owner", { account_id: operator.accountId, from_index: "0", limit: 1000 }))
    .map((t) => t.token_id)
    .find((id) => !before.has(id));
  assert.ok(tokenId, "The proof Aura did not arrive.");
  const preview = await view(contractId, "nft_payout", { token_id: tokenId, balance: netToContract.toString(), max_len_payout: 50 });
  assert.equal(preview.payout[royaltiesId], expectedRoyalty.toString(), "nft_payout disagrees with the expected royalty.");
  await step("Pay Mintbase listing storage", root, MINTBASE_MARKET, "deposit_storage", {}, BigInt(listingDeposit), 30n * TGAS);
  await step(
    `List ${tokenId} on Mintbase for ${near(PROOF_PRICE)} NEAR`,
    root,
    contractId,
    "nft_approve",
    { token_id: tokenId, account_id: MINTBASE_MARKET, msg: JSON.stringify({ price: PROOF_PRICE.toString(), ft_contract: null }) },
    10n ** 22n,
    150n * TGAS,
  );
  if (!(await accountOf(buyerId))) {
    const r = await root.createAccount({ newAccountId: buyerId, publicKey: operatorPublicKey, nearToTransfer: PROOF_PRICE + NEAR / 20n });
    transactions.push({ label: `Create ${buyerId}`, transaction: txOf(r) });
  }
  const royaltiesBefore = BigInt((await accountOf(royaltiesId)).amount);
  const buyer = new Account(buyerId, provider, signer);
  await step(`Buy ${tokenId} on Mintbase`, buyer, MINTBASE_MARKET, "buy", { nft_contract_id: contractId, token_id: tokenId, referrer_id: null, affiliate_id: null }, PROOF_PRICE, 300n * TGAS);
  const owner = (await view(contractId, "nft_token", { token_id: tokenId }))?.owner_id;
  const received = BigInt((await accountOf(royaltiesId)).amount) - royaltiesBefore;
  assert.equal(owner, buyerId, "The Aura did not reach the buyer: check the buy transaction.");
  assert.equal(received, expectedRoyalty, `The royalties account received ${near(received)}, expected ${near(expectedRoyalty)}.`);
  record.mintbaseProof = {
    verifiedAt: new Date().toISOString(),
    market: MINTBASE_MARKET,
    tokenId,
    price: PROOF_PRICE.toString(),
    mintbaseCutBps: fallbackCut,
    royaltyBps: ROYALTY_BPS,
    royaltyReceived: received.toString(),
    seller: operator.accountId,
    buyer: buyerId,
    transactions,
  };
  save();
  log({ step: "Mintbase resale paid the royalty", tokenId, royalty: near(received), next: `commit ${recordPath}` });
  process.exit(0);
}

throw new Error(`Unknown command ${command}. Use status, set, sweep, mintbase-proof or off.`);
