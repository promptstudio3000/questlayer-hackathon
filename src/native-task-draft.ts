import {
  NATIVE_TASK_CONTRACT,
  TASK_POLICY,
  type TaskRequest,
} from "./native-task-quote.ts";
import { NEAR_NETWORK } from "./near-network.ts";
export type TaskReviewScope = {
  playerId: string;
  accountId: string;
  network: string;
  contractId: string;
  codeHash: string;
  policy: string;
};
export type CreateTaskTerms = Omit<
  TaskRequest,
  "accountId" | "codeHash" | "policy"
>;
export function taskReviewBinding(scope: TaskReviewScope) {
  return JSON.stringify([
    scope.playerId,
    scope.accountId,
    scope.network,
    scope.contractId,
    scope.codeHash,
    scope.policy,
  ]);
}
export async function reviewedTaskClientId(
  scope: TaskReviewScope,
  request: CreateTaskTerms,
) {
  if (
    !scope.playerId ||
    !scope.accountId ||
    scope.network !== NEAR_NETWORK ||
    scope.contractId !== NATIVE_TASK_CONTRACT ||
    !scope.codeHash ||
    scope.policy !== TASK_POLICY ||
    request.action !== "create" ||
    typeof request.title !== "string" ||
    typeof request.description !== "string" ||
    typeof request.area !== "string" ||
    typeof request.reference !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.contentHash || "") ||
    !/^[1-9]\d*$/.test(request.rewardYocto || "") ||
    !Number.isSafeInteger(request.dueAtMs)
  )
    throw Error(
      "Refresh and review the exact task terms before choosing a publication identity.",
    );
  const canonical = {
    version: 1,
    playerId: scope.playerId,
    accountId: scope.accountId,
    network: scope.network,
    contractId: scope.contractId,
    codeHash: scope.codeHash,
    policy: scope.policy,
    title: request.title,
    description: request.description,
    area: request.area,
    reference: request.reference,
    contentHash: request.contentHash,
    rewardYocto: request.rewardYocto,
    dueAtMs: request.dueAtMs,
  };
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  // The fingerprint is the operation ID itself: identical terms cannot acquire
  // new random identities after reload or in another same-origin tab.
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export function matchingPublishedTask(
  request: CreateTaskTerms,
  accountId: string,
  task: {
    client_id: string;
    sponsor_id: string;
    title: string;
    description: string;
    area: string;
    reference: string;
    content_hash: string;
    reward_yocto: string;
    due_at_ms: number;
  },
) {
  return (
    task.client_id === request.clientId &&
    task.sponsor_id === accountId &&
    task.title === request.title &&
    task.description === request.description &&
    task.area === request.area &&
    task.reference === request.reference &&
    task.content_hash === request.contentHash &&
    task.reward_yocto === request.rewardYocto &&
    task.due_at_ms === request.dueAtMs
  );
}
