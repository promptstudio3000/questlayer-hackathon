// Real worker, synthetic database and local genesis signer passed over IPC only.
import { openDatabase } from "../../server/database.mjs";
import * as chain from "../../server/market/chain.mjs";
import * as market from "../../server/market/service.mjs";
import { escrowDeliveryTransport } from "../../server/market/delivery-transport.mjs";
import { escrowLocalTransport, escrowReceiptSummary } from "./escrow-rpc.mjs";

const send = (message) => process.send?.(message);
process.once("message", async (config) => {
  let db;
  try {
    const transport = await escrowLocalTransport(config);
    chain.setEscrowConfig(config.escrow);
    db = openDatabase(config.dbPath);
    const realView = chain.escrowView(transport.provider, config.escrow.contractId);
    const stop = async (phase) => { send({ type: "stopped", phase }); await new Promise(() => {}); };
    let barrierUsed = false;
    const view = async (method, args) => {
      const result = await realView(method, args);
      if (config.barrier && !barrierUsed) {
        barrierUsed = true;
        const released = new Promise((resolve) => process.once("message", resolve));
        send({ type: "barrier", group: config.barrier });
        await released;
      }
      if (config.stopAfterView) await stop("after-final-view");
      return result;
    };
    const activate = Object.fromEntries(Object.entries(market.ACTIVATE).map(([kind, fn]) => [kind, (...args) => {
      fn(...args);
      if (config.stopInsideActivation) {
        send({ type: "stopped", phase: "inside-activation-before-commit" });
        // Hold the synchronous SQLite transaction until the parent SIGKILLs us.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    }]));
    const durable = await escrowDeliveryTransport(transport.provider, transport.account, config.escrow, chain.PUBLISHER_METHODS);
    const call = { ...durable,
      async send(attempt) {
        const method = attempt.method, args = JSON.parse(attempt.args);
        if (config.stopBefore === method) await stop(`before-${method}`);
        const outcome = await durable.send(attempt);
        send({ type: "transaction", method, args, ...escrowReceiptSummary(outcome.final_execution_outcome ?? outcome) });
        if (config.stopAfter === method) await stop(`after-final-${method}-before-local-save`);
        return outcome;
      },
    };
    const result = await chain.runEscrowWorker(db, {
      view, call, activate, drop: market.DROP, now: config.now,
      maxOps: config.maxOps ?? 20, maxChecks: config.maxChecks ?? 20,
    });
    db.close(); db = null;
    send({ type: "done", result });
    process.disconnect();
  } catch (error) {
    if (db?.isOpen) db.close();
    send({ type: "error", message: error.message });
    process.exitCode = 1;
    process.disconnect();
  }
});
