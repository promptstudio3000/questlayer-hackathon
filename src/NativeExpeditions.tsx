import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  MapPin,
  NavigationArrow,
  Wallet,
  Coins,
  ArrowClockwise,
  LockKey,
  Footprints,
  Sparkle,
} from "@phosphor-icons/react";
import { api, meters } from "./api";
import type { Fix, Player, Point, QuestActivity } from "./types";
import "./play-ui.css";
type Quest = {
  activity?: QuestActivity;
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
  view = "board",
  initialIndex,
  initialCoinIndex,
  onWallet,
}: {
  player: Player;
  fix: Fix | null;
  arena: boolean;
  position: Point;
  onConnect: () => void;
  onLocate: () => void;
  onFocus: (
    p: Point & { label: string; questIndex?: number; coinIndex?: number },
  ) => void;
  view?: "board" | "wallet";
  initialIndex?: number;
  initialCoinIndex?: number;
  onWallet?: () => void;
  onWithdraw: (account: string, contract: string) => Promise<boolean>;
}) {
  const [account, setAccount] = useState(player.wallets[0]?.account_id || ""),
    [snapshot, setSnapshot] = useState<{ account: string; data: State } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [chosen, setChosen] = useState<number | null>(initialIndex ?? null),
    [chosenCoin, setChosenCoin] = useState<number | null>(
      initialCoinIndex ?? null,
    );
  const state = snapshot?.account === account ? snapshot.data : null;
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
        setSnapshot({ account: p.account, data: s });
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setConsent(false);
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
  const quests = state?.day?.quests || [];
  const ordered = [...quests].sort((a, b) => {
    const unavailable = (q: Quest) =>
      Number(
        q.checkpoint >= q.targets.length ||
          q.tier > (state?.access.tier || 1) ||
          Date.now() < q.opensAt ||
          Date.now() >= q.closesAt,
      );
    return (
      unavailable(a) - unavailable(b) ||
      meters(position, a.targets[0]) - meters(position, b.targets[0]) ||
      a.index - b.index
    );
  });
  const selected = quests.find((q) => q.index === chosen) || ordered[0];
  useEffect(() => {
    if (selected && chosen !== selected.index) setChosen(selected.index);
  }, [selected?.index, chosen]);
  const readyReason = !account
    ? "Connect a wallet to record visits"
    : !state?.enrolled
      ? "Join the testnet walks below"
      : !gpsReady
        ? arena
          ? "Turn on GPS to record visits"
          : "Waiting for accurate, fresh GPS"
        : state.day && state.day.claimsAccepted >= state.day.claimsLimit
          ? "Today's pilot is full"
          : "";
  function renderQuest(q: Quest) {
    const done = q.checkpoint >= q.targets.length;
    const target = q.targets[Math.min(q.checkpoint, q.targets.length - 1)];
    const distance = Math.round(meters(position, target));
    const closed = Date.now() >= q.closesAt;
    const future = Date.now() < q.opensAt;
    const locked = q.tier > (state?.access.tier || 1);
    const reason = done
      ? "Walk recorded"
      : locked
        ? `Requires Tier ${q.tier}`
        : future
          ? "Opens later today"
          : closed
            ? "Zone closed"
            : readyReason ||
              (distance > 35 ? "Get within 35 m of the marker" : "");
    return (
      <article className="walk-card" key={q.index}>
        <div className="walk-art" aria-hidden="true">
          <Footprints size={36} weight="duotone" />
          <span>
            {done ? (
              <CheckCircle size={28} />
            ) : (
              `${Math.min(q.checkpoint + 1, q.targets.length)}/${q.targets.length}`
            )}
          </span>
        </div>
        <div className="walk-place">
          <MapPin size={16} />
          {q.name}
          <span>{q.tier === 1 ? "Free" : `Tier ${q.tier}`}</span>
        </div>
        <h2>{q.title}</h2>
        <p className="play-hint">{q.targets.length} stops · solo walk</p>
        <div className="play-facts">
          <span>
            <Sparkle size={18} />
            {q.xp} XP
          </span>
          <span>
            <NavigationArrow size={18} />
            {distance} m
          </span>
          {q.reward !== "0" && (
            <span>
              <Coins size={18} />
              {q.prizeClaimed
                ? "Prize claimed"
                : q.prizePending
                  ? "Prize pending"
                  : `${nativeGold(q.reward)} GOLD`}
            </span>
          )}
        </div>
        <button
          className={
            eligible && !done && !locked && !future && !closed && distance <= 35
              ? "secondary-button"
              : "primary-button"
          }
          onClick={() =>
            onFocus({
              ...target,
              label: `${q.title} · stop ${Math.min(q.checkpoint + 1, q.targets.length)}`,
              questIndex: q.index,
            })
          }
        >
          <MapPin size={20} />
          {done ? "View final stop" : "Show next stop"}
          <ArrowRight size={20} />
        </button>
        <button
          className={
            eligible && !done && !locked && !future && !closed && distance <= 35
              ? "primary-button"
              : "secondary-button"
          }
          disabled={
            !eligible || done || locked || future || closed || distance > 35
          }
          onClick={() => void visit("quest", q.index, q.checkpoint)}
        >
          {busy
            ? "Checking visit…"
            : done
              ? "Walk recorded"
              : "Record this stop"}
          <CheckCircle size={20} />
        </button>
        <ol className="walk-steps" aria-label="Checkpoint progress">
          {q.targets.map((_, i) => (
            <li
              key={i}
              className={
                i < q.checkpoint ? "done" : i === q.checkpoint ? "current" : ""
              }
              aria-current={i === q.checkpoint ? "step" : undefined}
            >
              <span>
                {i < q.checkpoint ? <CheckCircle size={18} /> : i + 1}
              </span>
              <small>{q.activity?.steps[i]?.label || `Stop ${i + 1}`}</small>
            </li>
          ))}
        </ol>
        {reason && (
          <p className="play-hint">
            {locked ? <LockKey size={18} /> : <NavigationArrow size={18} />}
            {reason}
          </p>
        )}
        {!account && (
          <button className="text-button" onClick={onConnect}>
            <Wallet size={20} />
            Connect to record visits
          </button>
        )}
        {account && state?.enrolled && !gpsReady && (
          <button className="text-button" onClick={onLocate}>
            <NavigationArrow size={20} />
            Turn on GPS
          </button>
        )}
        {(done || closed) &&
          ordered.some(
            (other) =>
              other.index !== q.index &&
              other.checkpoint < other.targets.length &&
              other.closesAt > Date.now(),
          ) && (
            <button
              className="primary-button"
              onClick={() =>
                setChosen(
                  ordered.find(
                    (other) =>
                      other.index !== q.index &&
                      other.checkpoint < other.targets.length &&
                      other.closesAt > Date.now(),
                  )!.index,
                )
              }
            >
              Find another walk
              <ArrowRight size={20} />
            </button>
          )}
        <details className="play-details">
          <summary>
            <Clock size={18} />
            Details & rewards
          </summary>
          <p>
            {new Date(q.opensAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Prague",
            })}
            –
            {new Date(q.closesAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/Prague",
            })}{" "}
            · Plzeň time. Distances are straight-line.
          </p>
          <p>{q.prompt}</p>
          <p>
            Visit the marked stops in order. Observations are optional; only
            browser GPS checkpoints are attested. Use safe public paths; these
            locations still need field review.
          </p>
          {q.reward !== "0" && (
            <p>
              The first valid finish receives the shared prize. Personal XP
              remains available. GOLD here represents test NEAR and has no
              monetary value.
            </p>
          )}
        </details>
      </article>
    );
  }
  return (
    <section
      className="play-native"
      aria-label={view === "board" ? "Testnet walks" : "Testnet rewards"}
    >
      <div className="play-toolbar">
        <span className="play-chip">
          <span className="status-dot" />
          NEAR testnet
        </span>
        <button
          className="play-icon"
          aria-label="Refresh testnet status"
          disabled={busy}
          onClick={() => void refresh(true)}
        >
          <ArrowClockwise size={22} />
        </button>
      </div>
      <p className="play-hint">Sponsored test tokens · no monetary value</p>
      {error && (
        <p className="play-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="play-notice" role="status">
          {notice}
        </p>
      )}
      {!state && <p role="status">Loading adventures…</p>}
      {state?.status === "not-configured" && (
        <p>The testnet walks are not available yet.</p>
      )}
      {state?.contractId && (
        <>
          {view === "board" && (
            <>
              {chosenCoin !== null ? (
                (() => {
                  const coin = state.day?.coins.find(
                    (c) => c.index === chosenCoin,
                  );
                  return (
                    <article className="walk-card">
                      <div className="walk-place">
                        <Coins size={24} />
                        Street coin
                      </div>
                      <h2>
                        {coin
                          ? `${coin.distance} m away`
                          : "Coin no longer nearby"}
                      </h2>
                      <p>
                        {coin
                          ? `${nativeGold(state.day?.coinUnit || "0")} GOLD · shared street reward`
                          : "This coin may have been collected. Choose another discovery."}
                      </p>
                      <button
                        className="primary-button"
                        disabled={!coin || !eligible || coin.distance > 35}
                        onClick={() => void visit("coin", chosenCoin)}
                      >
                        <Coins size={22} />
                        Collect coin
                      </button>
                      {readyReason && (
                        <p className="play-hint">{readyReason}</p>
                      )}
                      {coin && coin.distance > 35 && (
                        <p className="play-hint">
                          Get within 35 m of the marker.
                        </p>
                      )}
                      <button
                        className="secondary-button"
                        onClick={() => setChosenCoin(null)}
                      >
                        Browse walks
                        <ArrowRight size={20} />
                      </button>
                    </article>
                  );
                })()
              ) : selected ? (
                renderQuest(selected)
              ) : (
                <p>Today's walks are waiting for confirmed funding.</p>
              )}
              {view === "board" && account && !state.enrolled && (
                <div className="play-consent">
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>
                      I understand that public receipts may link my wallet to
                      these places. Browser GPS is not independently verified.
                    </span>
                  </label>
                  <button
                    className="primary-button"
                    disabled={!consent || busy}
                    onClick={() =>
                      void act(async () => {
                        await api("/native/rewards/join", {
                          accountId: account,
                          consent: true,
                        });
                        setNotice(
                          "You're ready. Turn on GPS and visit a marked stop.",
                        );
                      })
                    }
                  >
                    Join testnet walks
                    <ArrowRight size={20} />
                  </button>
                </div>
              )}
              <details className="play-details">
                <summary>
                  <Footprints size={20} />
                  Other walks <span>{Math.max(0, quests.length - 1)}</span>
                </summary>
                <div className="walk-picker">
                  {ordered
                    .filter((q) => q.index !== selected?.index)
                    .map((q) => (
                      <button
                        key={q.index}
                        onClick={() => {
                          setChosen(q.index);
                          setChosenCoin(null);
                        }}
                      >
                        <span className="play-object">
                          {q.checkpoint >= q.targets.length ? (
                            <CheckCircle size={24} />
                          ) : q.tier > state.access.tier ? (
                            <LockKey size={24} />
                          ) : (
                            <Footprints size={24} />
                          )}
                        </span>
                        <span>
                          <b>{q.title}</b>
                          <small>
                            {q.name} ·{" "}
                            {Math.round(
                              meters(
                                position,
                                q.targets[
                                  Math.min(q.checkpoint, q.targets.length - 1)
                                ],
                              ),
                            )}{" "}
                            m
                          </small>
                        </span>
                        <ArrowRight size={20} />
                      </button>
                    ))}
                </div>
              </details>
              <details className="play-details">
                <summary>
                  <Coins size={20} />
                  Street coins{" "}
                  <span>{state.day?.coins.length || 0} nearby</span>
                </summary>
                <p>
                  {state.day ? nativeGold(state.day.coinUnit) : "0"} GOLD per
                  coin · shared · up to 100 a day.
                </p>
                {state.day?.coins.length ? (
                  state.day.coins.slice(0, 5).map((c) => (
                    <div className="street-pickup" key={c.index}>
                      <Coins size={22} />
                      <span>{c.distance} m</span>
                      <button
                        className="play-icon"
                        aria-label={`Show native coin ${c.index} on map`}
                        onClick={() =>
                          onFocus({
                            ...c,
                            coinIndex: c.index,
                            label: "Native street coin",
                          })
                        }
                      >
                        <MapPin size={22} />
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!eligible || c.distance > 35}
                        onClick={() => void visit("coin", c.index)}
                      >
                        Collect
                      </button>
                    </div>
                  ))
                ) : (
                  <p>No coins within 1 km of the map position.</p>
                )}
                {readyReason && <p className="play-hint">{readyReason}</p>}
              </details>
            </>
          )}
          {view === "wallet" && (
            <div className="reward-wallet">
              <span className="play-object">
                <Wallet size={30} weight="duotone" />
              </span>
              <small>Confirmed rewards</small>
              <strong>
                {state.balance ? nativeGold(state.balance.credit) : "—"} GOLD
              </strong>
              <span>
                {state.balance ? nearAmount(state.balance.credit) : "—"} test
                NEAR · {state.balance?.xp ?? "—"} native XP
              </span>
              {state.balance && (
                <>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      state.balance.credit === "0" ||
                      state.balance.pending !== "0"
                    }
                    onClick={() =>
                      void act(async () => {
                        if (await onWithdraw(account, state.contractId))
                          setNotice(
                            "Withdrawal submitted. Waiting for confirmation.",
                          );
                      })
                    }
                  >
                    Withdraw to wallet
                    <ArrowRight size={20} />
                  </button>
                  <p className="play-hint">
                    Network fees can exceed a small reward. Combine rewards
                    before withdrawing.
                  </p>
                  {state.balance.pending !== "0" && (
                    <p role="status">
                      <Clock size={18} /> Withdrawal pending
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {!account && (view === "wallet" || chosenCoin !== null) ? (
            <button className="secondary-button" onClick={onConnect}>
              <Wallet size={22} />
              Connect NEAR wallet
            </button>
          ) : player.wallets.length > 1 ? (
            <label className="play-field">
              Receiving wallet
              <select
                value={account}
                disabled={busy}
                onChange={(e) => setAccount(e.target.value)}
              >
                {player.wallets.map((w) => (
                  <option key={w.account_id}>{w.account_id}</option>
                ))}
              </select>
            </label>
          ) : account ? (
            <p className="play-account">
              <Wallet size={18} />
              {account}
            </p>
          ) : null}
          {view === "board" && !gpsReady && (
            <button className="secondary-button" onClick={onLocate}>
              <NavigationArrow size={22} />
              Use my GPS location
            </button>
          )}
          {view === "board" && onWallet && (
            <button className="text-button" onClick={onWallet}>
              <Wallet size={20} />
              My rewards
              <ArrowRight size={18} />
            </button>
          )}
          <details className="play-details">
            <summary>
              <CheckCircle size={20} />
              Receipts & pilot status
            </summary>
            <p>
              Tier {state.access.tier} · {nativeGold(state.access.weighted)}{" "}
              eligible GOLD. Demo deposits do not unlock testnet tiers.
            </p>
            {state.day && (
              <p>
                {state.day.claimsAccepted}/{state.day.claimsLimit} daily
                receipts used. If the storage allowance fills, demo play remains
                available.
              </p>
            )}
            {state.receipts.length ? (
              state.receipts.slice(0, 12).map((r) => (
                <div className="receipt-row" key={r.id}>
                  {r.state === "confirmed" ? (
                    <CheckCircle size={20} />
                  ) : (
                    <Clock size={20} />
                  )}
                  <span>
                    {r.kind === "coin" ? "Street coin" : "Walk"} ·{" "}
                    {r.state === "confirmed"
                      ? `${nativeGold(r.amount || "0")} GOLD + ${r.xp} XP`
                      : r.state === "retrying"
                        ? "Retrying confirmation; your visit is saved"
                        : "Waiting for confirmation"}
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
              ))
            ) : (
              <p>No recorded visits yet.</p>
            )}
            {state.worker.last_error && (
              <p>The worker is retrying. Accepted visits remain saved.</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
