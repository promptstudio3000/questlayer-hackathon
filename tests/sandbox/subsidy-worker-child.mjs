// Synthetic local-chain child. Credentials arrive only through ephemeral IPC.
import { openDatabase } from "../../server/database.mjs";
import { ManagedAccounts } from "../../server/relayer/accounts.mjs";
import { SubsidyBudget } from "../../server/relayer/subsidy-budget.mjs";
import { escrowLocalTransport } from "./escrow-rpc.mjs";
process.on("message", async (input) => {
  let db;
  try {
    const t = await escrowLocalTransport(input);
    db = openDatabase(input.file);
    const service = new ManagedAccounts(db, t.provider, t.account, {
      factoryId: input.accountId,
      topupCapYocto: 2000n * 10n ** 24n,
      subsidyBudget: new SubsidyBudget(db, {
        dailyYocto: 3000n * 10n ** 24n,
        dailyOperations: 1000,
        gasReserveYocto: 10n ** 24n,
      }),
    });
    const send = t.provider.sendTransactionUntil.bind(t.provider);
    const barrier = async (phase) => {
      if (input.killAt === phase) {
        process.send({ phase });
        await new Promise(() => {});
      }
    };
    t.provider.sendTransactionUntil = async (...args) => {
      await barrier("before-send");
      const result = await send(...args);
      await barrier("after-final");
      return result;
    };
    await service.ensureFunded(input.recipient, BigInt(input.needed), {
      jobId: "process-topup",
    });
    process.send({ done: true });
    db.close();
    process.disconnect();
  } catch (e) {
    process.send({ error: e.message });
    if (db?.isOpen) db.close();
    process.disconnect();
    process.exitCode = 1;
  }
});
