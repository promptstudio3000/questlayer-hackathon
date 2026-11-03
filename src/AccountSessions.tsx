import { useEffect, useState } from "react";
import {
  Key,
  ShieldCheck,
  ArrowClockwise,
  SignOut,
  Devices,
} from "@phosphor-icons/react";
import { api } from "./api";
import type { Player } from "./types";
import type { NearNetwork } from "./near-network.ts";
import { tr } from "./i18n";
export type SessionView = {
  network: NearNetwork;
  activeSessionCount: number;
  hasMoreSessions: boolean;
  sessions: {
    id: string;
    current: boolean;
    kind: string;
    accountId: string | null;
    createdAt: number | null;
    lastSeenAt: number | null;
    expiresAt: number;
  }[];
  recovery: {
    nearAccounts: string[];
    demoPasskeys: number;
    canRevokeOtherSessions: boolean;
    nativePasskeyAccount: false;
  };
};
const readCurrentSessions = () => api<SessionView>("/identity/sessions");
export function AccountSessions({
  player,
  onConnect,
  onSecure,
  onRevoke,
  busy,
  readSessions = readCurrentSessions,
}: {
  readSessions?: () => Promise<SessionView>;
  player: Player;
  onConnect: () => void;
  onSecure?: () => void;
  onRevoke: (account: string) => Promise<boolean>;
  busy: string;
}) {
  const [state, setState] = useState<SessionView | null>(null),
    [error, setError] = useState(""),
    [account, setAccount] = useState(""),
    [review, setReview] = useState(false),
    [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    try {
      const r = await readSessions();
      setState(r);
      setAccount((a) =>
        r.recovery.nearAccounts.includes(a)
          ? a
          : r.recovery.nearAccounts[0] || "",
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setState(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [player.id, player.wallets.map((w) => w.account_id).join(",")]);
  return (
    <section
      className="play-native account-sessions"
      aria-label={tr("Sign-in and recovery")}
    >
      <div className="play-section-heading">
        <h2>
          <ShieldCheck size={22} /> {" "}{tr("Sign-in & coming back")}</h2>
        <button
          className="icon-button"
          aria-label={tr("Refresh sessions")}
          disabled={loading}
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={20} />
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!state && !error && <p role="status">{tr("Loading sessions…")}</p>}
      {state && (
        <>
          <p className="play-hint">
            {state.recovery.nearAccounts.length
              ? tr("Your linked account brings this explorer back on any device.")
              : state.recovery.demoPasskeys
                ? tr("Your passkey brings this explorer back on this device or any device that syncs it.")
                : tr("This explorer lives in this browser. Add a passkey to come back from another device.")}
          </p>
          {!state.recovery.demoPasskeys && onSecure && (
            <button
              className="secondary-button"
              onClick={onSecure}
              disabled={!!busy}
            >
              <ShieldCheck size={20} /> {" "}{tr("Secure with a passkey")}</button>
          )}
          {!state.recovery.nearAccounts.length && (
            <details className="native-extras">
              <summary>
                <Key size={20} /> {" "}{tr("Link a NEAR account")}</summary>
              <p className="play-hint">
                {tr("Optional. Your account signs a short message, pays nothing, and brings the same explorer back in any browser.")}</p>
              <button
                className="secondary-button"
                onClick={onConnect}
                disabled={!!busy}
              >
                <Key size={20} /> {" "}{tr("Link NEAR account")}</button>
            </details>
          )}
          <details className="native-extras">
            <summary>
              <Devices size={20} /> {" "}{tr("Signed in on")}{" "}{state.activeSessionCount}{" "}
              {state.activeSessionCount === 1 ? "device" : "devices"}
              {state.hasMoreSessions ? " +" : ""}
            </summary>
            <ul className="session-list">
              {state.sessions.map((s) => (
                <li key={s.id}>
                  <strong>
                    {s.current ? tr("This browser") : tr("Another device")}
                  </strong>
                  <span>
                    {s.kind === "near-wallet"
                      ? tr("NEAR account")
                      : s.kind === "demo-passkey"
                        ? tr("Passkey")
                        : s.kind === "legacy"
                          ? tr("Earlier session")
                          : tr("Guest")}
                  </span>
                  {s.accountId && <small>{s.accountId}</small>}
                  <small>
                    {s.lastSeenAt
                      ? "Last active " +
                        new Date(s.lastSeenAt).toLocaleString("en-US")
                      : tr("Last activity unknown")}
                  </small>
                </li>
              ))}
            </ul>
          </details>
          <details className="native-extras">
            <summary>{tr("Ways back in")}</summary>
            <p className="play-hint">
              {tr("A linked NEAR account is yours alone; QuestLayer cannot reset it if you lose access.")}</p>
            {state.recovery.nearAccounts.map((a) => (
              <p className="session-account" key={a}>
                <Key size={18} />
                {a}
              </p>
            ))}
            <p className="play-hint">
              {state.recovery.demoPasskeys
                ? tr("{0} passkey(s) can bring this explorer back. They never spend anything.", { 0: state.recovery.demoPasskeys })
                : tr("No passkey is saved for this explorer yet.")}
            </p>
          </details>
          {(state.activeSessionCount > 1 ||
            state.recovery.canRevokeOtherSessions) && (
            <>
              <button
                className="secondary-button"
                disabled={!!busy || !state.recovery.canRevokeOtherSessions}
                onClick={() => setReview(!review)}
              >
                <SignOut size={20} />{" "}
                {state.activeSessionCount > 1
                  ? tr("Sign out other devices")
                  : tr("Renew this sign-in")}
              </button>
              {!state.recovery.canRevokeOtherSessions && (
                <small>{tr("Link a NEAR account to confirm this change.")}</small>
              )}
            </>
          )}
          {review && (
            <div className="session-review">
              <label>
                {tr("Confirm with your linked account")}<select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {state.recovery.nearAccounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <p>
                {tr("This browser gets a fresh sign-in and every other device is signed out. Your account and passkeys still work to sign in again.")}</p>
              <div className="play-task-actions">
                <button
                  className="primary-button"
                  disabled={!!busy || !account}
                  onClick={async () => {
                    if (await onRevoke(account)) {
                      setReview(false);
                      await refresh();
                    }
                  }}
                >
                  {busy === "session-recovery"
                    ? tr("Waiting for your approval…")
                    : state.activeSessionCount > 1
                      ? tr("Confirm & sign out others")
                      : tr("Confirm & renew sign-in")}
                </button>
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() => setReview(false)}
                >
                  {tr("Cancel")}</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
