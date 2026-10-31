import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Star, Check, Lock } from "@phosphor-icons/react";
import { api } from "./api";
import { AuraArt } from "./Ghost";
import type { Player } from "./types";
export type NativeMilestone = {
  level: number;
  edition: string;
  name: string;
  requiredXp: string;
  state: string;
  claimable: boolean;
  claimId: string;
  tokenId?: string;
  remaining?: number;
};
export type Progress = {
  status: string;
  network: "testnet";
  accountId: string;
  sourceContractId: string;
  policy: string;
  xp: string | null;
  level: number;
  levelStartXp: string;
  nextLevelXp: string;
  xpToNextLevel: string;
  milestones: NativeMilestone[];
  error?: string;
  reason?: string;
};
const readConfirmedProgress = (accountId: string) =>
  api<Progress>("/native/progression", { accountId });
export function NativeLevelRewards({
  player,
  account,
  onAccount,
  onConnect,
  busy,
  onMint,
  onConfirm,
  readProgress = readConfirmedProgress,
}: {
  readProgress?: (account: string) => Promise<Progress>;
  player: Player;
  account: string;
  onAccount: (account: string) => void;
  onConnect: () => void;
  busy: string;
  onMint: (account: string, m: NativeMilestone) => Promise<boolean>;
  onConfirm: (account: string, level: number) => Promise<boolean>;
}) {
  const [snapshot, setSnapshot] = useState<Progress | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<NativeMilestone | null>(null),
    [ack, setAck] = useState(false);
  const latest = useRef(account);
  latest.current = account;
  const state = snapshot?.accountId === account ? snapshot : null;
  async function refresh() {
    const who = account;
    if (!who) return;
    setLoading(true);
    try {
      const r = await readProgress(who);
      if (latest.current === who) {
        setSnapshot(r);
        setError("");
      }
    } catch (e) {
      if (latest.current === who) {
        setSnapshot(null);
        setError((e as Error).message);
      }
    } finally {
      if (latest.current === who) setLoading(false);
    }
  }
  useEffect(() => {
    setSelected(null);
    setAck(false);
    setSnapshot(null);
    setError("");
    void refresh();
  }, [account, player.id]);
  const valid = state?.status === "available";
  return (
    <section
      className="play-native native-level-rewards"
      aria-label="NEAR level rewards"
    >
      <div className="play-section-heading">
        <h3>
          <Star size={22} /> NEAR level rewards
        </h3>
        {account && (
          <button
            className="icon-button"
            aria-label="Refresh confirmed XP"
            disabled={loading || !!busy}
            onClick={() => void refresh()}
          >
            <ArrowClockwise size={20} />
          </button>
        )}
      </div>
      {!account ? (
        <>
          <p className="play-hint">
            Collect testnet street coins and finish walks to earn confirmed XP
            and cosmetic rewards.
          </p>
          <button className="secondary-button" onClick={onConnect}>
            Link NEAR wallet
          </button>
        </>
      ) : (
        <>
          {player.wallets.length > 1 && (
            <label>
              Reward wallet
              <select
                value={account}
                onChange={(e) => onAccount(e.target.value)}
              >
                {player.wallets.map((w) => (
                  <option key={w.account_id}>{w.account_id}</option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {state && state.xp === null && (
            <p className="inline-error">
              {state.reason ||
                "Confirmed XP is currently unavailable. Refresh to retry."}
            </p>
          )}
          {loading && !state && <p role="status">Checking confirmed XP…</p>}
          {state && state.xp !== null && (
            <>
              <div className="native-level-summary">
                <strong>Level {state.level}</strong>
                <span>
                  {BigInt(state.xp).toLocaleString("en-US")} confirmed XP
                </span>
              </div>
              <progress
                aria-label="Confirmed XP toward next level"
                value={Number(BigInt(state.xp) - BigInt(state.levelStartXp))}
                max={Number(
                  BigInt(state.nextLevelXp) - BigInt(state.levelStartXp),
                )}
              />
              <small>
                {BigInt(state.xpToNextLevel).toLocaleString("en-US")} XP to
                level {state.level + 1}
              </small>
              {state.status !== "available" && (
                <p className="inline-error">
                  {state.reason ||
                    state.error ||
                    "Reward verification is unavailable. Refresh before claiming."}
                </p>
              )}
              <div className="native-milestones">
                {state.milestones.map((m) => (
                  <button
                    key={m.level}
                    className={selected?.level === m.level ? "selected" : ""}
                    disabled={!valid || (!m.claimable && m.state !== "issued")}
                    onClick={() => {
                      setSelected(m);
                      setAck(false);
                    }}
                  >
                    <AuraArt
                      color={
                        m.edition === "polar"
                          ? "#59ddcc"
                          : m.edition === "moon"
                            ? "#b8a0ee"
                            : "#ffd667"
                      }
                      slot={m.edition === "moon" ? "below" : "above"}
                    />
                    <strong>Level {m.level}</strong>
                    <small>
                      {m.state === "minted" ? (
                        <>
                          <Check size={16} /> Claimed
                        </>
                      ) : m.state === "sold_out" ? (
                        "Sold out"
                      ) : m.claimable || m.state === "issued" ? (
                        "Claim Aura"
                      ) : (
                        <>
                          <Lock size={14} />
                          {m.requiredXp} XP
                        </>
                      )}
                    </small>
                  </button>
                ))}
              </div>
              <p className="play-hint">
                Testnet XP is separate from demo progress. Limited cosmetic
                editions share a supply; unlocking a level does not reserve an
                item.
              </p>
            </>
          )}
          {selected && valid && (
            <div className="session-review">
              <h4>{selected.name}</h4>
              <p>
                Mint this level reward to{" "}
                <b className="session-account">{account}</b>.
              </p>
              <label className="play-consent">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />{" "}
                I understand this uses 0.05 test NEAR for NFT storage, plus a
                small network fee.
              </label>
              <div className="play-task-actions">
                <button
                  className="primary-button"
                  disabled={!ack || !!busy}
                  onClick={async () => {
                    if (await onMint(account, selected)) {
                      setSelected(null);
                      await refresh();
                    }
                  }}
                >
                  {busy === "native-level"
                    ? "Waiting for wallet…"
                    : "Claim Aura NFT"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={async () => {
                    await onConfirm(account, selected.level);
                    await refresh();
                  }}
                >
                  Check claim
                </button>
                <button
                  className="secondary-button"
                  disabled={!!busy}
                  onClick={() => setSelected(null)}
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
