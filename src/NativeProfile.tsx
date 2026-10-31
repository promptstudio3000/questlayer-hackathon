import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Wallet } from "@phosphor-icons/react";
import { api } from "./api";
import { formatNativeNear } from "./native-amounts";
import type { NativeProfileState, Player } from "./types";
export const SOCIAL_TESTNET = "v1.social08.testnet";
const loadProfile = (accountId: string, fresh: boolean) =>
  api<NativeProfileState>(
    `/native/profile?accountId=${encodeURIComponent(accountId)}${fresh ? "&refresh=1" : ""}`,
  );
export function NativeProfilePanel({
  player,
  busy,
  onConnect,
  onPublish,
  readProfile = loadProfile,
}: {
  player: Player;
  busy: string;
  onConnect: () => Promise<void>;
  onPublish: (
    accountId: string,
    avatar: NativeProfileState["publishAvatar"],
  ) => Promise<boolean>;
  readProfile?: (
    accountId: string,
    fresh: boolean,
  ) => Promise<NativeProfileState>;
}) {
  const accounts = player.wallets.map((w) => w.account_id),
    [selected, setSelected] = useState(""),
    [data, setData] = useState<NativeProfileState | null>(null),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [revision, setRevision] = useState(0);
  const accountId = accounts.includes(selected) ? selected : accounts[0] || "",
    snapshot = data?.accountId === accountId ? data : null;
  useEffect(() => {
    setConsent(false);
    setData(null);
    setError("");
  }, [accountId]);
  useEffect(() => {
    if (!accountId) return;
    let current = true;
    readProfile(accountId, revision > 0)
      .then((value) => {
        if (current) {
          setData(value);
          setError("");
        }
      })
      .catch(() => {
        if (current)
          setError(
            "Your NEAR Social profile is temporarily unavailable. Try again.",
          );
      });
    return () => {
      current = false;
    };
  }, [accountId, revision, readProfile]);
  async function publish() {
    if (!consent || !accountId || !snapshot) return;
    const confirmed = await onPublish(accountId, snapshot.publishAvatar);
    setRevision((r) => r + 1);
    if (confirmed) setConsent(false);
  }
  return (
    <section
      className="native-card native-profile"
      aria-label="Public NEAR profile"
    >
      <header>
        <div>
          <span className="eyebrow">NEAR SOCIAL · TESTNET</span>
          <h3>Your public explorer</h3>
        </div>
        <Wallet size={24} aria-hidden="true" />
      </header>
      <p>
        Save your game alias and your NEAR avatar reference with NEAR Social.
        Your location, balance and inventory stay out of this profile.
      </p>
      {!accountId ? (
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() => void onConnect()}
        >
          Connect NEAR wallet
        </button>
      ) : (
        <>
          {accounts.length > 1 ? (
            <label className="profile-account">
              Profile wallet
              <select
                value={accountId}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!!busy}
              >
                {accounts.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="native-account-id">{accountId}</p>
          <div className="profile-alias">
            <span>Game alias</span>
            <strong>{player.name}</strong>
          </div>
          {error ? (
            <p className="notice" role="alert">
              {error}
            </p>
          ) : !snapshot ? (
            <p role="status">Checking NEAR Social…</p>
          ) : (
            <>
              <p className="profile-avatar">
                {snapshot.publishAvatar ? (
                  <>
                    <span>Owned NEAR avatar to link</span>
                    <strong>{snapshot.publishAvatar.tokenId}</strong>
                  </>
                ) : (
                  "No NEAR avatar reference will be included. Your alias can still be published."
                )}
              </p>
              {snapshot.status === "published" && (
                <p className="profile-published">
                  Published alias: <strong>{snapshot.profile?.name}</strong>
                  {snapshot.profile?.avatar && (
                    <span>
                      {snapshot.avatarVerified
                        ? "Owned NEAR avatar linked."
                        : "This avatar reference is no longer verified as yours."}
                    </span>
                  )}
                </p>
              )}
              {snapshot.status === "unsupported" && (
                <p className="notice">
                  An earlier profile format is present. Publishing updates
                  QuestLayer’s profile fields.
                </p>
              )}
              <p className="profile-storage">
                Wallet attachment:{" "}
                <strong>
                  {snapshot.deposit === "1"
                    ? "1 yoctoNEAR"
                    : `${formatNativeNear(snapshot.deposit)} test NEAR`}
                </strong>
                {snapshot.deposit !== "1" &&
                  " as storage credit, plus the network fee. Unused credit stays in your NEAR Social storage balance."}
                {snapshot.deposit === "1" &&
                  " plus the network fee. Your existing NEAR Social storage credit covers the profile."}
              </p>
              <label className="profile-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={!!busy}
                />
                <span>
                  Make this alias and avatar reference public on NEAR testnet.
                  <small>Blockchain transaction history remains public.</small>
                </span>
              </label>
              {!snapshot.publishEnabled && (
                <p className="notice" role="status">
                  Publishing is paused while the profile contract is checked.
                </p>
              )}
              <button
                className="primary-button"
                disabled={!!busy || !consent || !snapshot.publishEnabled}
                onClick={() => void publish()}
              >
                {busy === "native-profile"
                  ? "Confirm in your wallet…"
                  : "Publish QuestLayer profile"}
              </button>
            </>
          )}
          <div className="profile-links">
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => setRevision((r) => r + 1)}
            >
              <ArrowClockwise aria-hidden="true" />
              Refresh profile
            </button>
            <a
              href={`https://testnet.nearblocks.io/address/${SOCIAL_TESTNET}`}
              target="_blank"
              rel="noreferrer"
            >
              NEAR Social contract
              <ArrowSquareOut aria-hidden="true" />
            </a>
          </div>
        </>
      )}
    </section>
  );
}
