// Actual local-chain worker. Synthetic signers arrive only through private IPC.
import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../../server/database.mjs";
import { QgoldKeeper, keeperSettings } from "../../server/qgold/keeper.mjs";
import { keeperTransport } from "../../server/qgold/keeper-transport.mjs";
import { escrowLocalTransport } from "./escrow-rpc.mjs";

process.once("message", async (config) => {
  let db;
  try {
    const local = await escrowLocalTransport(config);
    db = openDatabase(config.dbPath);
    const reader = (contractId) => ({ contractId, view: (method, args) => local.view(contractId, method, args) });
    const boundary = async (phase, method) => {
      if (config.stop?.phase === phase && config.stop.method === method) {
        process.send({ type: "boundary", phase, method }); await new Promise(() => {});
      }
      if (config.intercept?.phase === phase && config.intercept.method === method) {
        await new Promise((resolve) => {
          process.once("message", resolve);
          process.send({ type: "intercept", action: config.intercept.action });
        });
      }
    };
    const Subject = config.subject ? (await import(pathToFileURL(config.subject))).QgoldKeeper : QgoldKeeper;
    const keeper = new Subject(db, {
      vault: reader("qgold.testnet"), rhea: reader("dex.testnet"), poolId: config.poolId, wnear: "wrap.testnet",
      provider: local.provider, account: local.account, clock: () => config.now, leaseClock: () => config.leaseNow,
      settings: { ...keeperSettings({}), execute: true, inverseBudgetYocto: config.mode === "inverse" ? 10n ** 24n : 0n },
      transportFactory: async (k) => {
        const transport = await keeperTransport(k);
        return { ...transport,
          receipts: transport.receipts && (async (response, ids) => {
            const enriched = await transport.receipts(response, ids);
            process.send({ type: "transaction", via: "receipt-details", tx: response.transaction?.hash, response: enriched }); return enriched;
          }),
          status: async (attempt) => {
            if (config.hideStatus) throw Error("Injected local RPC status outage");
            const response = await transport.status(attempt);
            process.send({ type: "transaction", via: "status", tx: attempt.tx, response }); return response;
          },
          send: async (attempt) => {
            const method = JSON.parse(attempt.request).methodName;
            await boundary("before", method);
            const response = await transport.send(attempt);
            process.send({ type: "transaction", via: "send", tx: attempt.tx, response });
            await boundary("after", method);
            if (config.loseReply === method) throw Error("Injected lost RPC reply after real FINAL execution");
            return response;
          },
        };
      },
    });
    if (config.stop?.phase === "commit") {
      const record = keeper.record.bind(keeper);
      keeper.record = (row) => {
        const result = record(row);
        if (row.state === "sent") { writeSync(1, "KEEPER_COMMIT_BOUNDARY\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
        return result;
      };
    }
    await keeper.tick();
    const result = { error: keeper.lastError,
      operations: db.prepare("SELECT kind,state,last_error,reserved_near,reserved_qgold FROM qgold_keeper_ops ORDER BY position").all(),
      steps: db.prepare("SELECT step,attempt,tx,state,proof FROM qgold_keeper_steps ORDER BY rowid").all(),
      sentRows: db.prepare("SELECT COUNT(*) n FROM qgold_keeper_actions WHERE state='sent'").get().n };
    db.close(); process.send({ type: "done", result }, () => process.disconnect());
  } catch (error) {
    if (db?.isOpen) db.close();
    process.send({ type: "error", message: error.message }, () => process.disconnect()); process.exitCode = 1;
  }
});
