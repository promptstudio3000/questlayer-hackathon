import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  MapPin,
  NavigationArrow,
  Wallet,
} from "@phosphor-icons/react";
import { api, meters } from "./api";
import type { Fix, Player, Point } from "./types";
type Quest = {
  prizeClaimed: boolean;
  prizePending: boolean;
  index: number;
  name: string;
  title: string;
  prompt: string;
  targets: Point[];
  tier: number;
  reward: string;
  xp: number;
  opensAt: number;
  closesAt: number;
  checkpoint: number;
};
type Receipt = {
  id: string;
  kind: string;
  index: number;
  state: string;
  amount: string | null;
  xp: number | null;
  transaction: string | null;
  createdAt: number;
  error: string | null;
};
type State = {
  status: string;
  contractId: string;
  enrolled: boolean;
  access: { tier: number; weighted: string };
  balance: {
    credit: string;
    pending: string;
    withdrawn: string;
    xp: number;
  } | null;
  day: {
    id: string;
    day: string;
    endsAt: number;
    coinUnit: string;
    coinCount: number;
    claimsAccepted: number;
    claimsLimit: number;
    coins: (Point & { index: number; distance: number })[];
    quests: Quest[];
  } | null;
  receipts: Receipt[];
  treasury: {
    coins: { available: string; reserved: string };
    zones: { available: string; reserved: string };
  };
  worker: { queued: number; last_error: string | null };
  vaults: {
    accountId: string;
    beneficiary: string;
    observation?: {
      last_state: string | null;
      last_error: string | null;
    } | null;
  }[];
};
const nearAmount = (s: string) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(
    Number(s) / 1e24,
  );
const nativeGold = (s: string) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 }).format(
    Number(s) / 1e21,
  );
export function NativeExpeditions({
  player,
  fix,
  arena,
  position,
  onConnect,
  onLocate,
  onFocus,
  onWithdraw,
}: {
  player: Player;
  fix: Fix | null;
  arena: boolean;
  position: Point;
  onConnect: () => void;
  onLocate: () => void;
  onFocus: (p: Point & { label: string }) => void;
  onWithdraw: (account: string, contract: string) => Promise<boolean>;
}) {
  const [account, setAccount] = useState(player.wallets[0]?.account_id || ""),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [expanded, setExpanded] = useState(false);
  const latest = useRef({ position, account });
  latest.current = { position, account };
  const mounted = useRef(true);
  async function refresh(fresh = false) {
    const p = latest.current;
    try {
      const s = await api<State>("/native/rewards/nearby", {
        location: p.position,
        accountId: p.account || undefined,
        fresh,
      });
      if (mounted.current && p.account === latest.current.account) {
        setState(s);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [account]);
  useEffect(() => {
    if (!player.wallets.some((w) => w.account_id === account))
      setAccount(player.wallets[0]?.account_id || "");
  }, [player.wallets.map((w) => w.account_id).join("|")]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function visit(
    kind: "coin" | "quest",
    index: number,
    checkpoint?: number,
  ) {
    await act(async () => {
      if (!state?.day) throw Error("The native day is not ready.");
      const result = await api<{
        state: string;
        checkpoint?: number;
        total?: number;
      }>("/native/rewards/visit", {
        accountId: account,
        dayId: state.day.id,
        kind,
        index,
        checkpoint,
        mode: arena ? "arena" : "gps",
        fix,
      });
      setNotice(
        result.state === "progress"
          ? `Checkpoint ${result.checkpoint} of ${result.total} recorded. Continue to the next stop.`
          : "Visit accepted. Your native receipt is waiting for chain confirmation.",
      );
    });
  }
  const gpsReady =
    !arena &&
    !!fix &&
    fix.accuracy <= 35 &&
    Date.now() - fix.timestamp <= 15000;
  const eligible =
    !!account &&
    state?.enrolled &&
    gpsReady &&
    !busy &&
    !!state.day &&
    state.day.claimsAccepted < state.day.claimsLimit;
  return (
    <section
      className="native-expeditions"
      aria-labelledby="native-expeditions-title"
    >
      <div className="native-expedition-heading">
        <MapPin size={26} />
        <div>
          <h2 id="native-expeditions-title">NEAR expeditions</h2>
          <p>Real testnet receipts for real places</p>
        </div>
      </div>
      <p>
        Street coins and six solo walks across Plzeň. Pilot rewards use
        sponsored test NEAR and stay separate from your demo GOLD. Test tokens
        have no monetary value.
      </p>
      {error && (
        <p className="native-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="native-notice" role="status">
          {notice}
        </p>
      )}
      {!state && <p role="status">Loading the native expedition board…</p>}
      {state?.status === "not-configured" && (
        <p>The native pilot is not configured on this server yet.</p>
      )}
      {state?.contractId && (
        <>
          <div className="native-expedition-actions">
            {!account ? (
              <button onClick={onConnect}>
                <Wallet size={20} /> Connect a NEAR wallet
              </button>
            ) : (
              <label>
                Receiving wallet
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {player.wallets.map((w) => (
                    <option key={w.account_id}>{w.account_id}</option>
                  ))}
                </select>
              </label>
            )}
            <button disabled={busy} onClick={() => void refresh(true)}>
              Refresh testnet status
            </button>
          </div>
          {account && !state.enrolled && (
            <div className="native-consent">
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  I understand that native receipts are public and may link my
                  wallet to these locations. GPS comes from my browser and is
                  not independently verified.
                </span>
              </label>
              <button
                disabled={!consent || busy}
                onClick={() =>
                  void act(async () => {
                    await api("/native/rewards/join", {
                      accountId: account,
                      consent: true,
                    });
                    setNotice(
                      "You joined the testnet pilot. Choose an expedition or a street coin.",
                    );
                  })
                }
              >
                Join testnet expeditions <ArrowRight size={20} />
              </button>
            </div>
          )}
          {state.balance && (
            <div className="native-balance">
              <div>
                <small>Confirmed and claimable</small>
                <strong>{nearAmount(state.balance.credit)} test NEAR</strong>
                <span>
                  {nativeGold(state.balance.credit)} GOLD equivalent ·{" "}
                  {state.balance.xp} native XP
                </span>
              </div>
              <button
                disabled={
                  busy ||
                  state.balance.credit === "0" ||
                  state.balance.pending !== "0"
                }
                onClick={() =>
                  void act(async () => {
                    if (await onWithdraw(account, state.contractId))
                      setNotice(
                        "Withdrawal submitted. The balance below is read from NEAR.",
                      );
                  })
                }
              >
                Withdraw to wallet
              </button>
              <p className="native-secondary">
                Network fees can exceed a small reward. Combine rewards before
                withdrawing and keep test NEAR in your wallet for gas.
              </p>
              {state.balance.pending !== "0" && (
                <p>
                  <Clock /> Withdrawal is pending on NEAR.
                </p>
              )}
            </div>
          )}
          <p className="native-secondary">
            Native Tier {state.access.tier} ·{" "}
            {nativeGold(state.access.weighted)} eligible GOLD. Demo deposits
            never unlock native rewards. Higher-tier walks are currently
            reserved for the staking pilot.
          </p>
          {state.day && (
            <p className="native-secondary">
              Daily native pilot capacity: {state.day.claimsAccepted}/
              {state.day.claimsLimit} receipts across all explorers. This limit
              covers sponsored blockchain storage; demo play continues when it
              fills.
            </p>
          )}
          {!gpsReady && (
            <div className="native-location-state">
              <NavigationArrow size={20} />
              <span>
                {arena
                  ? "You are in the demo arena. Turn on GPS to record a native visit."
                  : "A fresh location within 35 m accuracy is required."}
              </span>
              <button onClick={onLocate}>Use my GPS location</button>
            </div>
          )}
          <button
            className="native-board-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide expedition board" : "Open expedition board"}{" "}
            <ArrowRight size={20} />
          </button>
          {expanded && state.day && (
            <>
              <p className="native-secondary">
                {state.day.day} · Three checkpoints per walk. Distances are
                straight-line estimates. Stay on safe public paths; the imported
                locations still need field review.
              </p>
              <h3>Street trail</h3>
              <p>
                {nativeGold(state.day.coinUnit)} GOLD equivalent per shared
                coin. The pilot allows 100 native coins per wallet per day.
              </p>
              {state.day.coins.length === 0 ? (
                <p>No native coins within 1 km of your current map position.</p>
              ) : (
                <div className="native-coin-list">
                  {state.day.coins.slice(0, 5).map((c) => (
                    <div key={c.index}>
                      <span>Street coin · {c.distance} m</span>
                      <button
                        onClick={() =>
                          onFocus({ ...c, label: "Native street coin" })
                        }
                        aria-label={`Show native coin ${c.index} on map`}
                      >
                        <MapPin size={20} />
                      </button>
                      <button
                        disabled={!eligible || c.distance > 35}
                        onClick={() => void visit("coin", c.index)}
                      >
                        Collect
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <h3>Explore a place</h3>
              <div className="native-quest-list">
                {state.day.quests.map((q) => {
                  const done = q.checkpoint >= q.targets.length,
                    target =
                      q.targets[Math.min(q.checkpoint, q.targets.length - 1)],
                    d = Math.round(meters(position, target)),
                    open = Date.now() >= q.opensAt && Date.now() < q.closesAt,
                    locked = q.tier > state.access.tier;
                  return (
                    <article key={q.index} className="native-quest">
                      <small>
                        {q.name} · Native Tier {q.tier}
                      </small>
                      <h4>{q.title}</h4>
                      <p>{q.prompt}</p>
                      <p className="native-secondary">
                        {q.xp} native XP
                        {q.reward !== "0"
                          ? q.prizeClaimed
                            ? " · Shared prize already claimed; personal XP is still available"
                            : q.prizePending
                              ? " · Shared prize awaiting confirmation"
                              : ` · ${nativeGold(q.reward)} GOLD equivalent for the first valid finish`
                          : ""}
                        . Checkpoint {Math.min(q.checkpoint + 1, 3)} of 3 · {d}{" "}
                        m away.
                      </p>
                      <div className="native-expedition-actions">
                        <button
                          onClick={() =>
                            onFocus({
                              ...target,
                              label: `${q.title} · stop ${Math.min(q.checkpoint + 1, 3)}`,
                            })
                          }
                        >
                          <MapPin size={20} /> Show checkpoint
                        </button>
                        <button
                          disabled={
                            !eligible || done || locked || !open || d > 35
                          }
                          onClick={() =>
                            void visit("quest", q.index, q.checkpoint)
                          }
                        >
                          {done
                            ? "Walk recorded"
                            : locked
                              ? `Requires native Tier ${q.tier}`
                              : !open
                                ? "Zone closed"
                                : d > 35
                                  ? "Move closer"
                                  : "Record checkpoint"}
                        </button>
                      </div>
                      <small>
                        {q.closesAt - q.opensAt >= 23 * 3600000 ? (
                          "Open all day (Plzeň time). "
                        ) : (
                          <>
                            Opens{" "}
                            {new Date(q.opensAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Europe/Prague",
                            })}{" "}
                            · closes{" "}
                            {new Date(q.closesAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Europe/Prague",
                            })}
                            {" (Plzeň time). "}
                          </>
                        )}
                        Observation is optional; the receipt attests GPS
                        checkpoints.
                      </small>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {expanded && !state.day && (
            <p>
              Waiting for a funded, confirmed native world. Rewards are not
              promised before publication succeeds.
            </p>
          )}
          {state.receipts.length > 0 && (
            <details className="native-receipts">
              <summary>Your native receipts ({state.receipts.length})</summary>
              {state.receipts.slice(0, 12).map((r) => (
                <div key={r.id}>
                  {r.state === "confirmed" ? (
                    <CheckCircle size={20} />
                  ) : (
                    <Clock size={20} />
                  )}
                  <span>
                    {r.kind === "coin" ? "Street coin" : "Solo expedition"} ·{" "}
                    {r.state === "confirmed"
                      ? `${nativeGold(r.amount || "0")} GOLD equivalent + ${r.xp} XP`
                      : r.state === "retrying"
                        ? "Retrying confirmation; accepted receipt preserved"
                        : "Waiting for NEAR confirmation"}
                  </span>
                  {r.transaction && (
                    <a
                      href={`https://testnet.nearblocks.io/txns/${r.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Receipt
                    </a>
                  )}
                </div>
              ))}
            </details>
          )}
          <details className="native-receipts">
            <summary>Native funding and staking pilot</summary>
            <p>
              Available street fund:{" "}
              {nearAmount(state.treasury.coins.available)} test NEAR. Available
              zone fund: {nearAmount(state.treasury.zones.available)} test NEAR.
              New confirmed income is split 50/50.
            </p>
            {state.vaults.map((v) => {
              let s: Record<string, string> | null = null;
              try {
                s = v.observation?.last_state
                  ? JSON.parse(v.observation.last_state)
                  : null;
              } catch {}
              return (
                <div key={v.accountId} className="native-vault">
                  <strong>Project test vault</strong>
                  <span>
                    {s
                      ? `${nearAmount(s.staked)} test NEAR staked · ${s.stage.replaceAll("_", " ")}`
                      : "Waiting for a fresh pool observation"}
                  </span>
                  {s && s.stage === "unlocking" && (
                    <span>
                      Release no earlier than epoch {s.unlock_epoch}; current
                      observation {s.epoch}.
                    </span>
                  )}
                  <a
                    href={`https://testnet.nearblocks.io/address/${v.accountId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Inspect the contract
                  </a>
                </div>
              );
            })}
            <p>
              These isolated vaults test real validator deposits and epoch-based
              exits. Create your own testnet position in the staking panel
              below. Changing an active contribution and independent contract
              review remain in development. No fixed APY or completed yield
              cycle is claimed.
            </p>
          </details>
          {state.worker.last_error && (
            <p role="status" className="native-secondary">
              The worker is retrying a network operation. Accepted receipts
              remain saved.
            </p>
          )}
        </>
      )}
    </section>
  );
}
