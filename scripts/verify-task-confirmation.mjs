// Read-only receipt verification: no signer, secret, new deposit or transaction.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { NativeTasks } from "../server/native/tasks.mjs";
import { createNearProvider } from "../server/near-provider.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import "../server/schema-catalog.mjs";

const manifest = JSON.parse(readFileSync("public/native-tasks-testnet.json"));
const proof = JSON.parse(readFileSync("public/native-tasks-proof.json"));
assert.equal(manifest.network, "testnet");
assert.equal(manifest.contractId, "questlayer-tasks-20261031.testnet");
const accountId = proof.wallets.claimantId;
const transactionHash = proof.transactions.find(
  (entry) => entry.label === "Claimant withdraws appealed reward",
).transaction;
const db = openDatabase(":memory:");
const player = createPlayer(db, "Read-only task confirmation proof");
db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
  accountId,
  player,
  Date.now(),
);
const adapter = new NativeTasks(db, createNearProvider(), manifest, {
  timeoutMs: 20000,
});
const state = await adapter.snapshot(player, accountId, true);
assert.equal(state.status, "available");
// Reconstruct the known withdrawal display terms, not a new spending authorization.
const quote = {
  network: "testnet",
  contractId: manifest.contractId,
  receiverId: manifest.contractId,
  signerId: accountId,
  codeHash: manifest.codeHash,
  policy: manifest.policy,
  methodName: "withdraw",
  args: {},
  deposit: "1",
  gas: "100000000000000",
  expiresAt: Date.parse(proof.verifiedAt),
  blockHash: state.blockHash,
  blockHeight: state.blockHeight,
};
assert(quote.expiresAt < Date.now());
const confirmed = await adapter.confirm(player, {
  accountId,
  quote,
  transactionHash,
});
assert.equal(confirmed.confirmed, true);
assert.equal(confirmed.transactionHash, transactionHash);
await assert.rejects(
  adapter.confirm(player, {
    accountId,
    quote: { ...quote, deposit: "2" },
    transactionHash,
  }),
);
const result = {
  verifiedAt: new Date().toISOString(),
  mode: "read-only",
  ...confirmed,
  expiredDisplayQuoteAcceptedForExistingReceipt: true,
  alteredDepositRejected: true,
  newTransactions: 0,
  boundary:
    "Programmatic receipt read-back; no mobile wallet or physical field acceptance.",
};
writeFileSync(
  "output/qa/W08-W10-native-tasks/receipt-confirmation.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
db.close();
