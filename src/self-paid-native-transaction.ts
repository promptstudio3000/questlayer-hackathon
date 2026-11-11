// Sends a reviewed native transaction as an ordinary transaction signed by the
// invisible account's own device key. Used for money actions (purchases,
// creator payments, staking): in a NEP-366 meta-transaction the relayer's
// transaction would carry the attached deposit, so the relayer refuses them
// and the player pays both the deposit and the small gas fee here.
import type { Account } from "near-api-js";
import { loadNearApi } from "./near-api.ts";
import { api } from "./api.ts";
import { signerFor, type PlayerKeyRecord } from "./player-key.ts";
import type { ReviewedNativeTransaction, NativeConfirmationContext } from "./confirmed-native-transaction.ts";
import { NEAR_NETWORK } from "./near-network.ts";

export const RELAYED_DEPOSITS = ["0", "1", "50000000000000000000000"];
export class SelfPaidError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
// Calls that move money even with a storage-class deposit: filling a signed
// buy offer attaches 1 yocto but releases the buyer's escrowed NEAR.
export const SELF_PAID_METHODS = [
  "buy",
  "fill_sell_order",
  "fill_buy_order",
  "deposit_near",
];
export function isRelayedDeposit(transaction: ReviewedNativeTransaction) {
  const action = transaction.actions[0];
  return (
    action?.type === "FunctionCall" &&
    RELAYED_DEPOSITS.includes(String(action.params.deposit)) &&
    !SELF_PAID_METHODS.includes(action.params.methodName)
  );
}
let rpcUrl: Promise<string> | null = null;
function resolveRpcUrl() {
  rpcUrl ??= api<{ network: string; rpcUrl?: string }>("/config")
    .then((config) => {
      if (config.network !== NEAR_NETWORK || typeof config.rpcUrl !== "string")
        throw new SelfPaidError(
          "The game network is unavailable.",
          "SELF_PAID_NETWORK",
        );
      return config.rpcUrl;
    })
    .catch((error) => {
      rpcUrl = null;
      throw error;
    });
  return rpcUrl;
}
const plain = (value: unknown) =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Reserve the operation before calling the signer. An uncertain send must be
// reconciled from the saved receipt, never turned into a new payment on retry.
export async function sendJournaledSelfPaid(
  key: PlayerKeyRecord,
  transaction: ReviewedNativeTransaction,
  context: NativeConfirmationContext,
  send = sendSelfPaid,
) {
  const { sendConfirmedNative } = await import("./confirmed-native-transaction.ts");
  return sendConfirmedNative({ signAndSendTransaction: async () => {
    const result = await send(key, transaction);
    return { transaction: { hash: result.transactionHash } };
  } }, transaction, context);
}

export async function sendSelfPaid(
  key: PlayerKeyRecord,
  transaction: ReviewedNativeTransaction,
): Promise<{ transactionHash: string }> {
  if (
    transaction.network !== NEAR_NETWORK ||
    transaction.actions.length !== 1 ||
    transaction.actions[0].type !== "FunctionCall"
  )
    throw new SelfPaidError("Choose a supported operation.", "SELF_PAID_SHAPE");
  if (!key.accountId || key.accountId !== transaction.signerId)
    throw new SelfPaidError(
      "This explorer cannot sign that action.",
      "SELF_PAID_ACCOUNT",
    );
  const call = transaction.actions[0].params;
  const {
    Account,
    JsonRpcProvider,
    actions: nearActions,
  } = await loadNearApi();
  const provider = new JsonRpcProvider({ url: await resolveRpcUrl() });
  // A failure before the signature exists (the approval window was refused or
  // could not open) is certain not to have reached the chain, so the caller can
  // release its reservation instead of blocking the retry.
  const signer = await signerFor(key);
  let signed = false;
  const guarded = Object.create(signer) as typeof signer;
  guarded.signTransaction = async (tx) => {
    const result = await signer.signTransaction(tx);
    signed = true;
    return result;
  };
  const account = new Account(transaction.signerId, provider, guarded);
  let outcome: Awaited<ReturnType<Account["signAndSendTransaction"]>>;
  try {
    outcome = await account.signAndSendTransaction({
      receiverId: transaction.receiverId,
      actions: [
        nearActions.functionCall(
          call.methodName,
          call.args,
          BigInt(call.gas),
          BigInt(call.deposit),
        ),
      ],
      waitUntil: "FINAL",
    });
  } catch (error) {
    const text = String((error as Error)?.message || error);
    if (!signed)
      throw new SelfPaidError(
        text && text.length <= 300
          ? text
          : "This action was not signed. Nothing was sent; try again.",
        "SELF_PAID_NOT_SENT",
      );
    if (/NotEnoughBalance|LackBalanceForState/i.test(text))
      throw new SelfPaidError(
        "Your account balance does not cover this amount.",
        "SELF_PAID_INSUFFICIENT_BALANCE",
      );
    throw new SelfPaidError(
      "This action could not be sent. Check your connection and try again.",
      "SELF_PAID_NETWORK",
    );
  }
  const status = outcome.status as Record<string, unknown> | string;
  const failed =
    (plain(status) && "Failure" in (status as Record<string, unknown>)) ||
    (outcome.receipts_outcome || []).some(
      (r) =>
        plain(r.outcome.status) &&
        "Failure" in (r.outcome.status as Record<string, unknown>),
    );
  if (failed)
    throw new SelfPaidError(
      "The contract rejected the action. Refresh its state before retrying.",
      "SELF_PAID_CONTRACT_FAILED",
    );
  return { transactionHash: outcome.transaction.hash };
}
