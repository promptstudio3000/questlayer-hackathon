// One signing interface for the eight native flows: either the player's
// external wallet (popup) or the invisible managed account (relayed, no popup).
import {
  sendConfirmedNative,
  type NativeConfirmationContext,
  type ReviewedNativeTransaction,
} from "./confirmed-native-transaction";
import { sendRelayed } from "./relayed-native-transaction";
import { isRelayedDeposit, sendSelfPaid } from "./self-paid-native-transaction";
import type { PlayerKeyRecord } from "./player-key";

type Wallet = Parameters<typeof sendConfirmedNative>[0] & {
  manifest?: { features?: { signAndSendTransaction?: unknown } };
};
export type NativeSigner = {
  kind: "wallet" | "managed";
  accountId: string;
  send(
    transaction: ReviewedNativeTransaction,
    context: NativeConfirmationContext,
  ): Promise<void>;
};
export function walletSigner(wallet: Wallet, accountId: string): NativeSigner {
  return {
    kind: "wallet",
    accountId,
    async send(transaction, context) {
      if (wallet.manifest && !wallet.manifest.features?.signAndSendTransaction)
        throw Error("Choose a wallet that supports NEAR transactions.");
      await sendConfirmedNative(wallet, transaction, context);
    },
  };
}
// Storage-class deposits (0, 1 yocto, 0.05 NEAR) go through the relayer with
// no popup and no fee; money actions are signed and paid by the same device
// key as ordinary transactions, still without a wallet popup.
export function managedSigner(
  key: PlayerKeyRecord,
  accountId: string,
): NativeSigner {
  return {
    kind: "managed",
    accountId,
    async send(transaction) {
      if (isRelayedDeposit(transaction)) await sendRelayed(key, transaction);
      else await sendSelfPaid(key, transaction);
    },
  };
}
