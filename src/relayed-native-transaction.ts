// Sends a reviewed native transaction through the sponsored relayer instead of
// a wallet popup. The player's device key signs a NEP-366 delegate; the server
// pays gas, submits it and reports the finalized outcome.
import { api, ApiError } from "./api";
import { signDelegate, type PlayerKeyRecord } from "./player-key";
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
  }: { signal?: AbortSignal; retryExpired?: boolean } = {},
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
  const prepared = await api<Prepared>("/relay/prepare", {
    accountId: transaction.signerId,
    receiverId: transaction.receiverId,
    methodName: call.methodName,
    publicKey: key.publicKey,
  });
  const signed = await signDelegate(key, {
    senderId: transaction.signerId,
    receiverId: transaction.receiverId,
    call: {
      methodName: call.methodName,
      args: call.args,
      gas: call.gas,
      deposit: call.deposit,
    },
    nonce: prepared.nonce,
    maxBlockHeight: prepared.maxBlockHeight,
  });
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
    if (error instanceof ApiError)
      throw new RelayError(error.message, error.code || "RELAY_REJECTED");
    throw error;
  }
  try {
    return await waitForRelayJob(job.id, { signal });
  } catch (error) {
    if (
      error instanceof RelayError &&
      error.code === "RELAY_EXPIRED" &&
      retryExpired
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
