export const NATIVE_TASK_CONTRACT = "questlayer-tasks-20261031.testnet";
export const TASK_POLICY = "sponsored-tasks-testnet-v1";
export const TASK_STORAGE = "50000000000000000000000";
export const TASK_GAS = "100000000000000";
export type TaskAction =
  | "create"
  | "submit"
  | "review"
  | "appeal"
  | "resolve"
  | "cancel"
  | "finalize"
  | "withdraw";
export type TaskRequest = {
  accountId: string;
  action: TaskAction;
  codeHash: string;
  policy: string;
  clientId?: string;
  title?: string;
  description?: string;
  reference?: string;
  contentHash?: string;
  area?: string;
  rewardYocto?: string;
  dueAtMs?: number;
  taskId?: number;
  submissionId?: number;
  approved?: boolean;
  reason?: string;
  text?: string;
};
export type TaskQuote = {
  network: string;
  signerId: string;
  receiverId: string;
  contractId: string;
  codeHash: string;
  policy: string;
  methodName: string;
  args: Record<string, unknown>;
  deposit: string;
  gas: string;
  expiresAt: number;
  blockHash: string;
  blockHeight: number;
};

export function parseTaskReward(text: string): string {
  if (!/^(0|1)(\.\d{1,24})?$/.test(text))
    throw Error(
      "Enter a test NEAR reward between 0.001 and 1, using plain decimals.",
    );
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, "0"));
  if (value < 10n ** 21n || value > 10n ** 24n)
    throw Error("Choose a reward between 0.001 and 1 test NEAR.");
  return value.toString();
}
export function exactTaskNear(yocto: string): string {
  if (!/^(0|[1-9]\d{0,38})$/.test(yocto)) throw Error("Invalid native amount.");
  const n = BigInt(yocto),
    f = (n % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${n / 10n ** 24n}${f ? "." + f : ""}`;
}
export function exactTaskGold(yocto: string): string {
  if (!/^(0|[1-9]\d{0,38})$/.test(yocto)) throw Error("Invalid native amount.");
  const n = BigInt(yocto),
    f = (n % 10n ** 21n).toString().padStart(21, "0").replace(/0+$/, "");
  return `${n / 10n ** 21n}${f ? "." + f : ""}`;
}
function equalArgs(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  return (
    actual &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.keys(expected).every((key) => actual[key] === expected[key])
  );
}
export function taskTransaction(r: TaskRequest) {
  const methods: Record<TaskAction, string> = {
    create: "create_task",
    submit: "submit_evidence",
    review: "review_submission",
    appeal: "appeal_submission",
    resolve: "resolve_appeal",
    cancel: "cancel_task",
    finalize: "finalize_task",
    withdraw: "withdraw",
  };
  let args: Record<string, unknown> = {},
    deposit = "0";
  if (r.action === "create") {
    if (
      !r.rewardYocto ||
      !/^[1-9]\d{0,24}$/.test(r.rewardYocto) ||
      BigInt(r.rewardYocto) > 10n ** 24n
    )
      throw Error("Invalid task reward.");
    args = {
      client_id: r.clientId,
      title: r.title,
      description: r.description,
      reference: r.reference,
      content_hash: r.contentHash,
      area: r.area,
      reward_yocto: r.rewardYocto,
      due_at_ms: r.dueAtMs,
    };
    deposit = (BigInt(r.rewardYocto) + BigInt(TASK_STORAGE)).toString();
  } else if (r.action === "withdraw") deposit = "1";
  else {
    args = { task_id: r.taskId };
    if (["review", "appeal", "resolve"].includes(r.action))
      args.submission_id = r.submissionId;
    if (["submit", "appeal"].includes(r.action)) {
      args.text = r.text;
      args.reference = r.reference;
      args.content_hash = r.contentHash;
    }
    if (["review", "resolve"].includes(r.action)) {
      args.approved = r.approved;
      args.reason = r.reason;
    }
    if (r.action === "submit") deposit = TASK_STORAGE;
  }
  if (!methods[r.action] || Object.values(args).some((v) => v === undefined))
    throw Error("Incomplete task action.");
  return { methodName: methods[r.action], args, deposit };
}
export function assertTaskQuote(
  q: TaskQuote,
  r: TaskRequest,
  now = Date.now(),
) {
  const expected = taskTransaction(r);
  if (
    !q ||
    q.network !== "testnet" ||
    q.signerId !== r.accountId ||
    q.receiverId !== NATIVE_TASK_CONTRACT ||
    q.contractId !== NATIVE_TASK_CONTRACT ||
    !r.codeHash ||
    q.codeHash !== r.codeHash ||
    q.policy !== TASK_POLICY ||
    r.policy !== TASK_POLICY ||
    q.methodName !== expected.methodName ||
    !equalArgs(q.args, expected.args) ||
    q.deposit !== expected.deposit ||
    q.gas !== TASK_GAS ||
    !Number.isSafeInteger(q.expiresAt) ||
    q.expiresAt <= now ||
    q.expiresAt > now + 120000 ||
    typeof q.blockHash !== "string" ||
    !q.blockHash ||
    !Number.isSafeInteger(q.blockHeight) ||
    q.blockHeight < 1
  )
    throw Error(
      "This transaction differs from your task action or its quote expired. Refresh before signing.",
    );
}
