// Deploys the creator money contract on testnet, installs a bounded publisher
// key for the game server, funds the creator fund and proves every money path
// once (paid access 80/20, donation, support round, withdrawal). Testnet only.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { createNearProvider, rpcErrorText } from "../server/near-provider.mjs";

const operator = JSON.parse(readFileSync(".data/near-operator.json"));
assert.equal(operator.network, "testnet");
assert.equal(statSync(".data/near-operator.json").mode & 0o077, 0);
const provider = createNearProvider();
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const signer = KeyPairSigner.fromSecretKey(operator.secretKey),
  root = new Account(operator.accountId, provider, signer);
const contractId = process.env.NEAR_CREATORS_ACCOUNT || "questlayer-creators-20261101.testnet",
  rewardsId = JSON.parse(readFileSync("public/native-rewards-testnet.json")).contractId,
  buyer = `explorer.${operator.accountId}`,
  NEAR = 10n ** 24n;
const policy = {
  version: "creator-money-v1",
  like_weight: 1,
  completion_weight: 3,
  max_score_per_creator: 30,
  max_round_budget: (5n * NEAR).toString(),
};
const publisherPath = ".data/creators-publisher.json";
if (!existsSync(publisherPath)) {
  const pair = KeyPair.fromRandom("ed25519");
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(publisherPath, JSON.stringify({ network: "testnet", accountId: contractId, secretKey: pair.toString(), publicKey: pair.getPublicKey().toString() }), { mode: 0o600, flag: "wx" });
}
const publisher = JSON.parse(readFileSync(publisherPath));
const journal = ".data/creators-deploy-journal.json",
  transactions = existsSync(journal) ? JSON.parse(readFileSync(journal)) : [];
async function record(label, fn) {
  const r = await fn();
  assert(!r.status?.Failure, label + " failed: " + JSON.stringify(r.status));
  const tx = r.transaction?.hash || r.transaction_outcome?.id;
  transactions.push({ label, transaction: tx });
  writeFileSync(journal, JSON.stringify(transactions, null, 2));
  console.log(JSON.stringify({ label, transaction: tx }));
  return r;
}
async function view(account, method, args = {}) {
  const r = await provider.query({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"), finality: "final" });
  return JSON.parse(Buffer.from(r.result).toString());
}
const call = (account, contract, methodName, args, deposit = 0n, gas = 100n * 10n ** 12n) =>
  account.callFunctionRaw({ contractId: contract, methodName, args, deposit, gas, waitUntil: "FINAL" });

let info;
try { info = await provider.viewAccount({ accountId: contractId }); } catch (e) { if (!/does not exist|unknown_account/i.test(rpcErrorText(e))) throw e; }
if (!info) {
  const r = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: contractId, newAccountPublicKey: operator.publicKey }), signal: AbortSignal.timeout(30000) });
  assert(r.ok, "Testnet helper could not create " + contractId + ": " + (await r.text()).slice(0, 200));
  console.log(JSON.stringify({ step: "Create contract account through the official testnet helper", contractId }));
  await new Promise((resolve) => setTimeout(resolve, 3000));
  info = await provider.viewAccount({ accountId: contractId });
}
const contract = new Account(contractId, provider, signer);
const wasm = readFileSync("contracts/target/wasm32-unknown-unknown/release/questlayer_creators.wasm");
const state = await provider.query({ request_type: "view_state", account_id: contractId, prefix_base64: "", finality: "final" });
if (!state.values?.some((v) => v.key === "U1RBVEU=")) {
  await record("Deploy and initialize " + contractId, () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall("new", { owner_id: operator.accountId, publisher_id: contractId, treasury_receiver: rewardsId, policy }, 100n * 10n ** 12n, 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
} else {
  const code = await provider.query({ request_type: "view_code", account_id: contractId, finality: "final" });
  assert(Buffer.from(code.code_base64, "base64").equals(wasm), "Deployed source differs; refusing an implicit upgrade.");
}
const keys = await provider.query({ request_type: "view_access_key_list", account_id: contractId, finality: "final" });
if (!keys.keys.some((k) => k.public_key === publisher.publicKey))
  await record("Install bounded publisher key", () =>
    contract.signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.addFunctionCallAccessKey(KeyPair.fromString(publisher.secretKey).getPublicKey(), contractId, ["register_quest", "set_price", "close_quest", "record_support", "open_round", "finalize_round"], 4n * 10n ** 23n)],
      waitUntil: "FINAL",
    }),
  );
const publisherAccount = new Account(contractId, provider, KeyPairSigner.fromSecretKey(publisher.secretKey));
const treasuryBefore = await view(contractId, "get_treasury");
if (treasuryBefore.funded_total === "0")
  await record("Fund the creator fund with 1 test NEAR", () => call(root, contractId, "fund_creators", { receipt_id: "initial-creator-grant-20261101" }, NEAR));
// Smoke: one paid quest by the operator, one free quest by the buyer-side account.
const tag = Date.now().toString(36);
const paidQuest = `smoke-paid-${tag}`, freeQuest = `smoke-free-${tag}`;
await record("Register a paid creator quest", () => call(publisherAccount, contractId, "register_quest", { quest_id: paidQuest, author_id: operator.accountId, price: (NEAR / 10n).toString() }, 0n, 50n * 10n ** 12n));
await record("Register a free creator quest", () => call(publisherAccount, contractId, "register_quest", { quest_id: freeQuest, author_id: buyer, price: "0" }, 0n, 50n * 10n ** 12n));
const buyerAccount = new Account(buyer, provider, signer);
await record("Buy access for exactly 0.1 test NEAR (80/20)", () => call(buyerAccount, contractId, "buy_access", { quest_id: paidQuest }, NEAR / 10n));
const access = await view(contractId, "get_access", { quest_id: paidQuest, account_id: buyer });
assert.equal(access.creator_share, (NEAR / 10n * 8n / 10n).toString());
await record("Repeat purchase is a free no-op", () => call(buyerAccount, contractId, "buy_access", { quest_id: paidQuest }, NEAR / 10n));
assert.equal((await view(contractId, "get_quest", { quest_id: paidQuest })).access_sold, 1);
await record("Donate 0.02 test NEAR to the free quest's author", () => call(root, contractId, "donate", { quest_id: freeQuest }, NEAR / 50n));
const day = `smoke-${tag}`;
await record("Open a support round with 0.1 test NEAR", () => call(publisherAccount, contractId, "open_round", { day, budget: (NEAR / 10n).toString() }, 0n, 50n * 10n ** 12n));
await record("Record one verified completion", () => call(publisherAccount, contractId, "record_support", { quest_id: freeQuest, player_id: operator.accountId, kind: "completion" }, 0n, 50n * 10n ** 12n));
await record("Record one like", () => call(publisherAccount, contractId, "record_support", { quest_id: paidQuest, player_id: buyer, kind: "like" }, 0n, 50n * 10n ** 12n));
await record("Finalize the round", () => call(publisherAccount, contractId, "finalize_round", { day }, 0n, 100n * 10n ** 12n));
const round = await view(contractId, "get_round", { day });
assert.equal(round.finalized, true);
const buyerEarnings = await view(contractId, "get_creator", { account_id: buyer });
await record("Creator withdraws earnings", () => call(buyerAccount, contractId, "withdraw", {}, 1n, 60n * 10n ** 12n));
const after = await view(contractId, "get_creator", { account_id: buyer });
assert.equal(after.pending, "0");
assert.equal(after.withdrawn, buyerEarnings.credit);
await record("Flush the treasury share to the rewards contract", () => call(root, contractId, "flush_treasury", {}, 0n, 60n * 10n ** 12n));
const treasury = await view(contractId, "get_treasury"), config = await view(contractId, "get_config");
const code = await provider.viewAccount({ accountId: contractId });
mkdirSync("output/qa/2026-11-testnet", { recursive: true });
const manifest = { network: "testnet", verifiedAt: new Date().toISOString(), contractId, codeHash: code.code_hash, wasmSha256: createHash("sha256").update(wasm).digest("hex"), rewardsReceiver: rewardsId, publisherPublicKey: publisher.publicKey, policy: config.policy, treasuryBps: config.treasury_bps, capabilities: ["paid-access-80-20", "donations-100", "support-rounds", "withdraw", "treasury-flush"] };
writeFileSync("public/native-creators-testnet.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("public/native-creators-proof.json", JSON.stringify({ ...manifest, smoke: { paidQuest, freeQuest, round: day, access, round: round, buyer: after, treasury }, transactions }, null, 2) + "\n");
console.log(JSON.stringify({ status: "verified", contractId, treasury }));
