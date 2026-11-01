import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Clock,
  DownloadSimple,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  NATIVE_PENDING_EVENT,
  NATIVE_PENDING_STORAGE_PREFIX,
  NATIVE_RECOVERY_MAX_BYTES,
  initializePendingNativeTransactions,
  exportPendingNativeTransactions,
  importPendingNativeTransactions,
  readPendingNativeTransactions,
  checkPendingNativeTransaction,
  clearFailedNativeTransaction,
  type PendingNativeTransaction,
} from "./confirmed-native-transaction";
import "./pending-native-transactions.css";
import { EXPLORER_BASE } from "./near-network.ts";
const labels: Record<string, string> = {
  create_task: "Fund sponsored task",
  submit_evidence: "Submit task evidence",
  review_submission: "Review task evidence",
  appeal_submission: "Appeal task decision",
  resolve_appeal: "Resolve task appeal",
  cancel_task: "Close sponsored task",
  finalize_task: "Settle sponsored task",
  create_position: "Create staking position",
  register_position: "Register position",
  withdraw_refund: "Withdraw setup refund",
  deposit_and_stake: "Stake NEAR",
  request_exit: "Request unstaking",
  withdraw_owner: "Withdraw released NEAR",
  refresh: "Refresh position",
  advance: "Continue withdrawal",
  buy: "Buy Aura",
  cancel: "Return listed Aura",
  withdraw: "Withdraw NEAR",
  nft_transfer_call: "List Aura",
  redeem_aura: "Claim Aura",
  mint_avatar: "Create explorer",
  equip_aura: "Equip Aura",
  unequip_aura: "Remove Aura",
  set: "Publish profile",
};
function exactNear(amount: string) {
  const value = BigInt(amount),
    part = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${value / 10n ** 24n}${part ? "." + part : ""}`;
}
export function PendingNativeTransactions({
  playerId,
  linkedAccounts,
  onConfirmed,
}: {
  playerId: string;
  linkedAccounts: string[];
  onConfirmed?: () => void | Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<{
    playerId: string;
    entries: PendingNativeTransaction[];
    error: string;
    ready: boolean;
  }>({ playerId: "", entries: [], error: "", ready: false });
  const [busy, setBusy] = useState(""),
    [feedback, setFeedback] = useState({ text: "", error: false }),
    [hashes, setHashes] = useState<Record<string, string>>({}),
    [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const identity = `${playerId}:${[...linkedAccounts].sort().join(",")}`;
  const latest = useRef(identity);
  latest.current = identity;
  const mounted = useRef(true),
    flight = useRef<symbol | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    recoveryFile = useRef<HTMLInputElement>(null);
  const isCurrent = (who: string) => mounted.current && latest.current === who;
  useEffect(() => {
    setBusy("");
    flight.current = null;
    setFeedback({ text: "", error: false });
    setHashes({});
    setAcknowledged({});
    if (recoveryFile.current) recoveryFile.current.value = "";
  }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true,
      initialized = false;
    setSnapshot({ playerId, entries: [], error: "", ready: false });
    const refresh = () => {
      if (!active || !initialized) return;
      try {
        setSnapshot({
          playerId,
          entries: readPendingNativeTransactions(playerId),
          error: "",
          ready: true,
        });
      } catch (error) {
        setSnapshot({
          playerId,
          entries: [],
          error: (error as Error).message,
          ready: false,
        });
      }
    };
    const changedElsewhere = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === `${NATIVE_PENDING_STORAGE_PREFIX}${playerId}`
      )
        refresh();
    };
    window.addEventListener(NATIVE_PENDING_EVENT, refresh);
    window.addEventListener("storage", changedElsewhere);
    void initializePendingNativeTransactions({ playerId })
      .then(() => {
        if (!active) return;
        initialized = true;
        refresh();
      })
      .catch((error: Error) => {
        if (active)
          setSnapshot({
            playerId,
            entries: [],
            error: error.message,
            ready: false,
          });
      });
    return () => {
      active = false;
      window.removeEventListener(NATIVE_PENDING_EVENT, refresh);
      window.removeEventListener("storage", changedElsewhere);
    };
  }, [playerId]);
  async function check(entry: PendingNativeTransaction, clear = false) {
    if (flight.current || !linkedAccounts.includes(entry.accountId)) return;
    const who = identity,
      token = Symbol("receipt-check");
    flight.current = token;
    setBusy(entry.id);
    setFeedback({ text: "", error: false });
    try {
      if (clear)
        await clearFailedNativeTransaction(
          { playerId },
          entry.id,
          acknowledged[entry.id] === true,
        );
      else
        await checkPendingNativeTransaction(
          { playerId },
          entry.id,
          hashes[entry.id],
        );
      if (!isCurrent(who)) return;
      setFeedback({
        text: clear
          ? "Receipt cleared. Check your current balance or Aura before doing anything else."
          : "Confirmed. Refresh your balance or collection to see the result.",
        error: false,
      });
      heading.current?.focus();
      await onConfirmed?.();
    } catch (error) {
      if (isCurrent(who))
        setFeedback({ text: (error as Error).message, error: true });
    } finally {
      if (flight.current === token) flight.current = null;
      if (isCurrent(who)) setBusy("");
    }
  }
  async function downloadReceipts() {
    if (flight.current) return;
    const who = identity,
      token = Symbol("receipt-export");
    flight.current = token;
    setBusy("export");
    setFeedback({ text: "", error: false });
    try {
      const content = await exportPendingNativeTransactions({ playerId });
      if (!isCurrent(who)) return;
      const url = URL.createObjectURL(
        new Blob([content], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `questlayer-receipts-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setFeedback({
        text: "Receipt download started. Keep the file private; it contains your account names and receipt details.",
        error: false,
      });
    } catch (error) {
      if (isCurrent(who))
        setFeedback({ text: (error as Error).message, error: true });
    } finally {
      if (flight.current === token) flight.current = null;
      if (isCurrent(who)) setBusy("");
    }
  }
  async function importFile(file: File) {
    if (flight.current || !linkedAccounts.length) return;
    const who = identity,
      token = Symbol("receipt-import");
    flight.current = token;
    setBusy("import");
    setFeedback({ text: "", error: false });
    try {
      if (file.size > NATIVE_RECOVERY_MAX_BYTES)
        throw Error("Choose a receipt file smaller than 100 KB.");
      const content = await file.text();
      if (!isCurrent(who)) return;
      const result = await importPendingNativeTransactions(
        { playerId },
        content,
        linkedAccounts,
      );
      if (!isCurrent(who)) return;
      setFeedback({
        text: result.imported
          ? `${result.imported === 1 ? "Receipt imported" : `${result.imported} receipts imported`}. Use Check confirmation to see the result. Nothing was sent.`
          : "These receipts are already saved. Use Check confirmation to see their result.",
        error: false,
      });
      heading.current?.focus();
    } catch (error) {
      if (isCurrent(who))
        setFeedback({ text: (error as Error).message, error: true });
    } finally {
      if (flight.current === token) flight.current = null;
      if (isCurrent(who)) setBusy("");
    }
  }
  const current =
    snapshot.playerId === playerId
      ? snapshot
      : { entries: [], error: "", ready: false };
  const hasPending = current.entries.length > 0;
  const showHeading = hasPending || !!current.error || !!feedback.text;
  if (!showHeading && !linkedAccounts.length) return null;
  return (
    <section
      className={`native-pending${showHeading ? "" : " native-pending-empty"}`}
      aria-label="Receipt recovery"
    >
      {showHeading && (
        <header>
          <Clock size={23} aria-hidden="true" />
          <h3 ref={heading} tabIndex={-1}>
            {hasPending ? "Check your last receipt" : "Receipt recovery"}
          </h3>
        </header>
      )}
      {hasPending && <p>Checking a receipt never sends anything again.</p>}
      {current.error && (
        <p className="native-pending-error" role="alert">
          {current.error}
        </p>
      )}
      {feedback.text && (
        <p
          className={
            feedback.error ? "native-pending-error" : "native-pending-message"
          }
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
      <details className="native-recovery-file">
        <summary>Receipt backup and recovery</summary>
        <p>
          Saved receipts stay in this browser after it closes. Keep a backup
          before clearing site data or moving to another device.
        </p>
        <p>
          The file holds account names and receipt details, never keys or a
          recovery phrase. Keep it private.
        </p>
        <div className="native-pending-actions">
          <button
            className="secondary-button"
            disabled={!!busy || !current.ready || !hasPending}
            onClick={() => void downloadReceipts()}
          >
            <DownloadSimple size={19} aria-hidden="true" />
            {busy === "export" ? "Preparing…" : "Download receipts"}
          </button>
          <button
            className="secondary-button"
            disabled={!!busy || !current.ready || !linkedAccounts.length}
            onClick={() => recoveryFile.current?.click()}
          >
            <UploadSimple size={19} aria-hidden="true" />
            {busy === "import" ? "Importing…" : "Import receipts"}
          </button>
          <input
            ref={recoveryFile}
            className="native-recovery-file-input"
            type="file"
            accept="application/json,.json"
            tabIndex={-1}
            aria-label="Choose a receipt backup"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
        {!current.ready && !current.error && (
          <p role="status">Checking saved receipts…</p>
        )}
        {!hasPending && current.ready && (
          <p>No pending receipts are saved here.</p>
        )}
        {!linkedAccounts.length && (
          <p>Link the original NEAR account to import its receipts.</p>
        )}
        <p>
          Import into the same explorer with the original NEAR account linked.
          Imported receipts still need Check confirmation; loading a file never
          sends anything.
        </p>
      </details>
      {current.entries.map((entry) => {
        const linked = linkedAccounts.includes(entry.accountId),
          checking = busy === entry.id;
        return (
          <article key={entry.id} className="native-pending-entry">
            <div className="native-pending-title">
              <b>{labels[entry.quote.methodName] || "NEAR receipt"}</b>
              <span>
                {entry.phase === "failed"
                  ? "Final · incomplete"
                  : entry.transactionHash
                    ? "Needs confirmation"
                    : "Check your wallet app"}
              </span>
            </div>
            <p className="native-pending-account">{entry.accountId}</p>
            {entry.error && (
              <p className="native-pending-error">
                <WarningCircle size={18} aria-hidden="true" />
                {entry.error}
              </p>
            )}
            {!linked && (
              <p>Link this NEAR account again to check its receipt.</p>
            )}
            {!entry.transactionHash && (
              <label>
                Receipt ID from your wallet app
                <input
                  value={hashes[entry.id] || ""}
                  onChange={(event) =>
                    setHashes((value) => ({
                      ...value,
                      [entry.id]: event.target.value.trim(),
                    }))
                  }
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={64}
                  disabled={!linked || !!busy}
                />
                <small>
                  If your wallet app gave no clear result, find this receipt in
                  its history. Nothing is sent again here.
                </small>
                {entry.afterBlock === undefined && (
                  <small>
                    This older record has no reference point. Match the date,
                    amount and reviewed terms carefully.
                  </small>
                )}
              </label>
            )}
            <div className="native-pending-actions">
              <button
                className="secondary-button"
                disabled={
                  !linked ||
                  !!busy ||
                  (!entry.transactionHash && !hashes[entry.id])
                }
                onClick={() => void check(entry)}
              >
                <ArrowClockwise size={19} aria-hidden="true" />
                {checking ? "Checking…" : "Check confirmation"}
              </button>
              {entry.transactionHash && (
                <a
                  href={`${EXPLORER_BASE}/txns/${encodeURIComponent(entry.transactionHash)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View receipt <ArrowSquareOut size={18} aria-hidden="true" />
                </a>
              )}
            </div>
            <details>
              <summary>Reviewed terms</summary>
              <dl>
                <dt>Requested</dt>
                <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
                <dt>Network</dt>
                <dd>NEAR testnet</dd>
                <dt>Contract</dt>
                <dd>{entry.quote.receiverId}</dd>
                <dt>Method</dt>
                <dd>{entry.quote.methodName}</dd>
                <dt>Attached deposit</dt>
                <dd>{exactNear(entry.quote.deposit)} test NEAR</dd>
                <dt>Gas limit</dt>
                <dd>{entry.quote.gas}</dd>
              </dl>
              <pre>{JSON.stringify(entry.quote.args, null, 2)}</pre>
              <p>
                Reviewed terms are saved in this browser. Clearing site data
                removes this record; the NEAR receipt itself remains.
              </p>
            </details>
            {entry.phase === "failed" && (
              <div className="native-pending-failure">
                <p>
                  A failed receipt can still have changed a balance or left a
                  credit. Check your balance, stake or Aura first.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged[entry.id] === true}
                    onChange={(event) =>
                      setAcknowledged((value) => ({
                        ...value,
                        [entry.id]: event.target.checked,
                      }))
                    }
                    disabled={!!busy}
                  />
                  I checked my current balance or Aura.
                </label>
                <button
                  className="secondary-button"
                  disabled={!linked || !!busy || !acknowledged[entry.id]}
                  onClick={() => void check(entry, true)}
                >
                  Clear checked failure
                </button>
                <small>
                  The failure is checked once more before clearing. Nothing is
                  sent or repeated.
                </small>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
