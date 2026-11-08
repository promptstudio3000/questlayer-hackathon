// Process boundary fixture: production keeper, modeled ledger/receipts, synthetic IPC-only signer.
import { writeSync } from "node:fs";
import { keeperFixture } from "./qgold-keeper.mjs";
process.once("message", async (config) => {
  let f;
  try {
    f = keeperFixture({ ...config, leaseClock: () => config.leaseNow });
    const stop = async (phase, method) => {
      if (config.stop?.phase === phase && config.stop.method === method) {
        process.send({ type: "boundary", phase, method }); await new Promise(() => {});
      }
    };
    f.controls.beforeSend = (method) => stop("before", method);
    f.controls.afterSend = (method) => stop("after", method);
    if (config.stop?.phase === "commit") {
      const record = f.keeper.record.bind(f.keeper);
      f.keeper.record = (row) => {
        const id = record(row);
        if (row.state === "sent") {
          writeSync(1, "KEEPER_FINAL_COMMIT_BOUNDARY\n");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return id;
      };
    }
    await f.keeper.tick(config.tickNow ?? config.now);
    const result = { calls: f.calls().length, spent: String(f.balance("spent")), burned: String(f.balance("burned")),
      operations: f.db.prepare("SELECT state FROM qgold_keeper_ops").all().map((o) => o.state),
      sentRows: f.db.prepare("SELECT COUNT(*) n FROM qgold_keeper_actions WHERE state='sent'").get().n,
      error: f.keeper.lastError };
    f.close(); process.send({ type: "done", result }, () => process.disconnect());
  } catch (error) {
    if (f) f.close(); process.send({ type: "error", message: error.message }, () => process.disconnect());
    process.exitCode = 1;
  }
});
