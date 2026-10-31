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
export type SessionView = {
  network: "testnet";
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
      aria-label="Sign-in and recovery"
    >
      <div className="play-section-heading">
        <h2>
          <ShieldCheck size={22} /> Sign-in & recovery
        </h2>
        <button
          className="icon-button"
          aria-label="Refresh game sessions"
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
      {!state && !error && <p role="status">Loading game sessions…</p>}
      {state && (
        <>
          <p className="play-hint">
            {state.recovery.nearAccounts.length
              ? "Sign in with the same linked account to restore this explorer."
              : state.recovery.demoPasskeys
                ? "A passkey can restore this explorer on this device or any device that syncs it."
                : "This explorer is saved in this browser. Add a passkey to come back from another device."}
          </p>
          {!state.recovery.demoPasskeys && onSecure && (
            <button
              className="secondary-button"
              onClick={onSecure}
              disabled={!!busy}
            >
              <ShieldCheck size={20} /> Secure with a passkey
            </button>
          )}
          {!state.recovery.nearAccounts.length && (
            <details className="native-extras">
              <summary>
                <Key size={20} /> Link an external NEAR wallet
              </summary>
              <p className="play-hint">
                Optional. A wallet signs a message, not a payment, and restores
                the same explorer from any browser.
              </p>
              <button
                className="secondary-button"
                onClick={onConnect}
                disabled={!!busy}
              >
                <Key size={20} /> Link NEAR wallet
              </button>
            </details>
          )}
          <details className="native-extras">
            <summary>
              <Devices size={20} /> {state.activeSessionCount} active game{" "}
              {state.activeSessionCount === 1 ? "session" : "sessions"}
              {state.hasMoreSessions ? " +" : ""}
            </summary>
            <ul className="session-list">
              {state.sessions.map((s) => (
                <li key={s.id}>
                  <strong>
                    {s.current ? "This browser" : "Other session"}
                  </strong>
                  <span>
                    {s.kind === "near-wallet"
                      ? "NEAR wallet"
                      : s.kind === "demo-passkey"
                        ? "Demo passkey"
                        : s.kind === "legacy"
                          ? "Earlier session"
                          : "Guest"}
                  </span>
                  {s.accountId && <small>{s.accountId}</small>}
                  <small>
                    {s.lastSeenAt
                      ? "Last active " +
                        new Date(s.lastSeenAt).toLocaleString("en-US")
                      : "Activity time unavailable"}
                  </small>
                </li>
              ))}
            </ul>
          </details>
          <details className="native-extras">
            <summary>Recovery options</summary>
            <p className="play-hint">
              Your wallet holds its keys and recovery phrase. QuestLayer cannot
              reset a lost wallet.
            </p>
            {state.recovery.nearAccounts.map((a) => (
              <p className="session-account" key={a}>
                <Key size={18} />
                {a}
              </p>
            ))}
            <p className="play-hint">
              {state.recovery.demoPasskeys
                ? `${state.recovery.demoPasskeys} browser passkey(s) can restore demo progress. They do not sign NEAR transactions.`
                : "No demo passkey is saved for this explorer."}
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
                  ? "Sign out other sessions"
                  : "Renew browser sign-in"}
              </button>
              {!state.recovery.canRevokeOtherSessions && (
                <small>Link a NEAR wallet to verify this change.</small>
              )}
            </>
          )}
          {review && (
            <div className="session-review">
              <label>
                Verify with your linked wallet
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {state.recovery.nearAccounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <p>
                This renews this browser’s sign-in and expires its previous
                sign-in, including any copies. Other game sessions are signed
                out. Your wallet keys and saved passkeys stay usable for signing
                in again.
              </p>
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
                    ? "Waiting for wallet…"
                    : state.activeSessionCount > 1
                      ? "Verify & sign out others"
                      : "Verify & renew sign-in"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() => setReview(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
