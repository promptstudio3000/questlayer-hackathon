import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  NativeTasks,
  type NativeTask,
  type TaskSnapshot,
  type TaskSubmission,
} from "../src/NativeTasks";
import {
  NATIVE_TASK_CONTRACT,
  TASK_POLICY,
  TASK_STORAGE,
  type TaskRequest,
} from "../src/native-task-quote";
import type { Player } from "../src/types";
import "../src/style.css";
import "../src/styles.css";
import "../src/play-ui.css";
const params = new URLSearchParams(location.search),
  role = params.get("role") || "explorer",
  mode = params.get("state") || "ready",
  outcome = params.get("outcome") || "cancel",
  now = Date.now();
const explorer = "public-place-explorer-with-a-long-name.testnet",
  sponsor = "bridge-trail-sponsor.testnet",
  arbiter = "independent-task-arbiter.testnet",
  account =
    role === "sponsor" ? sponsor : role === "arbiter" ? arbiter : explorer;
const player = {
  id: "fixture",
  wallets: role === "guest" ? [] : [{ account_id: account }],
} as Player;
const base: NativeTask = {
  task_id: 1,
  client_id: "fixture",
  sponsor_id: sponsor,
  title: "Find the year on the public bridge plaque",
  description:
    "From a public footpath, read the year on a bridge plaque and describe its position. Do not enter the road or a closed site. This fixture does not verify a real location.",
  area: "Plzeň · riverfront",
  reference: "",
  content_hash: "a".repeat(64),
  reward_yocto: "100000000000000000000000",
  created_at_ms: now - 3600000,
  due_at_ms: now + 86400000,
  review_ends_at_ms: now + 3 * 86400000,
  appeal_ends_at_ms: now + 4 * 86400000,
  resolve_ends_at_ms: now + 6 * 86400000,
  status: "open",
  cancelled: false,
  submission_count: 0,
  review_cursor: 0,
  candidate_id: null,
  winner_id: null,
  settled_at_ms: null,
};
const sample: TaskSubmission = {
  submission_id: 0,
  claimant_id: explorer,
  submitted_at_ms: now - 10000,
  status:
    mode === "appeal"
      ? "rejected"
      : role === "arbiter"
        ? "appealed"
        : "pending",
  evidence: {
    text: "The plaque says 1913. It is mounted beside the riverside approach, readable from the public footpath.",
    reference: "",
    content_hash: "b".repeat(64),
  },
  reviewed_at_ms: mode === "appeal" ? now : null,
  review_reason:
    mode === "appeal"
      ? "Please clarify which side of the bridge you visited."
      : null,
  appeal_until_ms: mode === "appeal" ? now + 86400000 : null,
  appeal:
    role === "arbiter"
      ? {
          text: "The bridge approach is on the eastern bank.",
          reference: "",
          content_hash: "c".repeat(64),
        }
      : null,
  resolved_at_ms: null,
  resolution_reason: null,
};
function Review() {
  const tasks = useRef<NativeTask[]>([{ ...base }]),
    submissions = useRef<TaskSubmission[]>(
      role === "sponsor" || role === "arbiter" || mode === "appeal"
        ? [{ ...sample }]
        : [],
    ),
    credit = useRef(mode === "credit" ? base.reward_yocto : "0"),
    pending = useRef(false),
    requests = useRef<TaskRequest[]>([]),
    [requestCount, setRequestCount] = useState(0),
    [showTasks, setShowTasks] = useState(true),
    [codeVersion, setCodeVersion] = useState(1),
    [message, setMessage] = useState(
      "Interface fixture · no wallet, RPC or real transactions.",
    );
  const readTasks = async (
    who: string,
    _fresh: boolean,
    selected: number | null,
  ): Promise<TaskSnapshot> => {
    const task = tasks.current.find((t) => t.task_id === selected);
    const taskSubmissions = task?.task_id === 1 ? submissions.current : [];
    tasks.current[0].submission_count = submissions.current.length;
    return {
      status:
        mode === "unavailable"
          ? "unavailable"
          : mode === "stale"
            ? "stale"
            : "available",
      network: "testnet",
      contractId: NATIVE_TASK_CONTRACT,
      codeHash: `fixture-reviewed-code-${codeVersion}`,
      policy: TASK_POLICY,
      accountId: who,
      observedAt: now,
      chainTime: now,
      blockHash: "fixture-finalized-block",
      blockHeight: 231100000,
      reason:
        mode === "unavailable"
          ? "Verified task records are unavailable. Refresh to retry."
          : mode === "stale"
            ? "Refresh unavailable. These are previous confirmed records; actions are paused."
            : undefined,
      config: {
        arbiter_id: arbiter,
        task_storage_yocto: TASK_STORAGE,
        submission_storage_yocto: TASK_STORAGE,
        max_tasks: 128,
        max_reward_yocto: "1000000000000000000000000",
      },
      tasks: mode === "unavailable" ? [] : structuredClone(tasks.current),
      selectedTaskId: selected,
      submissions: structuredClone(taskSubmissions),
      account: who
        ? {
            account_id: who,
            credit_yocto: credit.current,
            pending_withdrawal: pending.current
              ? { withdrawal_id: 1, amount_yocto: base.reward_yocto }
              : null,
          }
        : null,
      actions:
        task && mode !== "stale"
          ? {
              submit:
                role === "explorer" &&
                !taskSubmissions.length &&
                task.status === "open",
              cancel: role === "sponsor" && task.status === "open",
              reviewSubmissionId:
                role === "sponsor" && taskSubmissions[0]?.status === "pending"
                  ? 0
                  : null,
              appealSubmissionId:
                mode === "appeal" && taskSubmissions[0]?.status === "rejected"
                  ? 0
                  : null,
              resolveSubmissionIds:
                role === "arbiter" && taskSubmissions.length ? [0] : [],
              finalize: task.status === "closing",
            }
          : null,
    };
  };
  const transact = async (r: TaskRequest) => {
    requests.current.push(structuredClone(r));
    setRequestCount(requests.current.length);
    if (outcome === "fail")
      throw Error(
        "Wallet service is offline. Your entries have been kept; reconnect and retry.",
      );
    if (!["success", "lost-after-save"].includes(outcome)) {
      setMessage(
        "Wallet cancellation simulated. No test NEAR spent; form values remain.",
      );
      return false;
    }
    if (
      r.action === "create" &&
      tasks.current.some(
        (t) => t.sponsor_id === account && t.client_id === r.clientId,
      )
    )
      throw Error(
        "Fixture contract rejects an already used sponsor/client ID.",
      );
    if (r.action === "create")
      tasks.current.push({
        ...base,
        task_id: tasks.current.length + 1,
        client_id: r.clientId!,
        sponsor_id: account,
        title: r.title!,
        description: r.description!,
        reference: r.reference!,
        content_hash: r.contentHash!,
        area: r.area!,
        reward_yocto: r.rewardYocto!,
        due_at_ms: r.dueAtMs!,
      });
    if (r.action === "submit")
      submissions.current.push({
        ...sample,
        evidence: {
          text: r.text!,
          reference: r.reference!,
          content_hash: r.contentHash!,
        },
      });
    if (r.action === "appeal") {
      submissions.current[0].status = "appealed";
      submissions.current[0].appeal = {
        text: r.text!,
        reference: r.reference!,
        content_hash: r.contentHash!,
      };
    }
    if (r.action === "review") {
      submissions.current[0].status = r.approved ? "approved" : "rejected";
      submissions.current[0].review_reason = r.reason!;
      tasks.current[0].status = r.approved ? "awarded" : "open";
      tasks.current[0].winner_id = r.approved ? explorer : null;
    }
    if (r.action === "cancel") {
      tasks.current[0].cancelled = true;
      tasks.current[0].status = "closing";
    }
    if (r.action === "withdraw") {
      credit.current = "0";
      pending.current = true;
    }
    setMessage(
      outcome === "lost-after-save"
        ? "Fixture accepted the operation but its confirmation was lost. No real wallet or chain transaction."
        : `Fixture-only ${r.action} accepted; no real transaction was sent.`,
    );
    return outcome !== "lost-after-save";
  };
  return (
    <main
      style={{
        maxWidth: 620,
        padding: 16,
        margin: "0 auto",
        background: "#fcfaff",
        color: "#1a0335",
        minHeight: "100vh",
      }}
    >
      {params.get("text") === "large" && (
        <style>{`.native-tasks :is(p,small,span,strong,button,label,input,textarea,select,summary,dt,dd){font-size:32px!important}`}</style>
      )}
      <p role="status" style={{ fontSize: 14, margin: "0 0 20px" }}>
        {message}
      </p>
      <details>
        <summary>Review controls</summary>
        <button onClick={() => setShowTasks(!showTasks)}>
          {showTasks ? "Leave task panel" : "Return to task panel"}
        </button>
        <button
          onClick={() => {
            setCodeVersion(codeVersion + 1);
            setMessage(
              "Fixture code changed. Refresh native tasks to read the new code identity.",
            );
          }}
        >
          Change fixture code
        </button>
        <p>Fixture transaction requests: {requestCount}</p>
        <output aria-label="Last fixture operation ID">
          {requests.current.at(-1)?.clientId || "No creation attempted"}
        </output>
      </details>
      {showTasks && (
        <NativeTasks
          player={player}
          onConnect={() =>
            setMessage("Fixture connection only; no real wallet opened.")
          }
          onTransaction={transact}
          readTasks={readTasks}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
