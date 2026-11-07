// One signing interface for the eight native flows: either the player's
// external wallet (popup) or the invisible managed account (relayed, no popup).
import type {
  sendConfirmedNative,
  NativeConfirmationContext,
  ReviewedNativeTransaction,
} from "./confirmed-native-transaction";
import { sendRelayed } from "./relayed-native-transaction";
import { isRelayedDeposit, sendJournaledSelfPaid } from "./self-paid-native-transaction";
import type { PlayerKeyRecord } from "./player-key";

type Wallet = Parameters<typeof sendConfirmedNative>[0] & {
  manifest?: { features?: { signAndSendTransaction?: unknown } };
};
export type NativeSigner = {
  kind: "wallet" | "managed";
  accountId: string;
  // Resolves with the transaction hash when the signer knows it.
  send(
    transaction: ReviewedNativeTransaction,
    context: NativeConfirmationContext,
  ): Promise<string | null | void>;
};
export function walletSigner(wallet: Wallet, accountId: string): NativeSigner {
  return {
    kind: "wallet",
    accountId,
    async send(transaction, context) {
      if (wallet.manifest && !wallet.manifest.features?.signAndSendTransaction)
        throw Error("Choose a wallet that supports NEAR transactions.");
      // The wallet review flow loads on first use, off the first screen.
      const { sendConfirmedNative: send } = await import("./confirmed-native-transaction");
      return send(wallet, transaction, context);
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
    async send(transaction, context) {
      if (isRelayedDeposit(transaction))
        return (await sendRelayed(key, transaction, { recoveryKey: context.recoveryKey })).transactionHash;
      return sendJournaledSelfPaid(key, transaction, context);
    },
  };
}
