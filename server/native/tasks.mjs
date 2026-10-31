import { assert } from "../domain.mjs";
import { nearAccountId } from "../identity/near.mjs";
import { isDeepStrictEqual } from "node:util";

export const TASK_CONTRACT = "questlayer-tasks-20261031.testnet";
export const TASK_POLICY = "sponsored-tasks-testnet-v1";
export const TASK_STORAGE = "50000000000000000000000";
const GAS = "100000000000000";
const EXPECTED = {
  policy_version: TASK_POLICY,
  network: "testnet",
  max_tasks: 128,
  max_submissions: 32,
  max_reward_yocto: "1000000000000000000000000",
  task_storage_yocto: TASK_STORAGE,
  submission_storage_yocto: TASK_STORAGE,
  min_due_delay_ms: 3600000,
  max_due_delay_ms: 1209600000,
  review_period_ms: 172800000,
  appeal_period_ms: 86400000,
  appeal_cutoff_ms: 259200000,
  resolution_cutoff_ms: 432000000,
};
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const amount = (v) =>
  typeof v === "string" &&
  /^(0|[1-9]\d{0,38})$/.test(v) &&
  BigInt(v) < 2n ** 128n;
function text(value, name, max, optional = false) {
  assert(
    typeof value === "string" &&
      Buffer.byteLength(value) <= max &&
      (optional || value.trim().length > 0) &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
    `${name} must contain ${optional ? "up to" : "1–"}${max} UTF-8 bytes.`,
  );
  return value;
}
function content(input) {
  text(input.reference, "Content reference", 256, true);
  // No remote fetching or arbitrary links. A reference is a public content address only.
  assert(
    !input.reference ||
      /^ipfs:\/\/(?:b[a-z2-7]{20,120}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(
        input.reference,
      ),
    "Use an IPFS content address without a path, or leave the reference empty.",
  );
  assert(
    typeof input.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(input.contentHash),
    "A SHA-256 content hash is required.",
  );
}
function validTask(t) {
  assert(
    t &&
      integer(t.task_id, 1, 128) &&
      integer(t.submission_count, 0, 32) &&
      integer(t.review_cursor, 0, t.submission_count),
    "Invalid task identity or count.",
    503,
  );
  nearAccountId(t.sponsor_id);
  for (const [key, max] of [
    ["title", 96],
    ["description", 512],
    ["area", 80],
    ["reference", 256],
    ["client_id", 64],
  ])
    text(t[key], key, max, key === "reference");
  assert(
    amount(t.reward_yocto) &&
      BigInt(t.reward_yocto) > 0n &&
      BigInt(t.reward_yocto) <= 10n ** 24n &&
      /^[a-f0-9]{64}$/.test(t.content_hash),
    "Invalid task reward or content digest.",
    503,
  );
  assert(
    ["open", "closing", "awarded", "refunded"].includes(t.status) &&
      typeof t.cancelled === "boolean" &&
      (t.candidate_id === null ||
        integer(t.candidate_id, 0, t.submission_count - 1)),
    "Invalid task state.",
    503,
  );
  for (const key of [
    "created_at_ms",
    "due_at_ms",
    "review_ends_at_ms",
    "appeal_ends_at_ms",
    "resolve_ends_at_ms",
  ])
    assert(integer(t[key], 1), "Invalid task deadline.", 503);
  assert(
    t.due_at_ms >= t.created_at_ms + EXPECTED.min_due_delay_ms &&
      t.due_at_ms <= t.created_at_ms + EXPECTED.max_due_delay_ms &&
      t.review_ends_at_ms === t.due_at_ms + EXPECTED.review_period_ms &&
      t.appeal_ends_at_ms === t.due_at_ms + EXPECTED.appeal_cutoff_ms &&
      t.resolve_ends_at_ms === t.due_at_ms + EXPECTED.resolution_cutoff_ms,
    "Task timing does not match the reviewed policy.",
    503,
  );
  assert(
    t.settled_at_ms === null || integer(t.settled_at_ms, t.created_at_ms),
    "Invalid task settlement.",
    503,
  );
  if (t.winner_id !== null) nearAccountId(t.winner_id);
  assert(
    (t.status === "awarded") === (t.winner_id !== null) &&
      ["awarded", "refunded"].includes(t.status) === (t.settled_at_ms !== null),
    "Inconsistent task settlement.",
    503,
  );
  return t;
}
function validSubmission(s, index, task) {
  assert(
    s &&
      s.submission_id === index &&
      integer(s.submitted_at_ms, task.created_at_ms, task.due_at_ms) &&
      ["pending", "rejected", "approved", "appealed", "expired"].includes(
        s.status,
      ),
    "Invalid submission receipt.",
    503,
  );
  nearAccountId(s.claimant_id);
  for (const evidence of [s.evidence, s.appeal].filter(Boolean)) {
    text(evidence.text, "Evidence", 512);
    text(evidence.reference, "Reference", 256, true);
    assert(
      /^[a-f0-9]{64}$/.test(evidence.content_hash),
      "Invalid evidence digest.",
      503,
    );
  }
  assert(s.evidence, "Missing evidence.", 503);
  for (const key of ["reviewed_at_ms", "resolved_at_ms", "appeal_until_ms"])
    assert(
      s[key] === null || integer(s[key], s.submitted_at_ms),
      "Invalid review deadline.",
      503,
    );
  for (const key of ["review_reason", "resolution_reason"])
    if (s[key] !== null) text(s[key], key, 256);
  return s;
}
function actions(task, submissions, actor, arbiter, now) {
  const unsettled = !["awarded", "refunded"].includes(task.status);
  const own = submissions.find((s) => s.claimant_id === actor);
  const review = submissions[task.review_cursor];
  return {
    submit:
      !!actor &&
      actor !== task.sponsor_id &&
      actor !== arbiter &&
      unsettled &&
      task.status === "open" &&
      !task.cancelled &&
      task.candidate_id === null &&
      now < task.due_at_ms &&
      !own &&
      submissions.length < 32,
    cancel:
      !!actor && actor === task.sponsor_id && unsettled && !task.cancelled,
    reviewSubmissionId:
      actor === task.sponsor_id &&
      unsettled &&
      task.candidate_id === null &&
      now < task.review_ends_at_ms &&
      review?.status === "pending"
        ? review.submission_id
        : null,
    appealSubmissionId:
      !!actor &&
      unsettled &&
      own &&
      own.resolved_at_ms === null &&
      ((own.status === "rejected" &&
        own.appeal_until_ms !== null &&
        now < own.appeal_until_ms) ||
        (own.status === "pending" &&
          now >= task.review_ends_at_ms &&
          now < task.appeal_ends_at_ms))
        ? own.submission_id
        : null,
    resolveSubmissionIds:
      actor === arbiter && unsettled && now < task.resolve_ends_at_ms
        ? submissions
            .filter((s) => s.status === "appealed")
            .map((s) => s.submission_id)
        : [],
    finalize:
      !!actor &&
      unsettled &&
      (task.cancelled || task.candidate_id !== null || now >= task.due_at_ms),
  };
}

// Read-only adapter. The authenticated wallet signs every returned transaction itself.
export class NativeTasks {
  constructor(
    db,
    provider,
    manifest,
    { clock = Date.now, cacheMs = 15000, timeoutMs = 8000 } = {},
  ) {
    this.db = db;
    this.provider = provider;
    this.manifest = manifest;
    this.clock = clock;
    this.cacheMs = cacheMs;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.pending = new Map();
    this.cacheGeneration = 0;
  }
  linked(player, account) {
    nearAccountId(account);
    assert(
      this.db
        .prepare(
          "SELECT 1 FROM wallet_links WHERE player_id=? AND account_id=?",
        )
        .get(player, account),
      "Link this NEAR wallet to this player first.",
      403,
      "WALLET_NOT_LINKED",
    );
  }
  configuration() {
    const m = this.manifest;
    assert(
      m &&
        m.schema === 1 &&
        m.network === "testnet" &&
        m.contractId === TASK_CONTRACT &&
        typeof m.codeHash === "string" &&
        m.codeHash.length > 10 &&
        m.policy === TASK_POLICY &&
        m.keyless === true,
      "Native sponsored tasks are not available: the reviewed deployment is not configured.",
      503,
      "TASKS_UNAVAILABLE",
    );
    nearAccountId(m.arbiterId);
    return m;
  }
  async bounded(promise, deadline) {
    const remaining = deadline - Date.now();
    assert(remaining > 0, "The task observation timed out.", 503);
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Task RPC timeout")),
            remaining,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async observe(account, taskId) {
    const m = this.configuration(),
      deadline = Date.now() + this.timeoutMs;
    const [status, block] = await this.bounded(
      Promise.all([
        this.provider.viewNodeStatus(),
        this.provider.viewBlock({ finality: "final" }),
      ]),
      deadline,
    );
    assert(
      status.chain_id === "testnet" && !status.sync_info?.syncing,
      "Task RPC is not a synchronized testnet node.",
      503,
    );
    const h = block?.header;
    assert(
      h &&
        typeof h.hash === "string" &&
        h.hash &&
        integer(h.height, 1) &&
        /^\d+$/.test(String(h.timestamp_nanosec ?? h.timestamp)),
      "Invalid finalized task anchor.",
      503,
    );
    const now = Number(BigInt(h.timestamp_nanosec ?? h.timestamp) / 1000000n);
    assert(
      integer(now, 1) &&
        now >= this.clock() - 120000 &&
        now <= this.clock() + 10000,
      "The finalized task observation is stale.",
      503,
    );
    const query = async (input) => {
      const r = await this.bounded(
        this.provider.query({
          ...input,
          account_id: TASK_CONTRACT,
          block_id: h.hash,
        }),
        deadline,
      );
      assert(
        r.block_hash === h.hash && r.block_height === h.height,
        "Task observation anchors differ.",
        503,
      );
      return r;
    };
    const view = async (method, args = {}) => {
      const r = await query({
        request_type: "call_function",
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      });
      assert(
        Array.isArray(r.result) && r.result.length <= 200000,
        "Task view exceeds the response limit.",
        503,
      );
      return JSON.parse(Buffer.from(r.result).toString());
    };
    const [code, keys, config, totals] = await Promise.all([
      query({ request_type: "view_account" }),
      query({ request_type: "view_access_key_list" }),
      view("get_config"),
      view("get_totals"),
    ]);
    assert(
      code.code_hash === m.codeHash &&
        Array.isArray(keys.keys) &&
        keys.keys.length === 0,
      "Task contract code or keyless ownership changed.",
      503,
    );
    assert(
      config.arbiter_id === m.arbiterId &&
        Object.entries(EXPECTED).every(([k, v]) => config[k] === v),
      "Task contract policy changed.",
      503,
    );
    const totalFields = [
      "reward_deposits_yocto",
      "open_escrow_yocto",
      "credits_yocto",
      "pending_withdrawals_yocto",
      "withdrawn_yocto",
      "awarded_yocto",
      "refunded_yocto",
      "storage_funding_yocto",
      "operating_funding_yocto",
    ];
    assert(
      totals &&
        totalFields.every((k) => amount(totals[k])) &&
        integer(totals.task_count, 0, 128) &&
        totals.conserved === true,
      "Invalid task fund totals.",
      503,
    );
    assert(
      BigInt(totals.reward_deposits_yocto) ===
        [
          "open_escrow_yocto",
          "credits_yocto",
          "pending_withdrawals_yocto",
          "withdrawn_yocto",
        ].reduce((n, k) => n + BigInt(totals[k]), 0n) &&
        BigInt(totals.reward_deposits_yocto) ===
          BigInt(totals.open_escrow_yocto) +
            BigInt(totals.awarded_yocto) +
            BigInt(totals.refunded_yocto),
      "Task escrow conservation failed.",
      503,
    );
    const [pages, balance, submissions] = await Promise.all([
      Promise.all(
        Array.from({ length: Math.ceil(totals.task_count / 50) }, (_, i) =>
          view("get_tasks", { from_index: i * 50 + 1, limit: 50 }),
        ),
      ),
      account ? view("get_account", { account_id: account }) : null,
      taskId
        ? view("get_submissions", { task_id: taskId, from_index: 0, limit: 32 })
        : [],
    ]);
    assert(
      pages.every((page) => Array.isArray(page) && page.length <= 50),
      "Invalid task page.",
      503,
    );
    const tasks = pages.flat().map(validTask);
    assert(
      tasks.length === totals.task_count &&
        tasks.every((t, i) => t.task_id === i + 1),
      "Incomplete or duplicate task pages.",
      503,
    );
    assert(
      tasks
        .filter((t) => !["awarded", "refunded"].includes(t.status))
        .reduce((n, t) => n + BigInt(t.reward_yocto), 0n) ===
        BigInt(totals.open_escrow_yocto),
      "Task escrow does not match the published tasks.",
      503,
    );
    const selected = taskId ? tasks.find((t) => t.task_id === taskId) : null;
    assert(!taskId || selected, "This task is not available.", 404);
    assert(
      Array.isArray(submissions) &&
        submissions.length <= 32 &&
        (!selected || submissions.length === selected.submission_count),
      "Incomplete task submissions.",
      503,
    );
    if (selected)
      submissions.forEach((s, i) => validSubmission(s, i, selected));
    if (balance) {
      assert(
        balance.account_id === account &&
          amount(balance.credit_yocto) &&
          (balance.pending_withdrawal === null ||
            (integer(balance.pending_withdrawal.withdrawal_id, 1) &&
              amount(balance.pending_withdrawal.amount_yocto))),
        "Invalid task account balance.",
        503,
      );
      assert(
        BigInt(balance.credit_yocto) <= BigInt(totals.credits_yocto) &&
          (!balance.pending_withdrawal ||
            BigInt(balance.pending_withdrawal.amount_yocto) <=
              BigInt(totals.pending_withdrawals_yocto)),
        "Task account credit exceeds conserved funds.",
        503,
      );
    }
    return {
      status: "available",
      network: "testnet",
      contractId: TASK_CONTRACT,
      codeHash: m.codeHash,
      policy: TASK_POLICY,
      accountId: account || "",
      observedAt: this.clock(),
      chainTime: now,
      blockHash: h.hash,
      blockHeight: h.height,
      config,
      totals,
      tasks,
      account: balance,
      selectedTaskId: taskId,
      submissions,
      actions: selected
        ? actions(selected, submissions, account, m.arbiterId, now)
        : null,
    };
  }
  async snapshot(player, account = "", fresh = false, taskId = null) {
    if (account) this.linked(player, account);
    assert(taskId === null || integer(taskId, 1, 128), "Choose a valid task.");
    const generation = this.cacheGeneration,
      key = `${account}:${taskId || ""}`,
      cached = this.cache.get(key);
    if (!fresh && cached && cached.until > this.clock()) return cached.value;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.observe(account, taskId)
        .then((value) => {
          if (generation !== this.cacheGeneration) return value;
          if (this.cache.size >= 64 && !this.cache.has(key))
            this.cache.delete(this.cache.keys().next().value);
          this.cache.set(key, { until: this.clock() + this.cacheMs, value });
          return value;
        })
        .catch(() => {
          const value = cached
            ? {
                ...cached.value,
                status: "stale",
                actions: null,
                reason:
                  "Refresh unavailable. These are previous confirmed records; actions are paused.",
              }
            : {
                status: "unavailable",
                network: "testnet",
                contractId: TASK_CONTRACT,
                accountId: account,
                selectedTaskId: taskId,
                tasks: [],
                submissions: [],
                actions: null,
                account: null,
                reason: this.manifest
                  ? "Verified task records are unavailable. Refresh to retry."
                  : "Native sponsored tasks are not deployed yet. No test NEAR can be committed here.",
              };
          // A failed forced refresh must not revive a still-TTL-cached "available" state.
          if (cached && generation === this.cacheGeneration)
            this.cache.set(key, {
              until: this.clock() + Math.min(this.cacheMs, 2000),
              value,
            });
          return value;
        });
      this.pending.set(key, pending);
    }
    let value;
    try {
      value = await pending;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
    if (account) this.linked(player, account);
    return value;
  }
  async prepare(player, input) {
    assert(input && typeof input === "object", "Choose a task action.");
    const r = input,
      account = r.accountId;
    this.linked(player, account);
    const m = this.configuration();
    assert(
      r.policy === TASK_POLICY && r.codeHash === m.codeHash,
      "Task configuration changed. Refresh before signing.",
      409,
    );
    const action = r.action,
      needsTask = !["create", "withdraw"].includes(action);
    assert(
      [
        "create",
        "submit",
        "review",
        "appeal",
        "resolve",
        "cancel",
        "finalize",
        "withdraw",
      ].includes(action),
      "Unsupported task action.",
    );
    if (needsTask) assert(integer(r.taskId, 1, 128), "Choose a valid task.");
    // Quotes deliberately bypass the read cache and recheck wallet linkage after RPC work.
    const state = await this.observe(account, needsTask ? r.taskId : null);
    this.linked(player, account);
    let methodName,
      args = {},
      deposit = "0";
    if (action === "create") {
      assert(
        account !== m.arbiterId,
        "The pilot arbiter cannot sponsor tasks.",
        403,
      );
      assert(
        typeof r.clientId === "string" &&
          /^[A-Za-z0-9_-]{1,64}$/.test(r.clientId),
        "Invalid publication operation ID.",
      );
      text(r.title, "Title", 96);
      text(r.description, "Requirements", 512);
      text(r.area, "Public area", 80);
      content(r);
      assert(
        amount(r.rewardYocto) &&
          BigInt(r.rewardYocto) >= 10n ** 21n &&
          BigInt(r.rewardYocto) <= 10n ** 24n,
        "The pilot accepts rewards from 0.001 to 1 test NEAR.",
      );
      assert(
        integer(
          r.dueAtMs,
          state.chainTime + EXPECTED.min_due_delay_ms,
          state.chainTime + EXPECTED.max_due_delay_ms,
        ),
        "Choose a submission deadline between one hour and fourteen days from now.",
      );
      assert(
        state.tasks.length < 128 &&
          !state.tasks.some(
            (t) => t.sponsor_id === account && t.client_id === r.clientId,
          ),
        "This publication already exists or the pilot is full. Refresh your tasks.",
        409,
      );
      methodName = "create_task";
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
    } else if (action === "withdraw") {
      assert(
        BigInt(state.account.credit_yocto) > 0n &&
          state.account.pending_withdrawal === null,
        "No task credit is ready to withdraw.",
        409,
      );
      methodName = "withdraw";
      deposit = "1";
    } else {
      const a = state.actions;
      args = { task_id: r.taskId };
      if (action === "submit" || action === "appeal") {
        text(r.text, "Evidence text", 512);
        content(r);
        if (action === "submit") {
          assert(
            a.submit,
            "This wallet cannot submit evidence to this task now.",
            409,
          );
          methodName = "submit_evidence";
          deposit = TASK_STORAGE;
        } else {
          assert(
            integer(r.submissionId) && a.appealSubmissionId === r.submissionId,
            "This evidence is not open for your appeal.",
            409,
          );
          methodName = "appeal_submission";
          args.submission_id = r.submissionId;
        }
        Object.assign(args, {
          text: r.text,
          reference: r.reference,
          content_hash: r.contentHash,
        });
      } else if (action === "review" || action === "resolve") {
        assert(
          integer(r.submissionId) &&
            (action === "review"
              ? a.reviewSubmissionId === r.submissionId
              : a.resolveSubmissionIds.includes(r.submissionId)),
          "Only the authorized reviewer can decide this evidence in its current order.",
          403,
        );
        assert(typeof r.approved === "boolean", "Choose approve or reject.");
        text(r.reason, "Decision reason", 256);
        methodName =
          action === "review" ? "review_submission" : "resolve_appeal";
        Object.assign(args, {
          submission_id: r.submissionId,
          approved: r.approved,
          reason: r.reason,
        });
      } else {
        assert(
          a[action],
          "This action is not available for this task now.",
          409,
        );
        methodName = action === "cancel" ? "cancel_task" : "finalize_task";
      }
    }
    this.linked(player, account);
    return {
      network: "testnet",
      contractId: TASK_CONTRACT,
      receiverId: TASK_CONTRACT,
      signerId: account,
      codeHash: m.codeHash,
      policy: TASK_POLICY,
      methodName,
      args,
      deposit,
      gas: GAS,
      expiresAt: this.clock() + 60000,
      blockHash: state.blockHash,
      blockHeight: state.blockHeight,
    };
  }
  async confirmTransaction(player, input = {}) {
    this.linked(player, input.accountId);
    const policy = this.configuration();
    try {
      return await this.confirm(player, {
        ...input,
        quote: {
          ...input.quote,
          contractId: policy.contractId,
          codeHash: policy.codeHash,
          policy: policy.policy,
        },
      });
    } catch (error) {
      if (error.code === "TASK_TRANSACTION_FAILED")
        error.code = "NATIVE_TRANSACTION_FAILED";
      if (error.code === "TASK_WITHDRAWAL_FAILED")
        error.code = "NATIVE_OPERATION_NOT_COMPLETED";
      throw error;
    }
  }
  async confirm(player, { accountId, quote, transactionHash } = {}) {
    this.linked(player, accountId);
    const manifest = this.configuration();
    const methods = new Set([
      "create_task",
      "submit_evidence",
      "review_submission",
      "appeal_submission",
      "resolve_appeal",
      "cancel_task",
      "finalize_task",
      "withdraw",
    ]);
    assert(
      typeof transactionHash === "string" &&
        /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(transactionHash),
      "The wallet did not return a valid transaction hash.",
    );
    assert(
      quote &&
        quote.network === "testnet" &&
        quote.receiverId === TASK_CONTRACT &&
        quote.contractId === TASK_CONTRACT &&
        quote.codeHash === manifest.codeHash &&
        quote.policy === TASK_POLICY &&
        quote.signerId === accountId &&
        quote.gas === GAS &&
        methods.has(quote.methodName) &&
        amount(quote.deposit) &&
        quote.args &&
        typeof quote.args === "object" &&
        !Array.isArray(quote.args) &&
        JSON.stringify(quote.args).length <= 8192,
      "The task confirmation context does not match the reviewed contract.",
      409,
    );
    // This is a receipt comparison, not fresh authorization. An already executed
    // action is not prepared again, and its original quote may now have expired.
    await this.observe(accountId, null);
    this.linked(player, accountId);
    const result = await this.bounded(
      this.provider.viewTransactionStatus({
        txHash: transactionHash,
        accountId,
        waitUntil: "FINAL",
      }),
      Date.now() + this.timeoutMs,
    );
    this.linked(player, accountId);
    assert(
      result?.final_execution_status === "FINAL",
      "The task transaction is not final yet. Refresh its confirmation before retrying the action.",
      409,
      "TASK_TRANSACTION_PENDING",
    );
    const transaction = result.transaction;
    assert(
      transaction &&
        transaction.hash === transactionHash &&
        transaction.signer_id === accountId &&
        transaction.receiver_id === TASK_CONTRACT &&
        Array.isArray(transaction.actions) &&
        transaction.actions.length === 1,
      "The confirmed transaction belongs to a different wallet, contract or action.",
      409,
    );
    const action = transaction.actions[0],
      call = action?.FunctionCall;
    assert(
      action &&
        Object.keys(action).length === 1 &&
        call &&
        call.method_name === quote.methodName &&
        ((typeof call.gas === "number" && integer(call.gas)) ||
          typeof call.gas === "string") &&
        String(call.gas) === quote.gas &&
        call.deposit === quote.deposit,
      "The confirmed transaction changed the selected method, gas or deposit.",
      409,
    );
    function decodeJson(encoded) {
      assert(
        typeof encoded === "string" &&
          encoded.length <= 32768 &&
          encoded.length % 4 === 0 &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
        "The confirmed transaction contains invalid encoded data.",
        409,
      );
      const bytes = Buffer.from(encoded, "base64");
      assert(
        bytes.toString("base64") === encoded,
        "The confirmed transaction data is not canonical base64.",
        409,
      );
      try {
        return JSON.parse(bytes.toString("utf8"));
      } catch {
        assert(false, "The confirmed transaction contains invalid JSON.", 409);
      }
    }
    assert(
      isDeepStrictEqual(decodeJson(call.args), quote.args),
      "The confirmed task arguments differ from the reviewed action.",
      409,
    );
    assert(
      result.status &&
        typeof result.status === "object" &&
        !Array.isArray(result.status) &&
        Object.keys(result.status).length === 1,
      "The task receipt has an invalid final status. Keep its reference for another check.",
      409,
    );
    assert(
      !Object.hasOwn(result.status, "Failure"),
      "The task transaction failed. Refresh the task record before retrying.",
      409,
      "TASK_TRANSACTION_FAILED",
    );
    assert(
      typeof result.status.SuccessValue === "string",
      "The task receipt has no final outcome. Keep its reference for another check.",
      409,
    );
    const outcomes = [
      ...(result.transaction_outcome ? [result.transaction_outcome] : []),
      ...(Array.isArray(result.receipts_outcome)
        ? result.receipts_outcome
        : []),
    ];
    assert(outcomes.length <= 128, "Too many task receipts to verify.", 409);
    assert(
      outcomes.every((receipt) => !receipt?.outcome?.status?.Failure),
      "A task transaction receipt failed. Refresh its current record before retrying.",
      409,
      "TASK_TRANSACTION_FAILED",
    );
    if (quote.methodName === "withdraw")
      assert(
        decodeJson(result.status.SuccessValue) === true,
        "The withdrawal did not complete. Its credit was restored; refresh before retrying.",
        409,
        "TASK_WITHDRAWAL_FAILED",
      );
    this.linked(player, accountId);
    // Do not let an older in-flight observation repopulate a confirmed-action cache.
    this.cacheGeneration++;
    this.cache.clear();
    this.pending.clear();
    return {
      confirmed: true,
      network: "testnet",
      contractId: TASK_CONTRACT,
      accountId,
      transactionHash,
    };
  }
}
