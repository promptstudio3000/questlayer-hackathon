// Who signs NPC trades (src/chain-trades.ts). Kept apart so the first screen
// only carries this registration, not the trade steps themselves.
import type { PlayerKeyRecord } from "./player-key";

export type ChainCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
};
export type Sender = (accountId: string, call: ChainCall) => Promise<string | null>;
export const chainSigners: {
  sender: Sender | null;
  secure: ((itemId: string) => Promise<boolean>) | null;
  intentsKey: (() => PlayerKeyRecord | null) | null;
} = { sender: null, secure: null, intentsKey: null };

export function registerChainTrades(
  next: { send: Sender; secureItem: (itemId: string) => Promise<boolean>; intentsKey?: () => PlayerKeyRecord | null } | null,
) {
  chainSigners.sender = next?.send ?? null;
  chainSigners.secure = next?.secureItem ?? null;
  chainSigners.intentsKey = next?.intentsKey ?? null;
}
