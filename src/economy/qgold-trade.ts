// Buy and sell QGOLD at the vault from the /economy page (docs/QGOLD-MARKET.md).
// Loaded only when a visitor presses Buy or Sell. It signs with this
// browser's game account key (the same key the game uses), so it works only
// where the player has already played. Amounts are integer strings.
import { NEAR_NETWORK } from "../near-network.ts";
import { indexedDbKeyStore, loadDeviceKey } from "../player-key.ts";
import { sendSelfPaid } from "../self-paid-native-transaction.ts";
import type { ExitPath } from "./qgold-quote.ts";

const TGAS = 10n ** 12n;
export async function playerAccount(): Promise<string | null> {
  try {
    return (await loadDeviceKey(indexedDbKeyStore()))?.accountId ?? null;
  } catch {
    return null;
  }
}

async function send(receiverId: string, methodName: string, args: Record<string, unknown>, deposit: bigint, gas: bigint) {
  const key = await loadDeviceKey(indexedDbKeyStore());
  if (!key?.accountId) throw Error("Play once on this device to get your game account, then come back.");
  return sendSelfPaid(key, {
    network: NEAR_NETWORK,
    signerId: key.accountId,
    receiverId,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName, args, gas: (gas * TGAS).toString(), deposit: deposit.toString() },
      },
    ],
  });
}

/** Payable deposit at R + 1 %, accepting at most 1 % less than quoted. */
export function buyQgold(vault: string, near: bigint, quoted: bigint) {
  return send(vault, "deposit", { min_out: ((quoted * 99n) / 100n).toString() }, near, 100n);
}

/** Redeem burns the caller's QGOLD first, then pays its share (1 yocto attached). */
export function sellQgold(vault: string, qgold: bigint, path: ExitPath, quoted: bigint) {
  return send(vault, "redeem", { amount: qgold.toString(), path, min_out: ((quoted * 99n) / 100n).toString() }, 1n, 150n);
}
