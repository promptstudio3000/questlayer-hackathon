// Read-only check against an existing project-owned receipt. Never opens a wallet.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createNearProvider } from "../server/near-provider.mjs";
import { openDatabase, createPlayer } from "../server/database.mjs";
import "../server/schema-catalog.mjs";
import { NativeTransactionConfirmation } from "../server/native/transaction-confirmation.mjs";
const load = (name) => JSON.parse(readFileSync(`public/${name}.json`));
const trades = load("native-market-trades-testnet"),
  provider = createNearProvider(),
  db = openDatabase(":memory:");
try {
  const accountId = trades.seller,
    saved = trades.transactions.find((r) => /Seller withdraws/.test(r.label));
  assert(saved, "Project withdrawal receipt missing");
  const player = createPlayer(db, "Recovery checkpoint proof");
  db.prepare("INSERT INTO wallet_links VALUES(?,?,?)").run(
    accountId,
    player,
    Date.now(),
  );
  const service = new NativeTransactionConfirmation(db, provider, {
    rewardsConfig: load("native-rewards-testnet"),
    marketManifest: load("native-market-testnet"),
    claimsManifest: load("native-claims-testnet"),
    timeoutMs: 30000,
  });
  const anchor = await service.anchor(player, accountId);
  const receipt = await service.bounded(
    provider.viewTransactionStatus({
      txHash: saved.transaction,
      accountId,
      waitUntil: "FINAL",
    }),
    Date.now() + 30000,
  );
  const block = await service.bounded(
    provider.viewBlock({ blockId: receipt.transaction_outcome.block_hash }),
    Date.now() + 30000,
  );
  const call = receipt.transaction.actions[0].FunctionCall;
  const input = {
    accountId,
    transactionHash: saved.transaction,
    quote: {
      network: "testnet",
      signerId: accountId,
      receiverId: receipt.transaction.receiver_id,
      methodName: call.method_name,
      args: JSON.parse(Buffer.from(call.args, "base64")),
      gas: String(call.gas),
      deposit: call.deposit,
    },
  };
  assert(block.header.height > 1 && block.header.height <= anchor.afterBlock);
  const accepted = await service.confirm(player, {
    ...input,
    afterBlock: block.header.height - 1,
  });
  for (const afterBlock of [block.header.height, anchor.afterBlock])
    await assert.rejects(
      () => service.confirm(player, { ...input, afterBlock }),
      (e) => e.code === "NATIVE_RECEIPT_BEFORE_REQUEST",
    );
  const report = {
    checkedAt: new Date().toISOString(),
    network: "testnet",
    transactionHash: saved.transaction,
    accountId,
    transactionBlock: block.header.height,
    currentPreSignCheckpoint: anchor.afterBlock,
    exactReceiptConfirmed: accepted.confirmed,
    reconstructedEarlierBoundaryAccepted: true,
    sameBlockRejected: true,
    oldReceiptRejectedForNewRequest: true,
    newTransactions: 0,
    limits: [
      "The earlier boundary was reconstructed for comparison; no new signing flow was exercised",
      "Legacy receipts without checkpoints retain their documented limitations",
      "No wallet key, signature or account mutation",
    ],
  };
  mkdirSync("output/qa/W03-W13-durable-recovery", { recursive: true });
  writeFileSync(
    "output/qa/W03-W13-durable-recovery/live-anchor-proof.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  db.close();
}
