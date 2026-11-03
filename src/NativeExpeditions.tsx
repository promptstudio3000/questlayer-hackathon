import { EmptyState } from "./EmptyState";
import { useEffect, useRef, useState } from "react";
import {
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
  TreasureChest,
  ArrowUUpLeft,
  Path,
  Star,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { api, meters } from "./api";
import type { Fix, Player, Point, QuestActivity } from "./types";
import { nativeVisitReadReason } from "./native-objective";
import type { useNativeObjective } from "./useNativeObjective";
import "./play-ui.css";
import type {
  NativeQuest as Quest,
  NativeGameState as State,
} from "./native-game-types";
import { EXPLORER_BASE } from "./near-network.ts";
import { tr } from "./i18n";
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
  objective,
  control,
  onWallet,
  onBusyChange,
}: {
  player: Player;
  fix: Fix | null;
  arena: boolean;
  position: Point;
  onConnect: () => void;
  onLocate: () => void;
  onFocus: (kind: "quest" | "coin", index: number) => void;
  view?: "board" | "wallet";
  objective: ReturnType<typeof useNativeObjective>;
  control?: {
    account: string;
    state: State | null;
    error: string;
    refresh: (fresh?: boolean) => Promise<void>;
    onAccount: (account: string) => void;
  };
  onWallet?: (showReceipts?: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onWithdraw: (account: string, contract: string) => Promise<boolean>;
}) {
  const [accountValue, setAccount] = useState(
      player.wallets[0]?.account_id || "",
    ),
    [snapshot, setSnapshot] = useState<{ account: string; data: State } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false);
  const chosen =
    objective.reference?.kind === "quest" ? objective.reference.index : null;
  const chosenCoin =
    objective.reference?.kind === "coin" ? objective.reference.index : null;
  const account = control?.account ?? accountValue;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      onBusyChange?.(false);
    },
    [onBusyChange],
  );
  const state = control
    ? control.state
    : snapshot?.account === account
      ? snapshot.data
      : null;
  const latest = useRef({ position, account });
  latest.current = { position, account };
  const mounted = useRef(true);
  const section = useRef<HTMLElement>(null);
  function browseWalks() {
    objective.clear();
    requestAnimationFrame(() =>
      section.current
        ?.querySelector<HTMLElement>(".walk-card h2")
        ?.focus({ preventScroll: true }),
    );
  }
  async function refresh(fresh = false) {
    if (control) {
      await control.refresh(fresh);
      return;
    }
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
    if (control)
      return () => {
        mounted.current = false;
      };
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [account, !!control]);
  useEffect(() => {
    if (!player.wallets.some((w) => w.account_id === account))
      setAccount(player.wallets[0]?.account_id || "");
  }, [player.wallets.map((w) => w.account_id).join("|")]);
  useEffect(() => {
    if (control && control.account !== account) setAccount(control.account);
  }, [control?.account]);
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
      if (!state?.day)
        throw Error("Today's walks are not ready yet. Try again in a moment.");
      objective.select(kind, index);
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
          ? tr("Stop {0} of {1} confirmed. Walk to the next stop.", { 0: result.checkpoint, 1: result.total })
          : tr("Visit confirmed. Your reward is being secured."),
      );
    });
  }
  const gpsReady =
    !arena &&
    !!fix &&
    fix.accuracy <= 35 &&
    Date.now() - fix.timestamp <= 15000;
  const readReason = nativeVisitReadReason(state, account, Date.now());
  const eligible =
    !!account &&
    state?.enrolled &&
    !readReason &&
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
  const selected =
    chosen === null ? ordered[0] : quests.find((q) => q.index === chosen);
  const recovering =
    !!objective.reference && objective.view.status !== "active";
  const alternatives = ordered.filter(
    (q) =>
      chosenCoin !== null ||
      (objective.reference &&
        (objective.reference.dayId !== state?.day?.id ||
          objective.reference.manifestHash !== state?.day?.hash)) ||
      q.index !== selected?.index,
  );
  const readyReason = !account
    ? "Link a NEAR account to confirm visits"
    : readReason
      ? readReason
      : !state?.enrolled
        ? "Join the walks below"
        : !gpsReady
          ? arena
            ? "Turn on GPS to confirm visits"
            : "Waiting for a fresh, accurate GPS fix"
          : state.day && state.day.claimsAccepted >= state.day.claimsLimit
            ? "Today's walks are full. Come back tomorrow"
            : "";
  // v2 days publish a template per walk; v1 walks are three ordered stops.
  function questArt(q: Quest, size: number) {
    const icon = q.activity?.icon;
    if (icon === "chest") return <TreasureChest size={size} weight="duotone" />;
    if (icon === "return") return <ArrowUUpLeft size={size} weight="duotone" />;
    if (icon === "visit") return <MapPin size={size} weight="duotone" />;
    if (q.template === "ordered-trail")
      return <Path size={size} weight="duotone" />;
    return <Footprints size={size} weight="duotone" />;
  }
  function questHint(q: Quest) {
    const n = q.targets.length;
    if (q.activity?.icon === "chest")
      return tr("1 chest · first opener takes any prize");
    if (q.activity?.icon === "visit") return tr("1 stop · quick visit");
    if (q.activity?.icon === "return")
      return tr("{0} stops · return to your start", { 0: n });
    return tr("{0} stops · solo walk", { 0: n });
  }
  function renderQuest(q: Quest) {
    const done = q.checkpoint >= q.targets.length;
    const target = q.targets[Math.min(q.checkpoint, q.targets.length - 1)];
    const distance = Math.round(meters(position, target));
    const closed = Date.now() >= q.closesAt;
    const future = Date.now() < q.opensAt;
    const locked = q.tier > (state?.access.tier || 1);
    const reason = done
      ? "Walk complete"
      : locked
        ? `Opens at Tier ${q.tier}`
        : future
          ? "Opens later today"
          : closed
            ? "Closed for today"
            : readyReason ||
              (distance > 35 ? "Get within 35 m of the stop" : "");
    return (
      <article className="walk-card" key={q.index}>
        <div className="walk-art" aria-hidden="true">
          {questArt(q, 36)}
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
          <span>{q.tier === 1 ? tr("Free") : tr("Tier {0}", { 0: q.tier })}</span>
        </div>
        <h2 tabIndex={-1}>{q.title}</h2>
        {q.activity?.objective && <p>{q.activity.objective}</p>}
        <p className="play-hint">{questHint(q)}</p>
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
                ? tr("Prize claimed")
                : q.prizePending
                  ? tr("Prize pending")
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
          disabled={done ? !onWallet : !objective.canSelect("quest", q.index)}
          onClick={() => (done ? onWallet?.(true) : onFocus("quest", q.index))}
        >
          <MapPin size={20} />
          {done ? tr("See my rewards") : tr("Show next stop")}
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
            ? tr("Checking visit…")
            : done
              ? tr("Walk complete")
              : q.activity?.actionLabel || tr("Confirm visit")}
          <CheckCircle size={20} />
        </button>
        <ol className="walk-steps" aria-label={tr("Stops")}>
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
              <small>{q.activity?.steps[i]?.label || tr("Stop {0}", { 0: i + 1 })}</small>
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
            {tr("Link account to confirm visits")}</button>
        )}
        {account && state?.enrolled && !gpsReady && (
          <button className="text-button" onClick={onLocate}>
            <NavigationArrow size={20} />
            {tr("Turn on GPS")}</button>
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
              disabled={!objective.canSelect("quest", q.index)}
              onClick={() =>
                objective.select(
                  "quest",
                  ordered.find(
                    (other) =>
                      other.index !== q.index &&
                      other.checkpoint < other.targets.length &&
                      other.closesAt > Date.now(),
                  )!.index,
                )
              }
            >
              {tr("Find another walk")}<ArrowRight size={20} />
            </button>
          )}
        <details className="play-details">
          <summary>
            <Clock size={18} />
            {tr("Details & rewards")}</summary>
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
            {tr("· Plzeň time. Distances are straight-line.")}</p>
          <p>{q.prompt}</p>
          <p>
            {tr("Visit the stops in order. Only your GPS position at each stop is checked. Use safe public paths; distances are straight lines, not routes.")}</p>
          {q.reward !== "0" && (
            <p>
              {tr("The GOLD prize goes to the first explorer to finish; your XP is always yours. GOLD here is test NEAR with no monetary value.")}</p>
          )}
        </details>
      </article>
    );
  }
  return (
    <section
      ref={section}
      className="play-native"
      aria-label={view === "board" ? tr("Nearby walks") : tr("Secured rewards")}
    >
      <div className="play-toolbar">
        <span className="play-chip">
          <span className="status-dot" />
          {tr("Test network")}</span>
        <button
          className="play-icon"
          aria-label={tr("Refresh walks")}
          disabled={busy}
          onClick={() => void refresh(true)}
        >
          <ArrowClockwise size={22} />
        </button>
      </div>
      {(error || control?.error) && (
        <p className="play-error" role="alert">
          {error || control?.error}
        </p>
      )}
      {notice && (
        <p className="play-notice" role="status">
          {notice}
        </p>
      )}
      {!state && (view === "wallet" || !objective.reference) && (
        <p role="status">{tr("Loading adventures…")}</p>
      )}
      {view === "board" && recovering && (
        <article className="walk-card native-objective-recovery">
          <h2>{objective.view.label}</h2>
          <p role="status">{objective.view.message}</p>
          {objective.view.receipt?.state === "confirmed" && (
            <p>
              {objective.view.receipt.amount === null ||
              objective.view.receipt.xp === null
                ? tr("Confirmed · reward details unavailable")
                : tr("{0} GOLD · {1} confirmed XP", { 0: nativeGold(objective.view.receipt.amount), 1: objective.view.receipt.xp })}
            </p>
          )}
          {objective.view.status !== "confirmed" && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void refresh(true)}
            >
              <ArrowClockwise size={20} /> {" "}{tr("Refresh adventure")}</button>
          )}
          {onWallet && (
            <button className="secondary-button" onClick={() => onWallet(true)}>
              {tr("See my rewards")}{" "}<ArrowRight size={20} />
            </button>
          )}
          <button className="text-button" onClick={browseWalks}>
            {tr("Browse current walks")}{" "}<ArrowRight size={20} />
          </button>
        </article>
      )}
      {state?.status === "not-configured" && (
        <p>{tr("Walks are not available here yet.")}</p>
      )}
      {state?.contractId && (
        <>
          {view === "board" && (
            <>
              {recovering ? null : chosenCoin !== null ? (
                (() => {
                  const coin = state.day?.coins.find(
                    (c) => c.index === chosenCoin,
                  );
                  return (
                    <article className="walk-card">
                      <div className="walk-place">
                        <Coins size={24} />
                        {tr("Street coin")}</div>
                      <h2>{coin ? tr("{0} m away", { 0: coin.distance }) : tr("Coin gone")}</h2>
                      <p>
                        {coin
                          ? tr("{0} GOLD · first explorer takes it", { 0: nativeGold(state.day?.coinUnit || "0") })
                          : tr("Someone may have collected it. Pick another nearby.")}
                      </p>
                      <button
                        className="primary-button"
                        disabled={!coin || !eligible || coin.distance > 35}
                        onClick={() => void visit("coin", chosenCoin)}
                      >
                        <Coins size={22} />
                        {tr("Collect coin")}</button>
                      {readyReason && (
                        <p className="play-hint">{readyReason}</p>
                      )}
                      {coin && coin.distance > 35 && (
                        <p className="play-hint">
                          {tr("Get within 35 m of the coin.")}</p>
                      )}
                      <button
                        className="secondary-button"
                        onClick={browseWalks}
                      >
                        {tr("Browse walks")}<ArrowRight size={20} />
                      </button>
                    </article>
                  );
                })()
              ) : selected ? (
                renderQuest(selected)
              ) : (
                <p>{tr("Today's walks are waiting for confirmed funding.")}</p>
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
                      {tr("I understand my confirmed visits are public and link my account to these places. Browser GPS is not verified.")}</span>
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
                          tr("You're in. Turn on GPS and walk to the first stop."),
                        );
                      })
                    }
                  >
                    {tr("Join the walks")}<ArrowRight size={20} />
                  </button>
                </div>
              )}
              <details className="play-details">
                <summary>
                  <Footprints size={20} />
                  {tr("Other walks")}{" "}<span>{alternatives.length}</span>
                </summary>
                <div className="walk-picker">
                  {alternatives.map((q) => (
                    <button
                      key={q.index}
                      disabled={!objective.canSelect("quest", q.index)}
                      onClick={() => {
                        objective.select("quest", q.index);
                      }}
                    >
                      <span className="play-object">
                        {q.checkpoint >= q.targets.length ? (
                          <CheckCircle size={24} />
                        ) : q.tier > state.access.tier ? (
                          <LockKey size={24} />
                        ) : (
                          questArt(q, 24)
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
                  {tr("Street coins")}{" "}
                  <span>{state.day?.coins.length || 0} nearby</span>
                </summary>
                <p>
                  {state.day ? nativeGold(state.day.coinUnit) : "0"} {" "}{tr("GOLD per coin · first explorer takes it · up to 100 a day.")}{state.day?.findCount
                    ? state.day.findXp
                      ? tr(" Starred street finds pay the same GOLD and {0} XP instead of 2.", { 0: state.day.findXp })
                      : tr(" Starred street finds mark spots worth a detour; they pay the same as any coin.")
                    : ""}
                </p>
                {state.day?.coins.length ? (
                  state.day.coins.slice(0, 5).map((c) => (
                    <div className="street-pickup" key={c.index}>
                      {c.find ? (
                        <Star
                          size={22}
                          weight="fill"
                          aria-label={tr("Street find")}
                        />
                      ) : (
                        <Coins size={22} />
                      )}
                      <span>
                        {c.distance} m{c.find ? tr(" · street find") : ""}
                      </span>
                      <button
                        className="play-icon"
                        aria-label={tr("Show coin {0} on map", { 0: c.index })}
                        disabled={!objective.canSelect("coin", c.index)}
                        onClick={() => onFocus("coin", c.index)}
                      >
                        <MapPin size={22} />
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!eligible || c.distance > 35}
                        onClick={() => void visit("coin", c.index)}
                      >
                        {tr("Collect")}</button>
                    </div>
                  ))
                ) : (
                  <p>{tr("No coins within 1 km of you.")}</p>
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
              <small>{tr("Secured rewards")}</small>
              <strong>
                {state.balance ? nativeGold(state.balance.credit) : "—"} GOLD
              </strong>
              <span>
                {state.balance ? nearAmount(state.balance.credit) : "—"} {" "}{tr("test NEAR ·")}{" "}{state.balance?.xp ?? "—"} XP
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
                            tr("Withdrawal sent. Waiting for confirmation."),
                          );
                      })
                    }
                  >
                    {tr("Withdraw to my account")}<ArrowRight size={20} />
                  </button>
                  <p className="play-hint">
                    {tr("A network fee applies, so let small rewards add up before withdrawing.")}</p>
                  {state.balance.pending !== "0" && (
                    <p role="status">
                      <Clock size={18} /> {" "}{tr("Withdrawal pending")}</p>
                  )}
                </>
              )}
            </div>
          )}
          {!account && (view === "wallet" || chosenCoin !== null) ? (
            <button className="secondary-button" onClick={onConnect}>
              <Wallet size={22} />
              {tr("Link NEAR account")}</button>
          ) : player.wallets.length > 1 ? (
            <label className="play-field">
              {tr("Receiving account")}<select
                value={account}
                disabled={busy}
                onChange={(e) => {
                  setAccount(e.target.value);
                  control?.onAccount(e.target.value);
                }}
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
              {tr("Use my GPS location")}</button>
          )}
          {view === "board" && onWallet && (
            <button className="text-button" onClick={() => onWallet()}>
              <Wallet size={20} />
              {tr("My rewards")}<ArrowRight size={18} />
            </button>
          )}
          <details className="play-details" data-native-receipts>
            <summary>
              <CheckCircle size={20} />
              {tr("Receipts & status")}</summary>
            <p>
              {tr("Tier")}{" "}{state.access.tier} · {nativeGold(state.access.weighted)}{" "}
              {tr("eligible GOLD. Practice stake does not unlock these tiers.")}</p>
            {state.day && (
              <p>
                {state.day.claimsAccepted}/{state.day.claimsLimit} {" "}{tr("visits confirmed today. When the limit is reached, practice play still works.")}</p>
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
                    {r.kind === "coin" ? tr("Street coin") : tr("Walk")} ·{" "}
                    {r.state === "confirmed"
                      ? `${nativeGold(r.amount || "0")} GOLD + ${r.xp} XP`
                      : r.state === "retrying"
                        ? tr("Confirming again; your visit is saved")
                        : tr("Waiting for confirmation")}
                  </span>
                  {r.transaction && (
                    <a
                      href={`${EXPLORER_BASE}/txns/${r.transaction}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tr("Receipt")}</a>
                  )}
                </div>
              ))
            ) : (
              <EmptyState art="discovery" title={tr("No confirmed visits yet")}>
                {tr("Walk to an open place to record your first visit.")}</EmptyState>
            )}
            {state.worker.last_error && (
              <p>{tr("Confirmation is retrying. Your visits stay saved.")}</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
