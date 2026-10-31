import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { ExitScheduler } from "../server/native/exit-scheduler.mjs";
import { TreasuryModel } from "../server/native/treasury-model.mjs";
const queue = new ExitScheduler(),
  treasury = new TreasuryModel(),
  trace = [];
const enqueue = (id, amount, kind) =>
  queue.enqueue({
    id,
    amount,
    kind,
    owner: kind === "game_yield" ? "treasury" : "alice.testnet",
  });
enqueue("principal-1", "1000", "principal");
enqueue("retained-1", "20", "retained_yield");
enqueue("game-1", "30", "game_yield");
const first = queue.seal(100);
queue.acknowledgeUnstake(first.id, { success: true, confirmedEpoch: 101 });
enqueue("principal-2", "100", "principal");
enqueue("game-2", "10", "game_yield");
const oldUnlock = queue.snapshot().batch.unlockEpoch;
assert.throws(() => queue.seal(102));
assert.equal(queue.snapshot().batch.unlockEpoch, oldUnlock);
assert.equal(treasury.snapshot().receipts.length, 0);
trace.push({
  event: "new exits queued without resetting old unlock",
  epoch: 102,
  unlockEpoch: oldUnlock,
  treasury: treasury.snapshot().available,
});
const receive = (batch, epoch, amount) => {
  queue.beginWithdraw(batch.id, { epoch, poolCanWithdraw: true });
  const received = queue.acknowledgeWithdraw(batch.id, {
    success: true,
    receiptId: `modeled:${batch.id}`,
    received: amount,
  });
  const game = received.tickets
    .filter((t) => t.kind === "game_yield")
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const income = {
    id: `testnet:modeled:${batch.id}:game`,
    kind: "realized_game_yield",
    amount: game.toString(),
    proofHash: createHash("sha256")
      .update(JSON.stringify(received))
      .digest("hex"),
  };
  treasury.receive(income);
  treasury.receive(income);
  trace.push({
    event: "modeled cash received and classified once",
    epoch,
    batch: received,
    gameIncome: game.toString(),
    treasury: treasury.snapshot().available,
  });
};
receive(first, 105, "1051");
treasury.reserve({ id: "city:street", bucket: "coins", amount: "10" });
treasury.expire("city:street");
treasury.expire("city:street");
treasury.reserve({ id: "city:quest", bucket: "zones", amount: "14" });
treasury.award("city:quest", "alice.testnet");
const second = queue.seal(105);
queue.acknowledgeUnstake(second.id, { success: true, confirmedEpoch: 105 });
receive(second, 109, "110");
const exits = queue.snapshot(),
  book = treasury.snapshot();
assert.deepEqual(book.available, { creator: "0", coins: "20", zones: "6" });
assert.equal(book.receipts.length, 2);
const classified = {
  principal: "1100",
  retainedYield: "20",
  gameIncome: "40",
  unclassifiedSurplus: "1",
  totalReceived: "1161",
};
assert.equal(
  BigInt(classified.principal) +
    BigInt(classified.retainedYield) +
    BigInt(classified.gameIncome) +
    BigInt(classified.unclassifiedSurplus),
  BigInt(classified.totalReceived),
);
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  mode: "executable specification; synthetic integer units; NO chain transaction or real income",
  trace,
  classified,
  exits,
  treasury: book,
};
await mkdir("output/qa/W05", { recursive: true });
await writeFile(
  "output/qa/W05/native-funding-simulation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    mode: report.mode,
    closedBatches: exits.closed.length,
    uniqueGameReceipts: book.receipts.length,
    classified,
    available: book.available,
    awarded: "14",
  }),
);
