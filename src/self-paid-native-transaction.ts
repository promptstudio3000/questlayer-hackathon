// Sends a reviewed native transaction as an ordinary transaction signed by the
// invisible account's own device key. Used for money actions (purchases,
// creator payments, staking): in a NEP-366 meta-transaction the relayer's
// transaction would carry the attached deposit, so the relayer refuses them
// and the player pays both the deposit and the small gas fee here.
import { Account, JsonRpcProvider, actions as nearActions } from "near-api-js";
import { api } from "./api";
import { signerFor, type PlayerKeyRecord } from "./player-key";
import type { ReviewedNativeTransaction } from "./confirmed-native-transaction";

export const RELAYED_DEPOSITS = ["0", "1", "50000000000000000000000"];
export class SelfPaidError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
export function isRelayedDeposit(transaction: ReviewedNativeTransaction) {
  const action = transaction.actions[0];
  return (
    action?.type === "FunctionCall" &&
    RELAYED_DEPOSITS.includes(String(action.params.deposit))
  );
}
let rpcUrl: Promise<string> | null = null;
function resolveRpcUrl() {
  rpcUrl ??= api<{ network: string; rpcUrl?: string }>("/config")
    .then((config) => {
      if (config.network !== "testnet" || typeof config.rpcUrl !== "string")
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

export async function sendSelfPaid(
  key: PlayerKeyRecord,
  transaction: ReviewedNativeTransaction,
): Promise<{ transactionHash: string }> {
  if (
    transaction.network !== "testnet" ||
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
  const provider = new JsonRpcProvider({ url: await resolveRpcUrl() });
  const account = new Account(transaction.signerId, provider, signerFor(key));
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
