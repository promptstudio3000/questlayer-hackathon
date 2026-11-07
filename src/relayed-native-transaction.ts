// Sends a reviewed native transaction through the sponsored relayer instead of
// a wallet popup. The player's device key signs a NEP-366 delegate; the server
// pays gas, submits it and reports the finalized outcome.
import { api, ApiError } from "./api.ts";
import { signDelegate, type PlayerKeyRecord } from "./player-key.ts";
import type { ReviewedNativeTransaction } from "./confirmed-native-transaction";
import { NEAR_NETWORK } from "./near-network.ts";

export type RelayJobState =
  "queued" | "sending" | "retrying" | "confirmed" | "failed";
export type RelayJob = {
  id: string;
  kind: string;
  state: RelayJobState;
  accountId: string;
  receiverId: string | null;
  methodName: string | null;
  transactionHash: string | null;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  error: string | null;
  updatedAt: number;
};
type Prepared = {
  nonce: string;
  maxBlockHeight: string;
  publicKey: string;
  remainingJobs: number;
};
export class RelayError extends Error {
  code: string;
  job: RelayJob | null;
  constructor(message: string, code: string, job: RelayJob | null = null) {
    super(message);
    this.code = code;
    this.job = job;
  }
}
const TERMINAL: RelayJobState[] = ["confirmed", "failed"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForRelayJob(
  id: string,
  {
    timeoutMs = 60000,
    intervalMs = 1000,
    signal,
  }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<RelayJob> {
  const started = Date.now();
  let job = await api<RelayJob>(`/relay/${encodeURIComponent(id)}`);
  while (!TERMINAL.includes(job.state)) {
    if (signal?.aborted)
      throw new RelayError("Cancelled.", "RELAY_CANCELLED", job);
    if (Date.now() - started > timeoutMs)
      throw new RelayError(
        "Still saving. Check Rewards and balance in a moment.",
        "RELAY_PENDING",
        job,
      );
    await sleep(intervalMs);
    job = await api<RelayJob>(`/relay/${encodeURIComponent(id)}`);
  }
  if (job.state === "failed")
    throw new RelayError(
      job.error || "This action could not be saved.",
      job.errorCode || "RELAY_FAILED",
      job,
    );
  return job;
}

// Resolves with the confirmed job. One automatic re-sign covers an expired
// block window; every other failure is reported with its code.
export async function sendRelayed(
  key: PlayerKeyRecord,
  transaction: ReviewedNativeTransaction,
  {
    signal,
    retryExpired = true,
    recoveryKey,
  }: { signal?: AbortSignal; retryExpired?: boolean; recoveryKey?: string } = {},
): Promise<RelayJob> {
  if (
    transaction.network !== NEAR_NETWORK ||
    transaction.actions.length !== 1 ||
    transaction.actions[0].type !== "FunctionCall"
  )
    throw new RelayError("Choose a supported operation.", "RELAY_SHAPE");
  if (!key.accountId || key.accountId !== transaction.signerId)
    throw new RelayError(
      "This explorer cannot sign that action.",
      "RELAY_ACCOUNT",
    );
  const call = transaction.actions[0].params;
  const cacheKey = recoveryKey ? `questlayer:burn-submission:${NEAR_NETWORK}:${transaction.signerId}:${recoveryKey}` : null;
  const quote = JSON.stringify(transaction);
  type Saved = { quote: string; publicKey: string; signedDelegateBase64: string; jobId: string | null };
  const load = (): Saved | null => {
    if (!cacheKey) return null;
    const raw = localStorage.getItem(cacheKey); if (!raw) return null;
    const row = JSON.parse(raw) as Saved;
    if (raw.length > 50000 || row.quote !== quote || row.publicKey !== key.publicKey ||
      typeof row.signedDelegateBase64 !== "string" || (row.jobId !== null && typeof row.jobId !== "string"))
      throw new RelayError("The saved purchase signature does not match. No replacement will be signed.", "BURN_RECOVERY");
    return row;
  };
  const save = (row: Saved) => {
    if (!cacheKey) return;
    const raw = JSON.stringify(row); localStorage.setItem(cacheKey, raw);
    if (localStorage.getItem(cacheKey) !== raw) throw new RelayError("The payment signature could not be saved.", "BURN_RECOVERY");
  };
  const prepare = async (): Promise<Saved> => {
    const old = load(); if (old) return old;
    const prepared = await api<Prepared>("/relay/prepare", {
      accountId: transaction.signerId, receiverId: transaction.receiverId,
      methodName: call.methodName, publicKey: key.publicKey,
    });
    const signed = await signDelegate(key, {
      senderId: transaction.signerId, receiverId: transaction.receiverId,
      call: { methodName: call.methodName, args: call.args, gas: call.gas, deposit: call.deposit },
      nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight,
    });
    const row = { quote, publicKey: key.publicKey, signedDelegateBase64: signed.signedDelegateBase64, jobId: null };
    save(row); return row;
  };
  const signed = cacheKey && globalThis.navigator?.locks ? await navigator.locks.request(cacheKey, prepare) : await prepare();
  if (signed.jobId) return waitForRelayJob(signed.jobId, { signal });
  let job: RelayJob;
  try {
    job = await api<RelayJob>("/relay", {
      signedDelegateBase64: signed.signedDelegateBase64,
      preview: {
        receiverId: transaction.receiverId,
        methodName: call.methodName,
        gas: call.gas,
        deposit: call.deposit,
      },
    });
  } catch (error) {
    // Admission checks duplicate jobs before expiry. An explicit expiry here
    // proves this cached delegate was never admitted and can no longer execute.
    if (cacheKey && error instanceof ApiError && error.code === "RELAY_EXPIRED" && retryExpired) {
      localStorage.removeItem(cacheKey);
      return sendRelayed(key, transaction, { signal, recoveryKey, retryExpired: false });
    }
    if (error instanceof ApiError)
      throw new RelayError(error.message, error.code || "RELAY_REJECTED");
    throw error;
  }
  save({ ...signed, jobId: job.id });
  try {
    return await waitForRelayJob(job.id, { signal });
  } catch (error) {
    if (
      error instanceof RelayError &&
      error.code === "RELAY_EXPIRED" &&
      retryExpired && !recoveryKey
    )
      return sendRelayed(key, transaction, { signal, retryExpired: false });
    throw error;
  }
}
export function listRelayJobs(accountId: string) {
  return api<{ jobs: RelayJob[] }>(
    `/relay?account=${encodeURIComponent(accountId)}`,
  ).then((r) => r.jobs);
}
