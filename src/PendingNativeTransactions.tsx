import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Clock,
  DownloadSimple,
  Info,
  Receipt,
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
import { tr } from "./i18n";
const labels: Record<string, string> = {
  get create_task() { return tr("Fund sponsored task"); },
  get submit_evidence() { return tr("Submit task evidence"); },
  get review_submission() { return tr("Review task evidence"); },
  get appeal_submission() { return tr("Appeal task decision"); },
  get resolve_appeal() { return tr("Resolve task appeal"); },
  get cancel_task() { return tr("Close sponsored task"); },
  get finalize_task() { return tr("Settle sponsored task"); },
  get create_position() { return tr("Create staking position"); },
  get register_position() { return tr("Register position"); },
  get withdraw_refund() { return tr("Withdraw setup refund"); },
  deposit_and_stake: "Stake NEAR",
  get request_exit() { return tr("Request unstaking"); },
  get request_partial_exit() { return tr("Take part of a stake out"); },
  get set_contribution() { return tr("Change city share"); },
  get withdraw_owner() { return tr("Withdraw released NEAR"); },
  get refresh() { return tr("Refresh position"); },
  get advance() { return tr("Continue withdrawal"); },
  buy: "Buy Aura",
  get cancel() { return tr("Return listed Aura"); },
  withdraw: "Withdraw NEAR",
  nft_transfer_call: "List Aura",
  redeem_aura: "Claim Aura",
  get mint_avatar() { return tr("Create explorer"); },
  equip_aura: "Equip Aura",
  unequip_aura: "Remove Aura",
  get set() { return tr("Publish profile"); },
};
function exactNear(amount: string) {
  const value = BigInt(amount),
    part = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${value / 10n ** 24n}${part ? "." + part : ""}`;
}
/** Settings → Receipts (owner request, 12 Nov 2026): lazy, so its icons stay out of the first load. */
export function SettingsReceipts(props: Parameters<typeof PendingNativeTransactions>[0]) {
  return (
    <details className="settings-group screen-details settings-receipts">
      <summary><Receipt size={20} aria-hidden="true" />{tr("Receipts")}</summary>
      <p className="fine-print settings-pad">
        <Info size={16} aria-hidden="true" /> {tr("Payments you signed keep a receipt here until the chain confirms them. If one was interrupted, check it here before paying again.")}
      </p>
      <PendingNativeTransactions {...props} />
    </details>
  );
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
          ? tr("Receipt cleared. Check your current balance or Aura before doing anything else.")
          : tr("Confirmed. Refresh your balance or collection to see the result."),
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
        text: tr("Receipt download started. Keep the file private; it contains your account names and receipt details."),
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
          ? tr("{0}. Use Check confirmation to see the result. Nothing was sent.", { 0: result.imported === 1 ? "Receipt imported" : `${result.imported} receipts imported` })
          : tr("These receipts are already saved. Use Check confirmation to see their result."),
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
      aria-label={tr("Receipt recovery")}
    >
      {showHeading && (
        <header>
          <Clock size={23} aria-hidden="true" />
          <h3 ref={heading} tabIndex={-1}>
            {hasPending ? tr("Check your last receipt") : tr("Receipt recovery")}
          </h3>
        </header>
      )}
      {hasPending && <p>{tr("Checking a receipt never sends anything again.")}</p>}
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
        <summary>{tr("Receipt backup and recovery")}</summary>
        <p>
          {tr("Saved receipts stay in this browser after it closes. Keep a backup before clearing site data or moving to another device.")}</p>
        <p>
          {tr("The file holds account names and receipt details, never keys or a recovery phrase. Keep it private.")}</p>
        <div className="native-pending-actions">
          <button
            className="secondary-button"
            disabled={!!busy || !current.ready || !hasPending}
            onClick={() => void downloadReceipts()}
          >
            <DownloadSimple size={19} aria-hidden="true" />
            {busy === "export" ? tr("Preparing…") : tr("Download receipts")}
          </button>
          <button
            className="secondary-button"
            disabled={!!busy || !current.ready || !linkedAccounts.length}
            onClick={() => recoveryFile.current?.click()}
          >
            <UploadSimple size={19} aria-hidden="true" />
            {busy === "import" ? tr("Importing…") : tr("Import receipts")}
          </button>
          <input
            ref={recoveryFile}
            className="native-recovery-file-input"
            type="file"
            accept="application/json,.json"
            tabIndex={-1}
            aria-label={tr("Choose a receipt backup")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
        {!current.ready && !current.error && (
          <p role="status">{tr("Checking saved receipts…")}</p>
        )}
        {!hasPending && current.ready && (
          <p>{tr("No pending receipts are saved here.")}</p>
        )}
        {!linkedAccounts.length && (
          <p>{tr("Link the original NEAR account to import its receipts.")}</p>
        )}
        <p>
          {tr("Import into the same explorer with the original NEAR account linked. Imported receipts still need Check confirmation; loading a file never sends anything.")}</p>
      </details>
      {current.entries.map((entry) => {
        const linked = linkedAccounts.includes(entry.accountId),
          checking = busy === entry.id;
        return (
          <article key={entry.id} className="native-pending-entry">
            <div className="native-pending-title">
              <b>{labels[entry.quote.methodName] || tr("NEAR receipt")}</b>
              <span>
                {entry.phase === "failed"
                  ? tr("Final · incomplete")
                  : entry.transactionHash
                    ? tr("Needs confirmation")
                    : tr("Check your wallet app")}
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
              <p>{tr("Link this NEAR account again to check its receipt.")}</p>
            )}
            {!entry.transactionHash && (
              <label>
                {tr("Receipt ID from your wallet app")}<input
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
                  {tr("If your wallet app gave no clear result, find this receipt in its history. Nothing is sent again here.")}</small>
                {entry.afterBlock === undefined && (
                  <small>
                    {tr("This older record has no reference point. Match the date, amount and reviewed terms carefully.")}</small>
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
                {checking ? tr("Checking…") : tr("Check confirmation")}
              </button>
              {entry.transactionHash && (
                <a
                  href={`${EXPLORER_BASE}/txns/${encodeURIComponent(entry.transactionHash)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("View receipt")}{" "}<ArrowSquareOut size={18} aria-hidden="true" />
                </a>
              )}
            </div>
            <details>
              <summary>{tr("Reviewed terms")}</summary>
              <dl>
                <dt>{tr("Requested")}</dt>
                <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
                <dt>{tr("Network")}</dt>
                <dd>{tr("NEAR testnet")}</dd>
                <dt>{tr("Contract")}</dt>
                <dd>{entry.quote.receiverId}</dd>
                <dt>{tr("Method")}</dt>
                <dd>{entry.quote.methodName}</dd>
                <dt>{tr("Attached deposit")}</dt>
                <dd>{exactNear(entry.quote.deposit)} {" "}{tr("test NEAR")}</dd>
                <dt>{tr("Gas limit")}</dt>
                <dd>{entry.quote.gas}</dd>
              </dl>
              <pre>{JSON.stringify(entry.quote.args, null, 2)}</pre>
              <p>
                {tr("Reviewed terms are saved in this browser. Clearing site data removes this record; the NEAR receipt itself remains.")}</p>
            </details>
            {entry.phase === "failed" && (
              <div className="native-pending-failure">
                <p>
                  {tr("A failed receipt can still have changed a balance or left a credit. Check your balance, stake or Aura first.")}</p>
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
                  {tr("I checked my current balance or Aura.")}</label>
                <button
                  className="secondary-button"
                  disabled={!linked || !!busy || !acknowledged[entry.id]}
                  onClick={() => void check(entry, true)}
                >
                  {tr("Clear checked failure")}</button>
                <small>
                  {tr("The failure is checked once more before clearing. Nothing is sent or repeated.")}</small>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
