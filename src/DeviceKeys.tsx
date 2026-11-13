// Profile: the devices that can act for the invisible NEAR account, the
// recovery passkey, and the lost-device flow.
import { useState } from "react";
import {
  DeviceMobile,
  Fingerprint,
  Key,
  ArrowClockwise,
  ShieldCheck,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  deviceRows,
  hasRecoveryPasskey,
  hasWalletWords,
  type AccountKey,
} from "./account-recovery";
import type { InvisibleAccountStatus } from "./useInvisibleAccount";
import { tr } from "./i18n";
import { WalletWords } from "./WalletWords";

export function DeviceKeys({
  status,
  accountId,
  keys,
  localPublicKey,
  busy,
  onSetupRecovery,
  onRevoke,
  onRestore,
  onExportWallet,
  error = null,
  onRetry,
  onStartOver,
  part,
}: {
  /** Settings shows the save steps under Account ("main") and the device list under Advanced. */
  part?: "main" | "advanced";
  status: InvisibleAccountStatus;
  accountId: string | null;
  error?: string | null;
  onRetry?: () => void;
  keys: AccountKey[];
  localPublicKey: string | null;
  busy: string;
  onSetupRecovery: () => Promise<boolean>;
  onRevoke: (publicKey: string, signOutOthers: boolean) => Promise<boolean>;
  onRestore: () => Promise<boolean>;
  onExportWallet?: () => Promise<boolean>;
  /** Testnet without a recovery passkey: start a new account on this device. */
  onStartOver?: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState<string | null>(null),
    [lost, setLost] = useState(false),
    [signOut, setSignOut] = useState(true),
    [startingOver, setStartingOver] = useState(false);
  if (part === "advanced" && status !== "ready") return null;
  if (status === "error")
    // Without this the player never learns why the account did not appear.
    return (
      <section
        className="play-native account-devices"
        aria-label={tr("Devices and recovery")}
      >
        <div className="play-section-heading">
          <h2>
            <WarningCircle size={22} /> {" "}{tr("Secure account unavailable on this device")}</h2>
        </div>
        <p className="play-hint" role="status">
          {/storage is blocked/.test(error ?? "")
            ? tr("This browser is blocking the storage your explorer account key needs, as happens in some private windows or when site data is blocked. Allow site data for QuestLayer or open it in your usual browser, then try again. Free play keeps working.")
            : tr("Your explorer account could not be prepared on this device. Free play keeps working.")}
        </p>
        {error && !/storage is blocked/.test(error) && <p className="play-hint"><small>{error}</small></p>}
        {onRetry && (
          <button className="secondary-button" disabled={!!busy} onClick={onRetry}>
            <ArrowClockwise size={20} />
            {tr("Try again")}
          </button>
        )}
      </section>
    );
  if (status === "unavailable" || status === "idle" || !accountId) return null;
  if (status === "needs-recovery")
    return (
      <section
        className="play-native account-devices"
        aria-label={tr("Devices and recovery")}
      >
        <div className="play-section-heading">
          <h2>
            <DeviceMobile size={22} /> {" "}{tr("This device is not set up yet")}</h2>
        </div>
        <p className="play-hint">
          {tr("Your explorer account")}{" "}{accountId} {" "}{tr("was created on another device. Use your recovery passkey to let this device play with it too. Nothing is paid and no secret leaves your passkey.")}</p>
        <button
          className="primary-button"
          disabled={!!busy}
          onClick={() => void onRestore()}
        >
          <Fingerprint size={20} />
          {busy === "recovery-restore"
            ? tr("Adding this device…")
            : tr("Use my recovery passkey")}
        </button>
        <p className="play-hint">
          {tr("No recovery passkey yet? Keep playing on the device that created your explorer and add one under Profile there first.")}</p>
        {onStartOver && (
          startingOver ? (
            <div className="play-task-actions">
              <p className="play-hint">
                {tr("Test network only. Your explorer, XP, finds and items stay. A new NEAR account is made on this device; QGOLD and tokens on the old account stay there and the game stops using it.")}
              </p>
              <button className="primary-button" disabled={!!busy} onClick={() => void onStartOver().then((ok) => ok && setStartingOver(false))}>
                {busy === "start-over" ? tr("Starting over…") : tr("Start with a new account")}
              </button>
              <button className="secondary-button" disabled={!!busy} onClick={() => setStartingOver(false)}>
                {tr("Cancel")}
              </button>
            </div>
          ) : (
            <button className="secondary-button" disabled={!!busy} onClick={() => setStartingOver(true)}>
              <ArrowClockwise size={20} />
              {tr("Lost that device? Start with a new account here")}
            </button>
          )
        )}
      </section>
    );
  if (status !== "ready") return null;
  const rows = deviceRows(keys, localPublicKey),
    recovery = hasRecoveryPasskey(keys),
    others = rows.filter((r) => !r.current && r.kind === "device");
  const saveSteps = (
    <>
      {!recovery ? (
        <div className="session-review">
          <p>
            <ShieldCheck size={18} /> {" "}{tr("Add a passkey to bring this explorer to a new phone, even if this one is lost.")}</p>
          <button
            className="secondary-button"
            disabled={!!busy}
            onClick={() => void onSetupRecovery()}
          >
            <Fingerprint size={20} />
            {busy === "recovery-setup"
              ? tr("Saving your recovery passkey…")
              : tr("Create a recovery passkey")}
          </button>
        </div>
      ) : (
        <p className="play-hint">
          <Key size={16} /> {" "}{tr("On a new device choose “Restore with a recovery passkey” on the welcome screen.")}</p>
      )}
      {onExportWallet && (
        <WalletWords
          accountId={accountId}
          hasWords={hasWalletWords(keys)}
          busy={busy}
          onExport={onExportWallet}
        />
      )}
    </>
  );
  const deviceList = (
    <>
      <div className="play-section-heading">
        <h2>
          <DeviceMobile size={22} /> {" "}{tr("Devices")}</h2>
      </div>
      <p className="play-hint">
        {onExportWallet
          ? tr("Keys that can act for this account. Each one stays on its own device; QuestLayer never holds them.")
          : <>{tr("These keys can act for your explorer account")}{" "}<small>{accountId}</small>{tr(". Each one stays on its own device; QuestLayer never holds them.")}</>}</p>
      <ul className="session-list device-list">
        {rows.map((row) => (
          <li key={row.publicKey}>
            <strong>
              {row.kind === "recovery" ? (
                <Fingerprint size={16} />
              ) : row.wallet ? (
                <Key size={16} />
              ) : (
                <DeviceMobile size={16} />
              )}{" "}
              {row.title}
            </strong>
            <small>{row.detail}</small>
            {row.canRevoke &&
              (confirm === row.publicKey ? (
                <span className="play-task-actions">
                  <button
                    className="primary-button"
                    disabled={!!busy}
                    onClick={async () => {
                      if (await onRevoke(row.publicKey, false))
                        setConfirm(null);
                    }}
                  >
                    {busy === "device-revoke" ? tr("Revoking…") : tr("Confirm revoke")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() => setConfirm(null)}
                  >
                    {tr("Keep")}</button>
                </span>
              ) : (
                <button
                  className="text-button"
                  disabled={!!busy}
                  aria-label={tr("Revoke {0}", { 0: row.title })}
                  onClick={() => setConfirm(row.publicKey)}
                >
                  <Trash size={16} /> {" "}{tr("Revoke")}</button>
              ))}
          </li>
        ))}
      </ul>
      <details
        className="native-extras"
        open={lost}
        onToggle={(e) => setLost((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <WarningCircle size={20} /> {" "}{tr("Lost a device?")}</summary>
        {others.length === 0 ? (
          <p className="play-hint">
            {tr("No other device can act for this explorer. If you lose this one, restore on a new device with your recovery passkey")}{recovery ? "." : tr(" (create one above first).")}
          </p>
        ) : (
          <>
            <p className="play-hint">
              {tr("Revoke the lost device here. It can no longer sign anything for your account once the network confirms the change, usually within seconds.")}</p>
            <label className="session-check">
              <input
                type="checkbox"
                checked={signOut}
                onChange={(e) => setSignOut(e.target.checked)}
              />
              {tr("Also sign out every other game session")}</label>
            <ul className="session-list">
              {others.map((row) => (
                <li key={row.publicKey}>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                  <button
                    className="secondary-button"
                    disabled={!!busy || !row.canRevoke}
                    onClick={() => void onRevoke(row.publicKey, signOut)}
                  >
                    <Trash size={16} />
                    {busy === "device-revoke"
                      ? tr("Revoking…")
                      : tr("This one is lost, revoke it")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
  );
  return (
    <section
      className={part === "main" ? "play-native account-save" : "play-native account-devices"}
      aria-label={tr("Devices and recovery")}
    >
      {part !== "advanced" && saveSteps}
      {part !== "main" && deviceList}
    </section>
  );
}
