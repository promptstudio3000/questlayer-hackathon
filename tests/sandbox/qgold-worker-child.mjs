// Spawned by qgold.integration.mjs; the only key comes from the parent's IPC.
import { openDatabase } from "../../server/database.mjs";
import { runPayoutWorker } from "../../server/payouts/worker.mjs";
import { localTransport, receiptSummary } from "./qgold-rpc.mjs";

process.once("message", async (config) => {
  let db;
  try {
    const transport = await localTransport(config);
    db = openDatabase(config.dbPath);
    const result = await runPayoutWorker(db, {
      now: config.now,
      // Advance only scheduling/lease time, never substitute chain state.
      clock: () => Date.now() + (config.clockOffset ?? 0),
      view: (method, args) => transport.view("rewards.testnet", method, args),
      call: async (method, args) => {
        if (config.barrierGroup && method === "claim_payout") {
          process.send({ type: "barrier-ready", group: config.barrierGroup });
          await new Promise((resolve) => process.once("message", resolve));
        }
        if (config.stopBefore === method) {
          process.send({ type: "stopped-before-send", method });
          await new Promise(() => {});
        }
        const outcome = await transport.call("rewards.testnet", method, args);
        process.send({ type: "transaction", method, indexes: args.claims?.map((c) => c.index), ...receiptSummary(outcome) });
        if (config.stopAfter === method) {
          // The receipt is real and final; deliberately lose the local response.
          process.send({ type: "stopped-after-send", method });
          await new Promise(() => {});
        }
        return outcome.transaction.hash;
      },
    });
    db.close();
    process.send({ type: "done", result });
    process.disconnect();
  } catch (error) {
    if (db?.isOpen) db.close();
    process.send({ type: "error", message: error.message });
    process.exitCode = 1;
    process.disconnect();
  }
});
