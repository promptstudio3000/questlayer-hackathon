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
  afterBlock?: number;
  phase: "awaiting_wallet" | "submitted" | "failed";
  error?: string;
  errorCode?: string;
};
export type NativeConfirmationContext = {
  playerId: string;
  storage?: Storage;
  legacyStorage?: Storage | null;
  getAnchor?: (accountId: string) => Promise<number>;
  withLock?: <T>(name: string, work: () => T | Promise<T>) => Promise<T>;
};
export const NATIVE_PENDING_EVENT = "questlayer:native-pending";
export const NATIVE_PENDING_STORAGE_PREFIX = "questlayer:native-pending:v1:";
export const NATIVE_RECOVERY_MAX_BYTES = 100000;
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
  return `${NATIVE_PENDING_STORAGE_PREFIX}${playerId}`;
}
function storageFor(storage?: Storage) {
  try {
    return storage || globalThis.localStorage;
  } catch {
    throw storageError();
  }
}
function validQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const q = value as Quote;
  return (
    Object.keys(q).every((k) =>
      [
        "network",
        "signerId",
        "receiverId",
        "methodName",
        "args",
        "gas",
        "deposit",
      ].includes(k),
    ) &&
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
        (entry.afterBlock !== undefined &&
          (!Number.isSafeInteger(entry.afterBlock) || entry.afterBlock <= 0)) ||
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
function legacyFor(context: NativeConfirmationContext) {
  if (context.legacyStorage !== undefined) return context.legacyStorage;
  if (context.storage) return null;
  try {
    return globalThis.sessionStorage;
  } catch {
    throw storageError();
  }
}
function identicalOperation(
  a: PendingNativeTransaction,
  b: PendingNativeTransaction,
) {
  return (
    a.id === b.id &&
    a.playerId === b.playerId &&
    a.accountId === b.accountId &&
    a.createdAt === b.createdAt &&
    a.afterBlock === b.afterBlock &&
    canonical(a.quote) === canonical(b.quote)
  );
}
function mergeEntries(
  current: PendingNativeTransaction[],
  incoming: PendingNativeTransaction[],
) {
  const merged = clone(current);
  let imported = 0;
  for (const next of incoming) {
    const same = merged.find((e) => e.id === next.id);
    if (same) {
      if (
        !identicalOperation(
          { ...same, afterBlock: undefined },
          { ...next, afterBlock: undefined },
        ) ||
        (same.afterBlock !== undefined &&
          next.afterBlock !== undefined &&
          same.afterBlock !== next.afterBlock) ||
        (same.transactionHash &&
          next.transactionHash &&
          same.transactionHash !== next.transactionHash)
      )
        throw Error(
          "Recovery records conflict. Existing records were kept; check the original wallet history.",
        );
      if (same.afterBlock === undefined && next.afterBlock !== undefined)
        same.afterBlock = next.afterBlock;
      if (!same.transactionHash && next.transactionHash) {
        same.transactionHash = next.transactionHash;
        same.phase = "submitted";
        delete same.error;
        delete same.errorCode;
        imported++;
      }
      continue;
    }
    const sameHash =
      next.transactionHash &&
      merged.find(
        (e) =>
          e.accountId === next.accountId &&
          e.transactionHash === next.transactionHash,
      );
    if (sameHash) {
      if (canonical(sameHash.quote) !== canonical(next.quote))
        throw Error(
          "Recovery records disagree about a transaction. Existing records were kept.",
        );
      continue;
    }
    merged.push(clone(next));
    imported++;
  }
  if (merged.length > MAX_ENTRIES)
    throw Error(
      "Check existing native transactions in Wallet before adding more recovery records.",
    );
  return { entries: merged, imported };
}
function migrate(context: NativeConfirmationContext) {
  const current = readPendingNativeTransactions(
    context.playerId,
    context.storage,
  );
  const legacy = legacyFor(context);
  if (!legacy || legacy === storageFor(context.storage)) return current;
  const oldRaw = legacy.getItem(key(context.playerId));
  if (oldRaw === null) return current;
  const old = readPendingNativeTransactions(context.playerId, legacy);
  const merged = mergeEntries(current, old).entries;
  write(context.playerId, merged, context.storage);
  // Preserve a concurrently changed legacy journal; no old bytes are removed until
  // the durable copy has been written and read back successfully.
  if (legacy.getItem(key(context.playerId)) !== oldRaw) throw storageError();
  try {
    legacy.removeItem(key(context.playerId));
    if (legacy.getItem(key(context.playerId)) !== null) throw storageError();
  } catch {
    throw storageError();
  }
  return merged;
}
async function locked<T>(
  context: NativeConfirmationContext,
  work: () => T | Promise<T>,
) {
  const name = `questlayer:native-journal:${key(context.playerId)}`;
  if (context.withLock) return context.withLock(name, work);
  const locks = globalThis.navigator?.locks;
  if (!locks?.request)
    throw Error(
      "This browser cannot safely coordinate wallet recovery across tabs. Signing is paused; use a supported browser and keep your receipt references.",
    );
  return locks.request(name, { mode: "exclusive" }, work);
}
export async function initializePendingNativeTransactions(
  context: NativeConfirmationContext,
) {
  return locked(context, () => migrate(context));
}
async function mutate(
  context: NativeConfirmationContext,
  expected: PendingNativeTransaction,
  update: (entry: PendingNativeTransaction) => PendingNativeTransaction | null,
) {
  return locked(context, () => {
    const current = migrate(context);
    const found = current.find((e) => e.id === expected.id);
    if (!found) return false; // Another confirmed check removed it. Never resurrect it.
    if (
      !identicalOperation(found, expected) ||
      found.transactionHash !== expected.transactionHash
    )
      throw Error(
        "This recovery record changed in another tab. Refresh it before checking again.",
      );
    const next = current.flatMap((entry) =>
      entry.id === expected.id
        ? [update(entry)].filter(
            (value): value is PendingNativeTransaction => value !== null,
          )
        : [entry],
    );
    write(context.playerId, next, context.storage);
    return true;
  });
}

export async function exportPendingNativeTransactions(
  context: NativeConfirmationContext,
): Promise<string> {
  return locked(context, () => {
    const entries = migrate(context).map((entry) => ({
      id: entry.id,
      playerId: entry.playerId,
      accountId: entry.accountId,
      quote: clone(entry.quote),
      transactionHash: entry.transactionHash,
      createdAt: entry.createdAt,
      ...(entry.afterBlock !== undefined
        ? { afterBlock: entry.afterBlock }
        : {}),
      phase: entry.transactionHash ? "submitted" : "awaiting_wallet",
    }));
    const result = JSON.stringify(
      {
        format: "questlayer-native-receipts",
        version: 1,
        network: "testnet",
        playerId: context.playerId,
        exportedAt: Date.now(),
        entries,
      },
      null,
      2,
    );
    if (new TextEncoder().encode(result).byteLength > NATIVE_RECOVERY_MAX_BYTES)
      throw Error(
        "This recovery file exceeds the safe size limit. Check existing receipts before exporting again.",
      );
    return result;
  });
}
export async function importPendingNativeTransactions(
  context: NativeConfirmationContext,
  jsonText: string,
  linkedAccounts: string[],
): Promise<{ imported: number; total: number }> {
  if (
    typeof jsonText !== "string" ||
    new TextEncoder().encode(jsonText).byteLength > NATIVE_RECOVERY_MAX_BYTES
  )
    throw Error("Choose a QuestLayer recovery file no larger than 100 KB.");
  let file;
  try {
    file = JSON.parse(jsonText);
  } catch {
    throw Error("This is not a readable QuestLayer recovery file.");
  }
  if (
    !file ||
    file.format !== "questlayer-native-receipts" ||
    file.version !== 1 ||
    file.network !== "testnet" ||
    file.playerId !== context.playerId ||
    !Number.isSafeInteger(file.exportedAt) ||
    file.exportedAt <= 0 ||
    Object.keys(file).some(
      (k) =>
        ![
          "format",
          "version",
          "network",
          "playerId",
          "exportedAt",
          "entries",
        ].includes(k),
    )
  )
    throw Error(
      "Choose a NEAR testnet recovery file for this QuestLayer player.",
    );
  const raw = JSON.stringify({
    version: 1,
    playerId: context.playerId,
    entries: file.entries,
  });
  const incoming = readPendingNativeTransactions(context.playerId, {
    getItem: () => raw,
  } as unknown as Storage).map((entry) => {
    if (!linkedAccounts.includes(entry.accountId))
      throw Error(
        "Link every wallet in this recovery file to this player before importing it.",
      );
    if (
      Object.keys(entry).some(
        (k) =>
          ![
            "id",
            "playerId",
            "accountId",
            "quote",
            "transactionHash",
            "createdAt",
            "afterBlock",
            "phase",
          ].includes(k),
      )
    )
      throw Error("The recovery file contains unsupported fields.");
    return {
      ...entry,
      phase: entry.transactionHash
        ? ("submitted" as const)
        : ("awaiting_wallet" as const),
    };
  });
  return locked(context, () => {
    const current = migrate(context),
      merged = mergeEntries(current, incoming);
    write(context.playerId, merged.entries, context.storage);
    return { imported: merged.imported, total: merged.entries.length };
  });
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
        ...(entry.afterBlock !== undefined
          ? { afterBlock: entry.afterBlock }
          : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    ok = response.ok;
    status = response.status;
    result = await response.json();
  } catch {
    const message =
      "Confirmation is unavailable. Your transaction may already be complete; check it in Wallet before trying another action.";
    await mutate(context, entry, (current) => ({ ...current, error: message }));
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
    await mutate(context, entry, (current) => ({
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
    await mutate(context, entry, (current) => ({ ...current, error: message }));
    throw new NativeConfirmationError(message, { ...entry, transactionHash });
  }
  await mutate(context, entry, () => null);
}
export async function checkPendingNativeTransaction(
  context: NativeConfirmationContext,
  operationId: string,
  suppliedHash?: string,
) {
  const entry = (await initializePendingNativeTransactions(context)).find(
    (candidate) => candidate.id === operationId,
  );
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
  const entry = (await initializePendingNativeTransactions(context)).find(
    (candidate) => candidate.id === operationId,
  );
  if (!entry || entry.phase !== "failed")
    throw Error("Only a verified final failure can be cleared.");
  try {
    await verify(context, entry);
  } catch (error) {
    if (!(error instanceof NativeConfirmationError) || !error.terminalVerified)
      throw error;
    await mutate(
      context,
      { ...entry, transactionHash: error.transactionHash },
      () => null,
    );
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

// Durable browser recovery is serialized across same-origin tabs; it is not a cross-device or global spending lock.
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
  const reserved = await locked(context, () => {
    const entries = migrate(context);
    const accountEntries = entries.filter(
      (entry) => entry.accountId === quote.signerId,
    );
    const existing = accountEntries.find(
      (entry) => canonical(entry.quote) === canonical(quote),
    );
    if (existing) return { entry: existing, existing: true };
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
    // Reserve durably under the cross-tab lock before opening any wallet. The lock
    // is released before wallet/RPC awaits, so other tabs can inspect this record.
    write(context.playerId, [...entries, entry], context.storage);
    return { entry, existing: false };
  });
  let { entry } = reserved;
  if (reserved.existing) {
    await verify(context, entry);
    return;
  }
  try {
    let afterBlock: number;
    if (context.getAnchor)
      afterBlock = await context.getAnchor(entry.accountId);
    else {
      const response = await fetch("/api/native/transactions/anchor", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: entry.accountId }),
        signal: AbortSignal.timeout(30000),
      });
      const anchor = await response.json();
      if (
        !response.ok ||
        anchor.network !== "testnet" ||
        anchor.accountId !== entry.accountId
      )
        throw Error(
          "A current NEAR checkpoint is unavailable. The wallet was not opened.",
        );
      afterBlock = anchor.afterBlock;
    }
    if (!Number.isSafeInteger(afterBlock) || afterBlock <= 0)
      throw Error(
        "A current NEAR checkpoint is unavailable. The wallet was not opened.",
      );
    const anchored = { ...entry, afterBlock };
    if (!(await mutate(context, entry, () => anchored)))
      throw Error(
        "This recovery record was reconciled in another tab. Review Wallet before starting another operation; the wallet was not opened.",
      );
    entry = anchored;
  } catch (error) {
    // This function has not called the wallet yet. Only its unchanged reservation
    // can be released; an import or another tab must not be overwritten.
    await mutate(context, entry, () => null);
    throw error;
  }
  // Recheck and initiate the call atomically, but return a wrapper rather than
  // the wallet promise: no Web Lock is held while a wallet dialog is open.
  const invocation = await locked(context, () => {
    const current = migrate(context).find(
      (candidate) => candidate.id === entry.id,
    );
    if (
      !current ||
      !identicalOperation(current, entry) ||
      current.transactionHash !== null
    )
      throw Error(
        "This recovery record changed before signing. Review Wallet; the wallet was not opened.",
      );
    let response: Promise<unknown>;
    try {
      response = Promise.resolve(
        wallet.signAndSendTransaction(clone(reviewed)),
      );
    } catch (error) {
      response = Promise.reject(error);
    }
    return {
      response: response.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
    };
  });
  let outcome: { transaction?: { hash?: unknown } } | undefined;
  try {
    const response = await invocation.response;
    if (!response.ok) throw response.error;
    outcome = response.value as typeof outcome;
  } catch (error) {
    if (definiteRejection(error)) {
      await mutate(context, entry, () => null);
      throw Error("The wallet request was cancelled. Your entries are kept.");
    }
    const message =
      "The wallet did not provide a receipt. Check its history in Wallet before trying again; the operation may already have been sent.";
    await mutate(context, entry, (current) => ({ ...current, error: message }));
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
    await mutate(context, entry, () => submitted);
  } catch {
    throw new NativeConfirmationError(
      `Your transaction was sent but its receipt could not be saved. Keep this reference: ${transactionHash}. Check your wallet before retrying.`,
      submitted,
    );
  }
  await verify(context, submitted);
}
