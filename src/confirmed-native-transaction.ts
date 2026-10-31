import type { SignAndSendTransactionParams } from "@hot-labs/near-connect";

type Call = {
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
};
export type ReviewedNativeTransaction = {
  network: "testnet";
  signerId: string;
  receiverId: string;
  actions: [{ type: "FunctionCall"; params: Call }];
};
type Wallet = {
  signAndSendTransaction(input: SignAndSendTransactionParams): Promise<unknown>;
};
type Quote = Call & {
  network: "testnet";
  signerId: string;
  receiverId: string;
};
export type PendingNativeTransaction = {
  id: string;
  playerId: string;
  accountId: string;
  quote: Quote;
  transactionHash: string | null;
  createdAt: number;
  phase: "awaiting_wallet" | "submitted" | "failed";
  error?: string;
  errorCode?: string;
};
export type NativeConfirmationContext = { playerId: string; storage?: Storage };
export const NATIVE_PENDING_EVENT = "questlayer:native-pending";
const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const TERMINAL = new Set([
  "NATIVE_TRANSACTION_FAILED",
  "NATIVE_OPERATION_NOT_COMPLETED",
]);
const MAX_ENTRIES = 8;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function storageError() {
  return Error(
    "Transaction recovery storage is unavailable or damaged. Signing is paused; keep this tab and check your wallet history.",
  );
}
function key(playerId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(playerId)) throw storageError();
  return `questlayer:native-pending:v1:${playerId}`;
}
function storageFor(storage?: Storage) {
  try {
    return storage || globalThis.sessionStorage;
  } catch {
    throw storageError();
  }
}
function validQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const q = value as Quote;
  return (
    q.network === "testnet" &&
    typeof q.signerId === "string" &&
    /^[a-z0-9._-]{2,64}$/.test(q.signerId) &&
    typeof q.receiverId === "string" &&
    /^[a-z0-9._-]{2,64}$/.test(q.receiverId) &&
    typeof q.methodName === "string" &&
    /^[a-z_]{1,64}$/.test(q.methodName) &&
    typeof q.gas === "string" &&
    /^[1-9]\d{0,14}$/.test(q.gas) &&
    typeof q.deposit === "string" &&
    /^(0|[1-9]\d{0,38})$/.test(q.deposit) &&
    !!q.args &&
    typeof q.args === "object" &&
    !Array.isArray(q.args) &&
    JSON.stringify(q).length <= 12000
  );
}
export function readPendingNativeTransactions(
  playerId: string,
  storage?: Storage,
): PendingNativeTransaction[] {
  try {
    const raw = storageFor(storage).getItem(key(playerId));
    if (raw === null) return [];
    if (raw.length > 100000) throw storageError();
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      data.playerId !== playerId ||
      !Array.isArray(data.entries) ||
      data.entries.length > MAX_ENTRIES
    )
      throw storageError();
    const ids = new Set<string>();
    for (const entry of data.entries) {
      if (
        !entry ||
        entry.playerId !== playerId ||
        typeof entry.id !== "string" ||
        !/^[a-z0-9-]{36}$/.test(entry.id) ||
        ids.has(entry.id) ||
        !validQuote(entry.quote) ||
        entry.accountId !== entry.quote.signerId ||
        !Number.isSafeInteger(entry.createdAt) ||
        entry.createdAt <= 0 ||
        !["awaiting_wallet", "submitted", "failed"].includes(entry.phase) ||
        (entry.transactionHash !== null &&
          (typeof entry.transactionHash !== "string" ||
            !HASH.test(entry.transactionHash))) ||
        (entry.phase !== "awaiting_wallet" && entry.transactionHash === null) ||
        (entry.error !== undefined &&
          (typeof entry.error !== "string" || entry.error.length > 400)) ||
        (entry.errorCode !== undefined && typeof entry.errorCode !== "string")
      )
        throw storageError();
      ids.add(entry.id);
    }
    return data.entries;
  } catch {
    throw storageError();
  }
}
function emit() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(NATIVE_PENDING_EVENT));
}
function write(
  playerId: string,
  entries: PendingNativeTransaction[],
  storage?: Storage,
) {
  if (entries.length > MAX_ENTRIES)
    throw Error(
      "Check existing native transactions in Wallet before starting another.",
    );
  const encoded = JSON.stringify({ version: 1, playerId, entries });
  if (encoded.length > 100000) throw storageError();
  try {
    const store = storageFor(storage);
    store.setItem(key(playerId), encoded);
    if (store.getItem(key(playerId)) !== encoded) throw storageError();
  } catch {
    throw storageError();
  }
  emit();
}
function mutate(
  context: NativeConfirmationContext,
  id: string,
  update: (entry: PendingNativeTransaction) => PendingNativeTransaction | null,
) {
  const current = readPendingNativeTransactions(
    context.playerId,
    context.storage,
  );
  const next = current.flatMap((entry) =>
    entry.id === id
      ? [update(entry)].filter(
          (value): value is PendingNativeTransaction => value !== null,
        )
      : [entry],
  );
  write(context.playerId, next, context.storage);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export class NativeConfirmationError extends Error {
  transactionHash: string | null;
  operationId: string;
  code: string;
  terminalVerified: boolean;
  constructor(
    message: string,
    entry: PendingNativeTransaction,
    code = "NATIVE_CONFIRMATION_UNKNOWN",
    terminalVerified = false,
  ) {
    super(message);
    this.transactionHash = entry.transactionHash;
    this.operationId = entry.id;
    this.code = code;
    this.terminalVerified = terminalVerified;
  }
}
async function verify(
  context: NativeConfirmationContext,
  entry: PendingNativeTransaction,
  suppliedHash?: string,
) {
  const transactionHash = entry.transactionHash || suppliedHash?.trim();
  if (!transactionHash || !HASH.test(transactionHash))
    throw new NativeConfirmationError(
      "Check your wallet history and enter the transaction hash in Wallet. This action will not be signed again.",
      entry,
    );
  let result: {
      confirmed?: boolean;
      network?: string;
      accountId?: string;
      contractId?: string;
      transactionHash?: string;
      error?: string;
      code?: string;
    },
    ok: boolean,
    status: number;
  try {
    const response = await fetch("/api/native/transactions/confirm", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: entry.accountId,
        transactionHash,
        quote: entry.quote,
      }),
      signal: AbortSignal.timeout(30000),
    });
    ok = response.ok;
    status = response.status;
    result = await response.json();
  } catch {
    const message =
      "Confirmation is unavailable. Your transaction may already be complete; check it in Wallet before trying another action.";
    mutate(context, entry.id, (current) => ({ ...current, error: message }));
    throw new NativeConfirmationError(message, { ...entry, transactionHash });
  }
  if (!ok) {
    const code =
      typeof result.code === "string"
        ? result.code
        : "NATIVE_CONFIRMATION_UNKNOWN";
    const terminalVerified = status === 409 && TERMINAL.has(code);
    const message = String(
      result.error ||
        "The transaction has not been confirmed. Check it in Wallet before retrying.",
    ).slice(0, 400);
    mutate(context, entry.id, (current) => ({
      ...current,
      ...(terminalVerified
        ? { phase: "failed" as const, transactionHash }
        : {}),
      error: message,
      errorCode: code,
    }));
    throw new NativeConfirmationError(
      message,
      { ...entry, transactionHash },
      code,
      terminalVerified,
    );
  }
  if (
    result.confirmed !== true ||
    result.network !== "testnet" ||
    result.accountId !== entry.accountId ||
    result.contractId !== entry.quote.receiverId ||
    result.transactionHash !== transactionHash
  ) {
    const message =
      "The confirmation did not match this transaction. Check the saved receipt in Wallet before retrying.";
    mutate(context, entry.id, (current) => ({ ...current, error: message }));
    throw new NativeConfirmationError(message, { ...entry, transactionHash });
  }
  mutate(context, entry.id, () => null);
}
export async function checkPendingNativeTransaction(
  context: NativeConfirmationContext,
  operationId: string,
  suppliedHash?: string,
) {
  const entry = readPendingNativeTransactions(
    context.playerId,
    context.storage,
  ).find((candidate) => candidate.id === operationId);
  if (!entry)
    throw Error(
      "This pending receipt is no longer available. Refresh the wallet record.",
    );
  await verify(context, entry, suppliedHash);
}
export async function clearFailedNativeTransaction(
  context: NativeConfirmationContext,
  operationId: string,
  balancesReviewed: boolean,
) {
  if (!balancesReviewed)
    throw Error(
      "Review the current balance or item state before clearing a failed receipt.",
    );
  const entry = readPendingNativeTransactions(
    context.playerId,
    context.storage,
  ).find((candidate) => candidate.id === operationId);
  if (!entry || entry.phase !== "failed")
    throw Error("Only a verified final failure can be cleared.");
  try {
    await verify(context, entry);
  } catch (error) {
    if (!(error instanceof NativeConfirmationError) || !error.terminalVerified)
      throw error;
    mutate(context, entry.id, () => null);
  }
}
function definiteRejection(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    code === 4001 ||
    code === "4001" ||
    ["ACTION_REJECTED", "USER_REJECTED", "USER_CANCELLED"].includes(
      String(code),
    )
  );
}

// The journal survives reloads in this tab. It is not a cross-device spending lock.
export async function sendConfirmedNative(
  wallet: Wallet,
  transaction: ReviewedNativeTransaction,
  context: NativeConfirmationContext,
) {
  if (
    transaction.network !== "testnet" ||
    transaction.actions.length !== 1 ||
    transaction.actions[0].type !== "FunctionCall"
  )
    throw Error("Choose a supported NEAR testnet operation.");
  const reviewed = clone(transaction);
  const quote: Quote = {
    network: reviewed.network,
    signerId: reviewed.signerId,
    receiverId: reviewed.receiverId,
    ...reviewed.actions[0].params,
  };
  if (!validQuote(quote))
    throw Error("The reviewed native operation is invalid.");
  const entries = readPendingNativeTransactions(
    context.playerId,
    context.storage,
  );
  const accountEntries = entries.filter(
    (entry) => entry.accountId === quote.signerId,
  );
  const existing = accountEntries.find(
    (entry) => canonical(entry.quote) === canonical(quote),
  );
  if (existing) {
    await verify(context, existing);
    return;
  }
  if (accountEntries.length)
    throw Error(
      "This wallet has an unchecked transaction. Open Wallet and check its saved receipt before signing another action.",
    );
  if (entries.length >= MAX_ENTRIES)
    throw Error(
      "Check existing native transactions in Wallet before starting another.",
    );
  const entry: PendingNativeTransaction = {
    id: crypto.randomUUID(),
    playerId: context.playerId,
    accountId: quote.signerId,
    quote,
    transactionHash: null,
    createdAt: Date.now(),
    phase: "awaiting_wallet",
  };
  // Reserve before opening the wallet so concurrent requests or a reload cannot
  // blindly open a second charge when the first wallet reply is missing.
  write(context.playerId, [...entries, entry], context.storage);
  let outcome: { transaction?: { hash?: unknown } } | undefined;
  try {
    outcome = (await wallet.signAndSendTransaction(
      transaction,
    )) as typeof outcome;
  } catch (error) {
    if (definiteRejection(error)) {
      mutate(context, entry.id, () => null);
      throw Error("The wallet request was cancelled. Your entries are kept.");
    }
    const message =
      "The wallet did not provide a receipt. Check its history in Wallet before trying again; the operation may already have been sent.";
    mutate(context, entry.id, (current) => ({ ...current, error: message }));
    throw new NativeConfirmationError(message, entry);
  }
  const transactionHash = outcome?.transaction?.hash;
  if (typeof transactionHash !== "string" || !HASH.test(transactionHash))
    throw new NativeConfirmationError(
      "No transaction receipt was returned. Open Wallet and check your wallet history before trying another action.",
      entry,
    );
  const submitted: PendingNativeTransaction = {
    ...entry,
    transactionHash,
    phase: "submitted",
  };
  try {
    mutate(context, entry.id, () => submitted);
  } catch {
    throw new NativeConfirmationError(
      `Your transaction was sent but its receipt could not be saved. Keep this reference: ${transactionHash}. Check your wallet before retrying.`,
      submitted,
    );
  }
  await verify(context, submitted);
}
