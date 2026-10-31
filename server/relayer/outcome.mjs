import { isDeepStrictEqual } from "node:util";
import { validReceiptStatus } from "../native/transaction-anchor.mjs";
import { RelayJobError, terminal, retryLater } from "./errors.mjs";

const plainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const aura = (value) =>
  typeof value === "string" &&
  /^aura:(polar|moon|gold):[1-9]\d{0,2}$/.test(value);
export function decodeJson(value) {
  if (typeof value !== "string" || value.length > 32768)
    throw terminal("RELAY_RESULT", "Invalid receipt encoding.");
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw terminal("RELAY_RESULT", "Invalid receipt data.");
  }
}
const same = (a, b) => String(a) === String(b);

// Maps a final Failure (or a thrown RPC error) to a durable verdict.
export function classifyFailure(failure, call = {}) {
  const text =
    typeof failure === "string"
      ? failure
      : failure instanceof Error
        ? `${failure.name}: ${failure.message}`
        : JSON.stringify(failure ?? {});
  if (/DelegateActionExpired|TransactionExpired|Expired/i.test(text))
    return new RelayJobError(
      "RELAY_EXPIRED",
      "The signed action expired before it was included. Prepare it again.",
    );
  if (/InvalidNonce|NonceTooLarge/i.test(text))
    return new RelayJobError(
      "RELAY_NONCE",
      "The signed action nonce is no longer valid. Prepare it again.",
    );
  if (/InvalidSignature/i.test(text))
    return new RelayJobError(
      "RELAY_SIGNATURE",
      "The signed action signature was rejected by the network.",
    );
  if (
    /LackBalanceForState|NotEnoughBalance|NotEnoughBalanceForDeposit/i.test(
      text,
    )
  )
    return new RelayJobError(
      "RELAY_INSUFFICIENT_BALANCE",
      "Your account balance does not cover the attached deposit.",
      { terminal: !call.sponsorDeposit, topup: !!call.sponsorDeposit },
    );
  if (
    /FunctionCallError|ExecutionError|GuestPanic|MethodNotFound|Smart contract panicked/i.test(
      text,
    )
  )
    return new RelayJobError(
      "RELAY_CONTRACT_FAILED",
      "The contract rejected the action. Refresh its state before retrying.",
    );
  if (/AccountAlreadyExists/i.test(text))
    return new RelayJobError(
      "ACCOUNT_TAKEN",
      "The account name is already taken.",
    );
  if (failure instanceof Error && !/ActionError|InvalidTxError/.test(text))
    return retryLater("RELAY_NETWORK", String(failure.message).slice(0, 160));
  return new RelayJobError("RELAY_FAILED", "The relayed transaction failed.");
}
export function relayFailure(outcome) {
  const status = outcome?.status;
  if (plainObject(status) && Object.hasOwn(status, "Failure"))
    return status.Failure;
  for (const r of [
    outcome?.transaction_outcome,
    ...(outcome?.receipts_outcome || []),
  ])
    if (
      plainObject(r?.outcome?.status) &&
      Object.hasOwn(r.outcome.status, "Failure")
    )
      return r.outcome.status.Failure;
  return null;
}
function verifyDelegateView(view, call) {
  const d = view?.delegate_action;
  if (
    !plainObject(d) ||
    d.sender_id !== call.senderId ||
    d.receiver_id !== call.receiverId ||
    !same(d.nonce, call.nonce) ||
    !same(d.max_block_height, call.maxBlockHeight) ||
    d.public_key !== call.publicKey ||
    !Array.isArray(d.actions) ||
    d.actions.length !== 1
  )
    throw terminal(
      "RELAY_OUTCOME",
      "The relayed receipt differs from the accepted action.",
    );
  const [action] = d.actions;
  if (call.kind === "call") {
    const f = action?.FunctionCall;
    if (
      !plainObject(f) ||
      f.method_name !== call.methodName ||
      !same(f.gas, call.gas) ||
      !same(f.deposit, call.deposit) ||
      !isDeepStrictEqual(decodeJson(f.args), call.args)
    )
      throw terminal(
        "RELAY_OUTCOME",
        "The relayed call differs from the accepted action.",
      );
  } else if (call.kind === "addKey") {
    const a = action?.AddKey;
    if (
      !plainObject(a) ||
      a.public_key !== call.args.publicKey ||
      a.access_key?.permission !== "FullAccess"
    )
      throw terminal(
        "RELAY_OUTCOME",
        "The relayed key addition differs from the accepted action.",
      );
  } else if (call.kind === "deleteKey") {
    if (action?.DeleteKey?.public_key !== call.args.publicKey)
      throw terminal(
        "RELAY_OUTCOME",
        "The relayed key removal differs from the accepted action.",
      );
  } else throw terminal("RELAY_OUTCOME", "Unknown accepted action kind.");
}
// Verifies a FINAL outcome of a relayed meta-transaction and extracts the result.
export function verifyRelayOutcome(outcome, { relayerId, call }) {
  if (
    outcome?.final_execution_status &&
    outcome.final_execution_status !== "FINAL"
  )
    throw retryLater(
      "RELAY_PENDING",
      "The relayed transaction is not final yet.",
    );
  const tx = outcome?.transaction;
  if (
    !plainObject(tx) ||
    tx.signer_id !== relayerId ||
    tx.receiver_id !== call.senderId ||
    !Array.isArray(tx.actions) ||
    tx.actions.length !== 1 ||
    !plainObject(tx.actions[0]?.Delegate)
  )
    throw terminal(
      "RELAY_OUTCOME",
      "The relayed transaction belongs to a different relayer, account or action.",
    );
  verifyDelegateView(tx.actions[0].Delegate, call);
  const receipts = [
    outcome.transaction_outcome,
    ...(outcome.receipts_outcome || []),
  ];
  if (
    !Array.isArray(outcome.receipts_outcome) ||
    outcome.receipts_outcome.length === 0 ||
    outcome.receipts_outcome.length > 128 ||
    !receipts.every((r) => validReceiptStatus(r?.outcome?.status))
  )
    throw retryLater(
      "RELAY_PENDING",
      "The finalized receipt chain is incomplete.",
    );
  const failure = relayFailure(outcome);
  if (failure) throw classifyFailure(failure, call);
  if (
    !plainObject(outcome.status) ||
    typeof outcome.status.SuccessValue !== "string"
  )
    throw retryLater(
      "RELAY_PENDING",
      "The final transaction outcome is unavailable.",
    );
  const executor = call.kind === "call" ? call.receiverId : call.senderId;
  if (!outcome.receipts_outcome.some((r) => r.outcome.executor_id === executor))
    throw terminal(
      "RELAY_OUTCOME",
      "The receiver's execution receipt is missing.",
    );
  const result = { transactionHash: tx.hash };
  if (
    call.kind === "call" &&
    ["mint_avatar", "redeem_aura"].includes(call.methodName)
  ) {
    // A delegate transaction's own status is the empty delegate result; the
    // contract's return value lives in the receiver's execution receipt.
    const receiverReceipt = outcome.receipts_outcome.find(
      (r) =>
        r.outcome.executor_id === call.receiverId &&
        typeof r.outcome.status?.SuccessValue === "string" &&
        r.outcome.status.SuccessValue.length > 0,
    );
    const token = decodeJson(
      receiverReceipt
        ? receiverReceipt.outcome.status.SuccessValue
        : outcome.status.SuccessValue,
    );
    const valid =
      plainObject(token) &&
      token.owner_id === call.senderId &&
      (call.methodName === "mint_avatar"
        ? token.token_id === `avatar:${call.senderId}`
        : aura(token.token_id) &&
          (!call.args.edition ||
            token.token_id.startsWith(`aura:${call.args.edition}:`)));
    if (!valid)
      throw terminal(
        "RELAY_OUTCOME",
        "The minted collectible belongs to a different account or edition.",
      );
    result.tokenId = token.token_id;
  }
  return result;
}
