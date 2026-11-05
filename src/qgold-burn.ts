// Spending real QGOLD (server/gold-spend/qgold-burn.mjs). When the server
// answers a spend with QGOLD_BURN, the player burns the exact price from their
// own NEAR account (ft_burn, sponsored on the explorer account), the server
// verifies that transaction, and the same spend runs again.
import { api, ApiError } from "./api";
import { tr } from "./i18n";

export type QgoldBurnCall = {
  signerId: string;
  receiverId: string;
  methodName: "ft_burn";
  args: { amount: string; memo: string };
  gas: string;
  deposit: "1";
};
/** Signs the call and resolves with its transaction hash when known. */
export type QgoldBurner = (call: QgoldBurnCall) => Promise<string | null | void>;

let burner: QgoldBurner | null = null;
export function setQgoldBurner(next: QgoldBurner | null) {
  burner = next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs a spend; burns the QGOLD it asks for once, then runs it again. */
export async function withQgoldBurn<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "QGOLD_BURN" || !error.details) throw error;
    if (!burner) throw Error(tr("Sign in with a NEAR account to spend QGOLD."));
    const call = await api<QgoldBurnCall>("/gold/burn/prepare", {
      kind: error.details.kind,
      amountU: error.details.amountU,
    });
    const txHash = await burner(call);
    if (!txHash) throw Error(tr("The wallet did not report the burn. Spend QGOLD from your explorer account."));
    for (let attempt = 0; ; attempt++) {
      try {
        await api("/gold/burn/confirm", { txHash });
        break;
      } catch (e) {
        if (e instanceof ApiError && e.code === "BURN_PENDING" && attempt < 5) {
          await sleep(1500);
          continue;
        }
        throw e;
      }
    }
    return run();
  }
}
