// Durable signed-order index: persistence across restart and restore,
// contract re-verification, and chain events from final receipts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/database.mjs";
import { SignedOrderIndex, stateFromCheck } from "../server/native/order-index.mjs";
import { NETWORK } from "../server/native/network.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/signed-aura-order.json", import.meta.url)),
);
const NOW = 1_793_000_000_000;
const skip = NETWORK !== "testnet";
function fakeMarket() {
  const m = {
    contractId: "market.testnet",
    nfts: { contractId: "nfts.testnet" },
    check: { valid: true, reason: null, fillable: true },
    outcome: null,
    view: async (method) => (method === "get_stats" ? { version: 2 } : m.check),
    provider: {
      viewTransactionStatus: async ({ txHash }) => ({ ...m.outcome, transaction: { hash: txHash } }),
    },
  };
  return m;
}
const event = (name, data, executor = "market.testnet") => ({
  outcome: {
    executor_id: executor,
    status: { SuccessValue: "" },
    logs: [`EVENT_JSON:${JSON.stringify({ standard: "questlayer_market", version: "2.0.0", event: name, data: [data] })}`],
  },
});
const TX = "9".repeat(44);

test("an accepted order survives a restart and a restored backup, then is re-verified", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "orders-")),
    path = join(dir, "game.sqlite");
  const market = fakeMarket();
  let db = openDatabase(path);
  const index = new SignedOrderIndex(db, market, { now: () => NOW });
  const stored = await index.submit(fixture);
  assert.equal(stored.state, "open");
  assert.equal((await index.submit(fixture)).duplicate, true);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  copyFileSync(path, join(dir, "backup.sqlite"));
  db.close();
  // Restart: same database, new process.
  db = openDatabase(path);
  const restarted = new SignedOrderIndex(db, market, { now: () => NOW });
  assert.equal((await restarted.list()).length, 1);
  db.close();
  // Restore an older backup after the order was filled on chain: the startup
  // pass re-checks it with the contract and closes it.
  const restoredDb = openDatabase(join(dir, "backup.sqlite"));
  market.check = { valid: false, reason: "Order nonce already used", fillable: false };
  const restored = new SignedOrderIndex(restoredDb, market, { now: () => NOW });
  assert.deepEqual(await restored.reconcile(512, { all: true }), { checked: 1, changed: 1 });
  assert.equal((await restored.list()).length, 0);
  restoredDb.close();
});

test("only the market contract's own final events close orders, idempotently", { skip }, async () => {
  const market = fakeMarket(),
    db = openDatabase(":memory:"),
    index = new SignedOrderIndex(db, market, { now: () => NOW });
  await index.submit(fixture);
  // A look-alike event from another contract is ignored.
  market.outcome = { final_execution_status: "FINAL", receipts_outcome: [event("order_cancel", { maker: "seller.testnet", nonce: fixture.nonce }, "evil.testnet")] };
  assert.equal((await index.recordTransaction(TX, "seller.testnet")).events, 0);
  assert.equal((await index.list()).length, 1);
  market.outcome = { final_execution_status: "FINAL", receipts_outcome: [event("order_cancel", { maker: "seller.testnet", nonce: fixture.nonce, token_id: "aura:polar:1" })] };
  assert.equal((await index.recordTransaction(TX, "seller.testnet")).applied, 1);
  assert.equal((await index.recordTransaction(TX, "seller.testnet")).applied, 0);
  const [status] = await index.statuses([fixture]);
  assert.equal(status.state, "cancelled");
  assert.equal(status.settlementTx, TX);
  db.close();
});

test("a cancel event corrects a fill inferred from a used nonce; cancel-all closes older epochs", { skip }, async () => {
  const market = fakeMarket(),
    db = openDatabase(":memory:"),
    index = new SignedOrderIndex(db, market, { now: () => NOW + 20_000 });
  await index.submit(fixture);
  market.check = { valid: false, reason: "Order nonce already used" };
  await index.reconcile(32);
  assert.equal((await index.statuses([fixture]))[0].state, "filled");
  market.outcome = { final_execution_status: "FINAL", receipts_outcome: [event("order_cancel", { maker: "seller.testnet", nonce: fixture.nonce })] };
  await index.recordTransaction(TX, "seller.testnet");
  assert.equal((await index.statuses([fixture]))[0].state, "cancelled");

  const db2 = openDatabase(":memory:"),
    market2 = fakeMarket(),
    index2 = new SignedOrderIndex(db2, market2, { now: () => NOW });
  await index2.submit(fixture);
  market2.outcome = { final_execution_status: "FINAL", receipts_outcome: [event("orders_cancel_all", { account_id: "seller.testnet", epoch: 1 })] };
  await index2.recordTransaction(TX, "seller.testnet");
  assert.equal((await index2.list()).length, 0);
  db.close();
  db2.close();
});

test("rejected orders are never stored; contract reasons map to player states", { skip }, async () => {
  const market = fakeMarket(),
    db = openDatabase(":memory:"),
    index = new SignedOrderIndex(db, market, { now: () => NOW });
  market.check = { valid: false, reason: "Key is not registered by the maker" };
  await assert.rejects(index.submit(fixture), /not registered/);
  assert.equal((await index.list()).length, 0);
  assert.equal(stateFromCheck({ valid: false, reason: "Order expired" }, NOW, 0), "expired");
  assert.equal(stateFromCheck({ valid: true }, NOW, NOW - 1), "expired");
  assert.equal(stateFromCheck({ valid: false, reason: "Order was cancelled by the maker" }, NOW, 0), "cancelled");
  db.close();
});
