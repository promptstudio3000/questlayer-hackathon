import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  CaretRight,
  CheckCircle,
  Clock,
  Flag,
  Plus,
  ShieldCheck,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "./api";
import type { Player } from "./types";
import { useFormDraft } from "./useFormDraft";
import { createReadEpoch } from "./read-epoch";
import {
  matchingPublishedTask,
  reviewedTaskClientId,
  taskReviewBinding,
  type TaskReviewScope,
} from "./native-task-draft";
import {
  exactTaskGold,
  exactTaskNear,
  parseTaskReward,
  TASK_POLICY,
  TASK_STORAGE,
  NATIVE_TASK_CONTRACT,
  type TaskRequest,
} from "./native-task-quote";
import "./native-tasks.css";
import { NEAR_NETWORK } from "./near-network.ts";

export type NativeTask = {
  task_id: number;
  client_id: string;
  sponsor_id: string;
  title: string;
  description: string;
  area: string;
  reference: string;
  content_hash: string;
  reward_yocto: string;
  created_at_ms: number;
  due_at_ms: number;
  review_ends_at_ms: number;
  appeal_ends_at_ms: number;
  resolve_ends_at_ms: number;
  status: "open" | "closing" | "awarded" | "refunded";
  cancelled: boolean;
  submission_count: number;
  review_cursor: number;
  candidate_id: number | null;
  winner_id: string | null;
  settled_at_ms: number | null;
};
type Evidence = { text: string; reference: string; content_hash: string };
export type TaskSubmission = {
  submission_id: number;
  claimant_id: string;
  submitted_at_ms: number;
  status: "pending" | "rejected" | "approved" | "appealed" | "expired";
  evidence: Evidence;
  appeal: Evidence | null;
  reviewed_at_ms: number | null;
  review_reason: string | null;
  appeal_until_ms: number | null;
  resolved_at_ms: number | null;
  resolution_reason: string | null;
};
export type TaskSnapshot = {
  status: "available" | "stale" | "unavailable";
  network: string;
  contractId: string;
  accountId: string;
  codeHash?: string;
  policy?: string;
  observedAt?: number;
  chainTime?: number;
  blockHash?: string;
  blockHeight?: number;
  reason?: string;
  config?: {
    arbiter_id: string;
    task_storage_yocto: string;
    submission_storage_yocto: string;
    max_tasks: number;
    max_reward_yocto: string;
  };
  totals?: Record<string, string | number | boolean>;
  tasks: NativeTask[];
  selectedTaskId: number | null;
  submissions: TaskSubmission[];
  account: {
    account_id: string;
    credit_yocto: string;
    pending_withdrawal: { withdrawal_id: number; amount_yocto: string } | null;
  } | null;
  actions: {
    submit: boolean;
    cancel: boolean;
    reviewSubmissionId: number | null;
    appealSubmissionId: number | null;
    resolveSubmissionIds: number[];
    finalize: boolean;
  } | null;
};
const readConfirmedTasks = (
  account: string,
  fresh: boolean,
  taskId: number | null,
) =>
  api<TaskSnapshot>(
    `/native/tasks?accountId=${encodeURIComponent(account)}&refresh=${fresh ? "1" : "0"}${taskId ? `&taskId=${taskId}` : ""}`,
  );
const time = (n: number) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(n);
const localDate = (n: number) => {
  const d = new Date(n);
  return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const CREATE_DRAFT_FIELDS = {
  title: 96,
  area: 80,
  requirements: 512,
  reward: 100,
  due: 32,
} as const;
const EVIDENCE_DRAFT_FIELDS = { evidence: 512, reference: 256 } as const;
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
function RewardCoin() {
  return (
    <svg
      className="task-reward-art"
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path
        fill="#39175c"
        d="M7 1h10v3h4v4h2v8h-2v4h-4v3H7v-3H3v-4H1V8h2V4h4z"
      />
      <path
        fill="#f7b83d"
        d="M8 3h8v3h4v3h1v6h-1v3h-4v3H8v-3H4v-3H3V9h1V6h4z"
      />
      <path fill="#ffe697" d="M8 5h8v3H8zM5 8h3v8H5z" />
      <path fill="#a75c11" d="M12 8h3v8h-3zM9 11h3v3H9z" />
    </svg>
  );
}
function TaskReward({ value }: { value: string }) {
  return (
    <span className="task-reward">
      <RewardCoin />
      <span>
        <strong>{exactTaskGold(value)} GOLD</strong>
        <small>{exactTaskNear(value)} test NEAR</small>
      </span>
    </span>
  );
}

export function NativeTasks({
  player,
  onConnect,
  onTransaction,
  readTasks = readConfirmedTasks,
}: {
  player: Player;
  onConnect: () => void;
  onTransaction: (request: TaskRequest) => Promise<boolean>;
  readTasks?: (
    account: string,
    fresh: boolean,
    taskId: number | null,
  ) => Promise<TaskSnapshot>;
}) {
  const [account, setAccount] = useState(player.wallets[0]?.account_id || ""),
    [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null),
    [snapshotOwner, setSnapshotOwner] = useState(""),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [creating, setCreating] = useState(false),
    [reviewFunding, setReviewFunding] = useState(false),
    [publicAck, setPublicAck] = useState(false),
    [reason, setReason] = useState(""),
    [reviewBinding, setReviewBinding] = useState<string | null>(null),
    [ackBinding, setAckBinding] = useState<string | null>(null),
    [createRevision, setCreateRevision] = useState<string | null>(null),
    [createRequest, setCreateRequest] = useState<Omit<
      TaskRequest,
      "accountId" | "codeHash" | "policy"
    > | null>(null);
  const identity = JSON.stringify([player.id, account, selectedId]),
    latest = useRef(identity),
    mounted = useRef(true),
    generation = useRef(0),
    operations = useRef(createReadEpoch()),
    operationContext = useRef(identity),
    heading = useRef<HTMLHeadingElement>(null);
  latest.current = identity;
  if (operationContext.current !== identity) {
    operations.current.invalidate();
    operationContext.current = identity;
  }
  const data =
    snapshotOwner === identity &&
    snapshot?.accountId === account &&
    snapshot.selectedTaskId === selectedId
      ? snapshot
      : null;
  const fresh =
    data?.status === "available" &&
    player.wallets.some((w) => w.account_id === account) &&
    data.network === NEAR_NETWORK &&
    data.contractId === NATIVE_TASK_CONTRACT &&
    !!data.codeHash &&
    data.policy === TASK_POLICY;
  const task = data?.tasks.find((t) => t.task_id === selectedId);
  const canAct = !!fresh && !busy && !loading && !!account;
  const caps = fresh ? data?.actions : null;
  const reviewScope: TaskReviewScope = {
    playerId: player.id,
    accountId: account,
    network: data?.network || "",
    contractId: data?.contractId || "",
    codeHash: data?.codeHash || "",
    policy: data?.policy || "",
  };
  const binding = fresh ? taskReviewBinding(reviewScope) : null;
  const latestBinding = useRef(binding);
  latestBinding.current = binding;
  const createInitial = useMemo(
    () => ({
      title: "",
      area: "",
      requirements: "",
      reward: "0.1",
      due: localDate(Date.now() + 2 * 86400000),
    }),
    [player.id, account],
  );
  const draftRealm = `${NEAR_NETWORK}:${NATIVE_TASK_CONTRACT}:${account || "guest"}`;
  const createDraft = useFormDraft({
    playerId: player.id,
    form: "native-task-create",
    realm: draftRealm,
    fields: CREATE_DRAFT_FIELDS,
    initial: createInitial,
  });
  const { title, area, requirements, reward, due } = createDraft.values;
  const setTitle = (value: string) => createDraft.setField("title", value);
  const setArea = (value: string) => createDraft.setField("area", value);
  const setRequirements = (value: string) =>
    createDraft.setField("requirements", value);
  const setReward = (value: string) => createDraft.setField("reward", value);
  const setDue = (value: string) => createDraft.setField("due", value);
  const createTerms = JSON.stringify(createDraft.values);
  const latestCreateTerms = useRef(createTerms);
  latestCreateTerms.current = createTerms;
  const evidenceRealm = `${draftRealm}:task:${selectedId ?? "none"}:stage:${caps?.appealSubmissionId !== null && caps?.appealSubmissionId !== undefined ? `appeal-${caps.appealSubmissionId}` : "submit"}`;
  const evidenceDraft = useFormDraft({
    playerId: player.id,
    form: "native-task-evidence",
    realm: evidenceRealm,
    fields: EVIDENCE_DRAFT_FIELDS,
    initial: { evidence: "", reference: "" },
  });
  const { evidence, reference } = evidenceDraft.values;
  const setEvidence = (value: string) => {
    evidenceDraft.setField("evidence", value);
    setPublicAck(false);
  };
  const setReference = (value: string) => {
    evidenceDraft.setField("reference", value);
    setPublicAck(false);
  };
  const acknowledgementScope = JSON.stringify([
    binding,
    creating ? "create" : evidenceRealm,
  ]);
  const publicAckValid =
    publicAck && ackBinding === acknowledgementScope && !!binding;
  const latestAck = useRef(publicAckValid);
  latestAck.current = publicAckValid;
  const evidenceTerms = JSON.stringify(evidenceDraft.values);
  const latestEvidenceTerms = useRef(evidenceTerms);
  latestEvidenceTerms.current = evidenceTerms;
  const ownSubmission = data?.submissions.find(
    (s) => s.claimant_id === account,
  );
  const reviewSubmission = data?.submissions.find(
    (s) => s.submission_id === caps?.reviewSubmissionId,
  );
  const [resolveId, setResolveId] = useState<number | null>(null);
  const resolving =
    resolveId === null
      ? null
      : data?.submissions.find(
          (s) =>
            s.submission_id === resolveId &&
            caps?.resolveSubmissionIds.includes(resolveId),
        );

  async function refresh(force = true) {
    const who = identity,
      seq = ++generation.current;
    setLoading(true);
    try {
      const next = await readTasks(account, force, selectedId);
      if (
        mounted.current &&
        latest.current === who &&
        generation.current === seq
      ) {
        setSnapshot(next);
        setSnapshotOwner(who);
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        latest.current === who &&
        generation.current === seq
      ) {
        setSnapshot(null);
        setError((e as Error).message);
      }
    } finally {
      if (
        mounted.current &&
        latest.current === who &&
        generation.current === seq
      )
        setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operations.current.invalidate();
    };
  }, []);
  useEffect(() => {
    void refresh(false);
    setBusy(false);
    setPublicAck(false);
    setResolveId(null);
    setReviewFunding(false);
    setCreateRequest(null);
  }, [identity]);
  useEffect(() => {
    setPublicAck(false);
    setAckBinding(null);
    setReviewFunding(false);
    setCreateRequest(null);
    setReviewBinding(null);
  }, [binding]);
  useEffect(() => {
    if (!player.wallets.some((w) => w.account_id === account))
      setAccount(player.wallets[0]?.account_id || "");
  }, [player.wallets.map((w) => w.account_id).join("|"), account]);
  useEffect(() => {
    heading.current?.focus();
  }, [selectedId, creating, reviewFunding]);
  function reopenExistingCreation(
    request: Omit<TaskRequest, "accountId" | "codeHash" | "policy">,
    revision: string | null,
  ) {
    const existing = data?.tasks.find(
      (t) => t.sponsor_id === account && t.client_id === request.clientId,
    );
    if (!existing) return false;
    if (!matchingPublishedTask(request, account, existing)) {
      setError(
        "This publication identity already has different task terms. Check the existing record before funding anything.",
      );
      return true;
    }
    createDraft.discard(revision);
    setCreating(false);
    setSelectedId(existing.task_id);
    setReviewFunding(false);
    setCreateRequest(null);
    setPublicAck(false);
    setNotice(
      "This exact task is already published. Its confirmed record is open; no new funding is needed.",
    );
    return true;
  }
  async function run(
    request: Omit<TaskRequest, "accountId" | "codeHash" | "policy">,
  ) {
    if (
      !canAct ||
      !data?.codeHash ||
      !mounted.current ||
      latest.current !== identity ||
      latestBinding.current !== binding
    )
      return;
    if (
      request.action === "create" &&
      (!reviewFunding || reviewBinding !== binding)
    ) {
      setError(
        "The account, contract or policy changed. Review funding again before signing.",
      );
      return;
    }
    if (
      ["create", "submit", "appeal"].includes(request.action) &&
      (!publicAckValid || !latestAck.current)
    ) {
      setError(
        "Review the public information and current cost before signing.",
      );
      return;
    }
    const who = identity;
    const submittedCreateRevision = createRevision;
    if (
      request.action === "create" &&
      reopenExistingCreation(request, submittedCreateRevision)
    )
      return;
    const submittedEvidenceRevision = evidenceDraft.revision;
    const operation = operations.current.begin(who);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const ok = await onTransaction({
        ...request,
        accountId: account,
        codeHash: data.codeHash,
        policy: TASK_POLICY,
      });
      if (
        !mounted.current ||
        !operations.current.isCurrent(operation, latest.current)
      )
        return;
      if (ok) {
        setNotice(
          "Wallet transaction confirmed. Check the updated task record below.",
        );
        if (request.action === "create") {
          setCreating(false);
          setReviewFunding(false);
          setCreateRequest(null);
          createDraft.discard(submittedCreateRevision);
          setPublicAck(false);
        }
        if (["submit", "appeal"].includes(request.action)) {
          evidenceDraft.discard(submittedEvidenceRevision);
          setPublicAck(false);
        }
        setReason("");
        await refresh();
      } else
        setNotice(
          "No confirmed transaction. Your entries are kept; refresh before retrying.",
        );
    } catch (e) {
      if (
        mounted.current &&
        operations.current.isCurrent(operation, latest.current)
      )
        setError((e as Error).message);
    } finally {
      if (
        mounted.current &&
        operations.current.isCurrent(operation, latest.current)
      )
        setBusy(false);
    }
  }
  async function prepareCreate() {
    const who = identity;
    if (!canAct || !binding || !mounted.current || latest.current !== who)
      return;
    const operation = operations.current.begin(who);
    try {
      const reviewedBinding = binding,
        reviewedTerms = createTerms;
      const amount = parseTaskReward(reward),
        deadline = new Date(due).getTime();
      const fields = {
        title: title.trim(),
        description: requirements.trim(),
        area: area.trim(),
        reference: "",
      };
      const limits = { title: 96, description: 512, area: 80 };
      for (const key of Object.keys(limits) as (keyof typeof limits)[])
        if (
          !fields[key] ||
          new TextEncoder().encode(fields[key]).length > limits[key]
        )
          throw Error(
            `${key === "description" ? "Requirements" : key} must use 1–${limits[key]} UTF-8 bytes.`,
          );
      if (
        !Number.isSafeInteger(deadline) ||
        deadline < Date.now() + 3600000 ||
        deadline > Date.now() + 1209600000
      )
        throw Error(
          "Set a deadline between one hour and fourteen days from now.",
        );
      const request = {
        action: "create",
        ...fields,
        rewardYocto: amount,
        dueAtMs: deadline,
        contentHash: await digest(fields),
      } as Omit<TaskRequest, "accountId" | "codeHash" | "policy">;
      request.clientId = await reviewedTaskClientId(reviewScope, request);
      if (
        !mounted.current ||
        !operations.current.isCurrent(operation, latest.current) ||
        latestBinding.current !== reviewedBinding ||
        latestCreateTerms.current !== reviewedTerms
      )
        throw Error(
          "The task entries or account changed. Review the current terms again.",
        );
      if (reopenExistingCreation(request, createDraft.revision)) return;
      setCreateRequest(request);
      setReviewBinding(reviewedBinding);
      setCreateRevision(createDraft.revision);
      setReviewFunding(true);
      setPublicAck(false);
      setError("");
    } catch (e) {
      if (
        mounted.current &&
        operations.current.isCurrent(operation, latest.current)
      )
        setError((e as Error).message);
    }
  }
  async function submitEvidence() {
    const who = identity,
      terms = evidenceTerms;
    if (
      !canAct ||
      !publicAckValid ||
      !mounted.current ||
      latest.current !== who
    )
      return;
    const operation = operations.current.begin(who);
    try {
      const text = evidence.trim(),
        ref = reference.trim();
      if (!text || new TextEncoder().encode(text).length > 512)
        throw Error("Evidence must contain 1–512 UTF-8 bytes.");
      if (
        ref &&
        !/^ipfs:\/\/(?:b[a-z2-7]{20,120}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/.test(ref)
      )
        throw Error(
          "Enter an IPFS content address without a path, or leave it empty.",
        );
      const appealId = caps?.appealSubmissionId;
      const contentHash = await digest({ text, reference: ref });
      if (
        !mounted.current ||
        !operations.current.isCurrent(operation, latest.current) ||
        latestEvidenceTerms.current !== terms ||
        !latestAck.current
      )
        throw Error(
          "The evidence or account changed. Review the current public information again.",
        );
      await run({
        action:
          appealId !== null && appealId !== undefined ? "appeal" : "submit",
        taskId: selectedId!,
        ...(appealId !== null && appealId !== undefined
          ? { submissionId: appealId }
          : {}),
        text,
        reference: ref,
        contentHash,
      });
    } catch (e) {
      if (
        mounted.current &&
        operations.current.isCurrent(operation, latest.current)
      )
        setError((e as Error).message);
    }
  }
  const publicNotice = (
    <p className="task-public">
      <WarningCircle aria-hidden="true" />
      This text, wallet and content reference become public chain records. They
      cannot be erased. Do not include private details, exact GPS or photos.
    </p>
  );
  const acknowledgement = (
    <label className="task-check">
      <input
        type="checkbox"
        checked={publicAckValid}
        onChange={(e) => {
          setPublicAck(e.target.checked);
          setAckBinding(e.target.checked ? acknowledgementScope : null);
        }}
        disabled={busy}
      />
      <span>I understand the public record and the cost shown.</span>
    </label>
  );

  return (
    <section
      className="native-tasks"
      aria-label="Native sponsored tasks"
      aria-busy={loading || busy}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          busy ||
          (event.target instanceof HTMLElement &&
            event.target.closest("input,textarea,select,[contenteditable]"))
        )
          return;
        if (!creating && selectedId === null) return;
        event.preventDefault();
        event.stopPropagation();
        setPublicAck(false);
        if (reviewFunding) setReviewFunding(false);
        else if (creating) setCreating(false);
        else setSelectedId(null);
      }}
    >
      <div className="task-heading">
        <div>
          <span className="task-eyebrow">NEAR testnet pilot</span>
          <h2 ref={heading} tabIndex={-1}>
            {creating
              ? reviewFunding
                ? "Review funding"
                : "Sponsor a task"
              : task
                ? task.title
                : "Community tasks"}
          </h2>
        </div>
        <button
          className="task-icon"
          aria-label="Refresh native tasks"
          onClick={() => void refresh()}
          disabled={busy || loading}
        >
          <ArrowClockwise />
        </button>
      </div>
      <p className="task-intro">
        A sponsor locks one reward. Share evidence, get reviewed, then withdraw
        an approved award.
      </p>
      {player.wallets.length > 0 ? (
        <label className="task-wallet">
          Task wallet
          <select
            value={account}
            disabled={busy}
            onChange={(e) => {
              setAccount(e.target.value);
              setNotice("");
            }}
          >
            {player.wallets.map((w) => (
              <option key={w.account_id}>{w.account_id}</option>
            ))}
          </select>
        </label>
      ) : (
        <button className="secondary-button" onClick={onConnect}>
          <Wallet />
          Connect NEAR wallet
        </button>
      )}
      {error && (
        <p className="task-alert" role="alert">
          <WarningCircle />
          {error}
        </p>
      )}
      {notice && (
        <p className="task-notice" role="status">
          {notice}
        </p>
      )}
      {loading && !data && <p role="status">Reading confirmed task records…</p>}
      {data?.status !== "available" && data && (
        <p className="task-alert" role="status">
          {data.reason}
        </p>
      )}
      {busy && (
        <p className="task-notice" role="status">
          Check your wallet. The result is not confirmed yet.
        </p>
      )}
      {creating ? (
        <>
          <button
            className="task-back"
            disabled={busy}
            onClick={() => {
              if (reviewFunding) setReviewFunding(false);
              else setCreating(false);
              setPublicAck(false);
            }}
          >
            <ArrowLeft />
            {reviewFunding ? "Edit task" : "Back to tasks"}
          </button>
          {!reviewFunding ? (
            <form
              className="task-form"
              onSubmit={(e) => {
                e.preventDefault();
                void prepareCreate();
              }}
            >
              {createDraft.hasDraft && (
                <p className="task-secondary" role="status">
                  {createDraft.storageAvailable
                    ? "Draft entries are kept on this device. Funding review and public consent are never restored."
                    : "Entries remain in this tab; browser storage is unavailable. Keep this page open."}
                </p>
              )}
              <label>
                Task title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={96}
                  required
                  placeholder="Find the oldest public bridge plaque"
                />
              </label>
              <label>
                Public area
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  maxLength={80}
                  required
                  placeholder="Plzeň · city centre"
                />
                <small>
                  Use a neighbourhood or public landmark, without precise
                  coordinates.
                </small>
              </label>
              <label>
                Completion requirements
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  maxLength={512}
                  required
                  rows={4}
                  placeholder="Read the year on a public plaque and describe where it is. Stay on public paths."
                />
              </label>
              <label>
                Reward in test NEAR
                <input
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  inputMode="decimal"
                  required
                  aria-describedby="task-reward-help"
                />
                <small id="task-reward-help">
                  0.001–1 test NEAR · 1 NEAR = 1,000 GOLD
                </small>
              </label>
              <label>
                Submit evidence by
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  required
                />
                <small>
                  Your local time. One hour to fourteen days from publication.
                </small>
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={!canAct}
              >
                Review funding
                <CaretRight />
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  const removed = createDraft.discard();
                  setReviewFunding(false);
                  setCreateRequest(null);
                  setPublicAck(false);
                  setNotice(
                    removed
                      ? "Draft entries cleared. Any pending wallet transaction still requires recovery."
                      : "Entries cleared from this view. Browser storage could not remove the saved draft; it may return. Any pending wallet transaction still requires recovery.",
                  );
                }}
              >
                Discard task draft
              </button>
            </form>
          ) : (
            createRequest && (
              <div className="task-funding">
                <h3>{createRequest.title}</h3>
                <p>{createRequest.area}</p>
                <p className="task-requirements">{createRequest.description}</p>
                <TaskReward value={createRequest.rewardYocto!} />
                <dl>
                  <div>
                    <dt>Locked prize</dt>
                    <dd>
                      {exactTaskNear(createRequest.rewardYocto!)} test NEAR
                    </dd>
                  </div>
                  <div>
                    <dt>Non-refundable storage</dt>
                    <dd>0.05 test NEAR</dd>
                  </div>
                  <div>
                    <dt>Total attached</dt>
                    <dd>
                      {exactTaskNear(
                        (
                          BigInt(createRequest.rewardYocto!) +
                          BigInt(TASK_STORAGE)
                        ).toString(),
                      )}{" "}
                      test NEAR
                    </dd>
                  </div>
                </dl>
                <p>
                  Network fee is extra. The prize stays locked through review
                  and appeals; cancellation does not erase submitted claims. No
                  XP or game-yield funds are used.
                </p>
                <p>
                  Deadline: {time(createRequest.dueAtMs!)}. Fixed arbiter:{" "}
                  <span className="task-account">
                    {data?.config?.arbiter_id}
                  </span>
                  .
                </p>
                {publicNotice}
                {acknowledgement}
                <button
                  className="primary-button"
                  disabled={
                    !canAct || !publicAckValid || reviewBinding !== binding
                  }
                  onClick={() => void run(createRequest)}
                >
                  <ShieldCheck />
                  Lock prize & publish
                </button>
              </div>
            )
          )}
        </>
      ) : task ? (
        <>
          <button
            className="task-back"
            onClick={() => {
              setSelectedId(null);
              setPublicAck(false);
              setNotice("");
            }}
            disabled={busy}
          >
            <ArrowLeft />
            All tasks
          </button>
          <article className="task-detail">
            <div className="task-detail-top">
              <TaskReward value={task.reward_yocto} />
              <span className="task-state">{task.status}</span>
            </div>
            <p className="task-area">
              <Flag />
              {task.area}
            </p>
            <p className="task-requirements">{task.description}</p>
            <p className="task-secondary">
              <Clock />
              Evidence deadline {time(task.due_at_ms)}
            </p>
            {task.status === "awarded" && (
              <p className="task-notice">
                <CheckCircle />
                Prize awarded to{" "}
                <span className="task-account">{task.winner_id}</span>. Their
                task wallet shows any remaining credit or pending withdrawal.
              </p>
            )}
            {task.status === "refunded" && (
              <p className="task-notice">
                Prize returned to the sponsor’s task credit. The storage cost is
                not refunded.
              </p>
            )}
            {task.cancelled && task.status === "closing" && (
              <p className="task-notice">
                Closed to new evidence. Earlier submissions keep their review
                and appeal rights.
              </p>
            )}
            {!account && task.status === "open" && (
              <p>Connect a NEAR wallet to submit evidence. Browsing is free.</p>
            )}
            {caps?.submit ||
            (caps?.appealSubmissionId !== null &&
              caps?.appealSubmissionId !== undefined) ? (
              <form
                className="task-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitEvidence();
                }}
              >
                {evidenceDraft.hasDraft && (
                  <p className="task-secondary" role="status">
                    {evidenceDraft.storageAvailable
                      ? "Evidence draft kept for this wallet and task. Public consent must be confirmed again."
                      : "Evidence remains in this tab; browser storage is unavailable."}
                  </p>
                )}
                <h3>
                  {caps?.appealSubmissionId !== null
                    ? "Appeal your evidence"
                    : "Share your evidence"}
                </h3>
                <label>
                  {caps?.appealSubmissionId !== null
                    ? "Why should this be reconsidered?"
                    : "What did you find?"}
                  <textarea
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    maxLength={512}
                    required
                    rows={4}
                    disabled={busy}
                  />
                </label>
                <details>
                  <summary>Optional content reference</summary>
                  <label>
                    Public IPFS content address
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      maxLength={256}
                      placeholder="ipfs://bafy…"
                      disabled={busy}
                    />
                  </label>
                  <p className="task-secondary">
                    No upload is provided. Only use public, non-sensitive text
                    content you have already published.
                  </p>
                </details>
                <p className="task-secondary">
                  {caps?.appealSubmissionId !== null
                    ? "Appeal cost: network fee only. The original 0.05 test NEAR storage cost is not refunded."
                    : "Submitting costs 0.05 test NEAR for non-refundable storage, plus network fee. One submission per wallet; approval is not guaranteed."}
                </p>
                {publicNotice}
                {acknowledgement}
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!canAct || !publicAckValid || !evidence.trim()}
                >
                  {caps?.appealSubmissionId !== null
                    ? "Send appeal"
                    : "Submit evidence"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    const removed = evidenceDraft.discard();
                    setPublicAck(false);
                    setNotice(
                      removed
                        ? "Evidence draft cleared. Any pending transaction or submitted claim is unchanged."
                        : "Evidence cleared from this view. Browser storage could not remove the saved draft; it may return. Any pending transaction or submitted claim is unchanged.",
                    );
                  }}
                >
                  Discard evidence draft
                </button>
              </form>
            ) : (
              ownSubmission && (
                <div className="task-own-receipt">
                  <h3>Your evidence · {ownSubmission.status}</h3>
                  <p>{ownSubmission.evidence.text}</p>
                  {ownSubmission.review_reason && (
                    <p>Review: {ownSubmission.review_reason}</p>
                  )}
                  {ownSubmission.resolution_reason && (
                    <p>Arbiter: {ownSubmission.resolution_reason}</p>
                  )}
                  {ownSubmission.status === "pending" && (
                    <p className="task-secondary">
                      The sponsor reviews in receipt order. If still unreviewed
                      at {time(task.review_ends_at_ms)}, you may appeal before{" "}
                      {time(task.appeal_ends_at_ms)}.
                    </p>
                  )}
                </div>
              )
            )}
            {reviewSubmission && (
              <div className="task-review">
                <h3>Next evidence to review</h3>
                <p className="task-account">{reviewSubmission.claimant_id}</p>
                <p>{reviewSubmission.evidence.text}</p>
                <label>
                  Decision reason
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    maxLength={256}
                    rows={3}
                    disabled={busy}
                  />
                </label>
                <p className="task-secondary">
                  Your reason is public. Approving can credit the prize; earlier
                  appeal rights must finish first.
                </p>
                <div className="task-buttons">
                  <button
                    className="primary-button"
                    disabled={!canAct || !reason.trim()}
                    onClick={() =>
                      void run({
                        action: "review",
                        taskId: task.task_id,
                        submissionId: reviewSubmission.submission_id,
                        approved: true,
                        reason: reason.trim(),
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!canAct || !reason.trim()}
                    onClick={() =>
                      void run({
                        action: "review",
                        taskId: task.task_id,
                        submissionId: reviewSubmission.submission_id,
                        approved: false,
                        reason: reason.trim(),
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
            {!!caps?.resolveSubmissionIds.length && (
              <div className="task-review">
                <h3>Arbiter review</h3>
                <label>
                  Appealed evidence
                  <select
                    value={resolveId ?? ""}
                    onChange={(e) =>
                      setResolveId(
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  >
                    <option value="">Choose evidence</option>
                    {caps.resolveSubmissionIds.map((id) => (
                      <option value={id} key={id}>
                        Submission #{id + 1}
                      </option>
                    ))}
                  </select>
                </label>
                {resolving && (
                  <>
                    <p>{resolving.evidence.text}</p>
                    <p>Appeal: {resolving.appeal?.text}</p>
                    <label>
                      Public resolution reason
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={256}
                        rows={3}
                      />
                    </label>
                    <div className="task-buttons">
                      <button
                        className="primary-button"
                        disabled={!canAct || !reason.trim()}
                        onClick={() =>
                          void run({
                            action: "resolve",
                            taskId: task.task_id,
                            submissionId: resolving.submission_id,
                            approved: true,
                            reason: reason.trim(),
                          })
                        }
                      >
                        Uphold claim
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!canAct || !reason.trim()}
                        onClick={() =>
                          void run({
                            action: "resolve",
                            taskId: task.task_id,
                            submissionId: resolving.submission_id,
                            approved: false,
                            reason: reason.trim(),
                          })
                        }
                      >
                        Dismiss claim
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {!caps?.submit &&
              !ownSubmission &&
              account &&
              task.sponsor_id !== account &&
              !["awarded", "refunded"].includes(task.status) && (
                <p className="task-secondary">
                  New evidence is closed or this wallet is not eligible.
                  Existing reviews and appeals retain their deadlines.
                </p>
              )}
            <details className="task-rules">
              <summary>Review, appeals & locked funds</summary>
              <p>
                One prize, awarded to the earliest approved eligible evidence.
                Evidence is not a reservation. Later approval waits for earlier
                appeal rights.
              </p>
              <dl>
                <div>
                  <dt>Sponsor review ends</dt>
                  <dd>{time(task.review_ends_at_ms)}</dd>
                </div>
                <div>
                  <dt>Latest appeal deadline</dt>
                  <dd>{time(task.appeal_ends_at_ms)}</dd>
                </div>
                <div>
                  <dt>Final resolution cutoff</dt>
                  <dd>{time(task.resolve_ends_at_ms)}</dd>
                </div>
              </dl>
              <p>
                A rejected claim has up to 24 hours to appeal, capped by the
                appeal deadline. Unreviewed evidence must be appealed after
                review closes. Unresolved appeals expire at the final cutoff; no
                guaranteed award.
              </p>
              <p>
                Fixed arbiter:{" "}
                <span className="task-account">{data?.config?.arbiter_id}</span>
                . Non-refundable storage: 0.05 test NEAR per task and
                submission. Other actions cost network fees; withdrawal attaches
                1 yoctoNEAR.
              </p>
              <p>
                Sponsor: <span className="task-account">{task.sponsor_id}</span>
              </p>
              <p>
                Task #{task.task_id} · {task.submission_count} evidence receipts
              </p>
              {task.reference && <code>{task.reference}</code>}
              <p>
                Submitted content SHA-256: <code>{task.content_hash}</code>
              </p>
              {data?.submissions.map((s) => (
                <details key={s.submission_id}>
                  <summary>
                    Evidence #{s.submission_id + 1} · {s.status}
                  </summary>
                  <p className="task-account">{s.claimant_id}</p>
                  <p>{s.evidence.text}</p>
                  {s.evidence.reference && <code>{s.evidence.reference}</code>}
                  {s.appeal && <p>Appeal: {s.appeal.text}</p>}
                  {s.review_reason && <p>Review: {s.review_reason}</p>}
                  {s.resolution_reason && (
                    <p>Resolution: {s.resolution_reason}</p>
                  )}
                </details>
              ))}
              {caps?.cancel && (
                <div className="task-cancel">
                  <p>
                    Closing blocks new submissions. Timely evidence is still
                    eligible; any unused prize becomes sponsor credit only after
                    its rights end. Storage is not refunded.
                  </p>
                  <button
                    className="secondary-button"
                    disabled={!canAct}
                    onClick={() =>
                      void run({ action: "cancel", taskId: task.task_id })
                    }
                  >
                    Close to new evidence
                  </button>
                </div>
              )}
            </details>
            {caps?.finalize && (
              <div className="task-finalize">
                <p>
                  Check whether the prize can settle. Live review or appeal
                  rights may keep it locked; an unchanged record means no payout
                  yet.
                </p>
                <button
                  className="secondary-button"
                  disabled={!canAct}
                  onClick={() =>
                    void run({ action: "finalize", taskId: task.task_id })
                  }
                >
                  Check settlement
                </button>
              </div>
            )}
          </article>
        </>
      ) : (
        <>
          {fresh && (
            <button
              className="primary-button"
              disabled={
                !canAct ||
                account === data?.config?.arbiter_id ||
                data!.tasks.length >= 128
              }
              onClick={() => {
                setCreating(true);
                setPublicAck(false);
                setNotice("");
              }}
            >
              <Plus />
              {createDraft.hasDraft ? "Resume task draft" : "Sponsor a task"}
            </button>
          )}
          {fresh && !data?.tasks.length && (
            <div className="task-empty">
              <Flag />
              <h3>The noticeboard is ready</h3>
              <p>
                Publish a small, verifiable public-place task. Its own test NEAR
                prize stays separate from street coins and zones.
              </p>
            </div>
          )}
          <div className="task-list">
            {data?.tasks
              .slice()
              .reverse()
              .map((t) => (
                <button
                  className="task-card"
                  key={t.task_id}
                  disabled={busy || loading}
                  onClick={() => {
                    setSelectedId(t.task_id);
                    setReason("");
                    setNotice("");
                  }}
                >
                  <span>
                    <span className="task-state">
                      {t.status}
                      {t.sponsor_id === account ? " · yours" : ""}
                    </span>
                    <strong>{t.title}</strong>
                    <small>{t.area}</small>
                    <TaskReward value={t.reward_yocto} />
                  </span>
                  <CaretRight aria-hidden="true" />
                </button>
              ))}
          </div>
        </>
      )}
      {data?.account &&
        (data.account.credit_yocto !== "0" ||
          data.account.pending_withdrawal) && (
          <aside className="task-credit">
            <h3>
              <Wallet />
              Your task credit
            </h3>
            <TaskReward value={data.account.credit_yocto} />
            {data.account.pending_withdrawal ? (
              <p role="status">
                {exactTaskNear(data.account.pending_withdrawal.amount_yocto)}{" "}
                test NEAR withdrawal is pending. Refresh to check the result.
              </p>
            ) : (
              <>
                <p className="task-secondary">
                  Approved awards and sponsor refunds. Separate from your game
                  wallet and staking funds. Withdrawal attaches 1 yoctoNEAR plus
                  network fee.
                </p>
                <button
                  className="primary-button"
                  disabled={!canAct || data.account.credit_yocto === "0"}
                  onClick={() => void run({ action: "withdraw" })}
                >
                  Withdraw task credit
                </button>
              </>
            )}
          </aside>
        )}
      <details className="task-proof">
        <summary>Testnet proof & limits</summary>
        <p>
          Test tokens have no promised real-world value. Pilot limit: 128 tasks,
          32 submissions per task and a maximum 1 test NEAR prize. No XP, paid
          access, uploaded photos or GPS verification is included.
        </p>
        <p>
          Contract:{" "}
          <span className="task-account">
            {data?.contractId || "questlayer-tasks-20261031.testnet"}
          </span>
        </p>
        {data?.blockHeight && (
          <p>
            Finalized block {data.blockHeight}.{" "}
            {data.observedAt && <>Observed {time(data.observedAt)}.</>}
          </p>
        )}
        <p>
          Hiding a task in the application cannot erase its chain records. Only
          publish appropriate public text.
        </p>
      </details>
    </section>
  );
}
