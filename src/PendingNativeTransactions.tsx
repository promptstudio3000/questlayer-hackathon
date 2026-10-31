import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Clock,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  NATIVE_PENDING_EVENT,
  readPendingNativeTransactions,
  checkPendingNativeTransaction,
  clearFailedNativeTransaction,
  type PendingNativeTransaction,
} from "./confirmed-native-transaction";
import "./pending-native-transactions.css";
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
  }>({ playerId: "", entries: [], error: "" });
  const [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [hashes, setHashes] = useState<Record<string, string>>({}),
    [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const identity = `${playerId}:${[...linkedAccounts].sort().join(",")}`;
  const latest = useRef(identity);
  latest.current = identity;
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setBusy("");
    setMessage("");
    setHashes({});
    setAcknowledged({});
  }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setBusy("");
    setMessage("");
    setHashes({});
    setAcknowledged({});
    const refresh = () => {
      setMessage("");
      try {
        setSnapshot({
          playerId,
          entries: readPendingNativeTransactions(playerId),
          error: "",
        });
      } catch (error) {
        setSnapshot({ playerId, entries: [], error: (error as Error).message });
      }
    };
    refresh();
    window.addEventListener(NATIVE_PENDING_EVENT, refresh);
    return () => window.removeEventListener(NATIVE_PENDING_EVENT, refresh);
  }, [playerId]);
  async function check(entry: PendingNativeTransaction, clear = false) {
    if (busy || !linkedAccounts.includes(entry.accountId)) return;
    const who = identity;
    setBusy(entry.id);
    setMessage("");
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
      if (!mounted.current || latest.current !== who) return;
      setMessage(
        clear
          ? "The checked receipt is cleared. Review the current record before choosing another action."
          : "Transaction confirmed. Your current balance or item record can now be refreshed.",
      );
      heading.current?.focus();
      await onConfirmed?.();
    } catch (error) {
      if (mounted.current && latest.current === who)
        setMessage((error as Error).message);
    } finally {
      if (mounted.current && latest.current === who) setBusy("");
    }
  }
  const current =
    snapshot.playerId === playerId ? snapshot : { entries: [], error: "" };
  if (!current.entries.length && !current.error && !message) return null;
  return (
    <section className="native-pending" aria-label="Pending NEAR transactions">
      <header>
        <Clock size={23} aria-hidden="true" />
        <h3 ref={heading} tabIndex={-1}>
          Check your transaction
        </h3>
      </header>
      <p>Checking a receipt never sends another transaction.</p>
      {current.error && (
        <p className="native-pending-error" role="alert">
          {current.error}
        </p>
      )}
      {message && (
        <p className="native-pending-message" role="status">
          {message}
        </p>
      )}
      {current.entries.map((entry) => {
        const linked = linkedAccounts.includes(entry.accountId),
          checking = busy === entry.id;
        return (
          <article key={entry.id} className="native-pending-entry">
            <div className="native-pending-title">
              <b>{labels[entry.quote.methodName] || "NEAR transaction"}</b>
              <span>
                {entry.phase === "failed"
                  ? "Final · incomplete"
                  : entry.transactionHash
                    ? "Needs confirmation"
                    : "Check wallet history"}
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
              <p>Reconnect this NEAR wallet to check its saved receipt.</p>
            )}
            {!entry.transactionHash && (
              <label>
                Transaction hash from your wallet
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
                  If the wallet gave no clear result, find the transaction in
                  its history. Nothing will be signed again here.
                </small>
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
                  href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(entry.transactionHash)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View receipt <ArrowSquareOut size={18} aria-hidden="true" />
                </a>
              )}
            </div>
            <details>
              <summary>Signed terms</summary>
              <dl>
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
                These public transaction terms are saved only in this tab’s
                session. Closing the browser can remove this recovery record;
                the on-chain receipt remains.
              </p>
            </details>
            {entry.phase === "failed" && (
              <div className="native-pending-failure">
                <p>
                  A final failure can still change balances or leave a
                  recoverable credit. Check the current wallet, staking or item
                  record first.
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
                  I checked the current balance or item state.
                </label>
                <button
                  className="secondary-button"
                  disabled={!linked || !!busy || !acknowledged[entry.id]}
                  onClick={() => void check(entry, true)}
                >
                  Clear checked failure
                </button>
                <small>
                  The failure is verified again before clearing. This does not
                  send or repeat an operation.
                </small>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
