import { useEffect, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Flame,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "./api";
import {
  CONTRIBUTION_CHOICES,
  contributionBps,
  fuelStatus,
  isVaultV2,
  previewFuel,
  quoteContribution,
  quotePartialExit,
  summarizeFuel,
  weightedGold,
  type FuelPosition,
  type FuelSummary,
} from "./city-fuel";
import { NativeStaking, type VaultSnapshot } from "./NativeStaking";
import { StakeToday } from "./StakeToday";
import { StakeStory, TierLadder, type StakerStep } from "./StakeEarn";
import { STAKER_SUGGEST_NEAR, takeStakePrefill } from "./LockedChip";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
import type { Player } from "./types";
import "./fuel-the-city.css";
import { tr } from "./i18n";

type StakerGates = { minNear: string; suggestNear: string; priceEur: number | null; access: { step: string; staker: boolean } };

/** "~5 €" for a NEAR amount, only when the server has a reference price. */
export function eurHint(near: number, priceEur: number | null | undefined): string | null {
  if (!priceEur || !(near > 0)) return null;
  const v = near * priceEur;
  return `~${v < 10 ? String(Math.round(v * 2) / 2) : Math.round(v)} €`;
}

type CityStaking = {
  staking?: {
    data: {
      totals: { weightedStake: string } | null;
      stakers: number | null;
    } | null;
  };
};

const fmt = (n: number, max = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
const fmtNear = (yocto: string) => fmt(Number(BigInt(yocto) / 10n ** 21n) / 1000, 3);
const tierName = (t: number) => (t === 1 ? tr("Free") : tr("Tier {0}", { 0: t }));

type Outcome =
  | { kind: "idle"; where?: undefined }
  | { kind: "pending" | "done" | "failed"; text: string; where?: "adjust" };

/** Profile → Fuel the prize pool. Staking as a choice with a pool meter, not an APY table. The pool is global (docs/GLOBAL-TREASURY.md). */
export function FuelTheCity({
  player,
  account,
  managed,
  cityName,
  onConnect,
  onTransaction,
}: {
  player: Player;
  /** The account that signs: the invisible account when ready, else the first linked one. */
  account: string;
  /** True when the account is the invisible one, so nothing pops up. */
  managed: boolean;
  cityName?: string;
  onConnect: () => void;
  onTransaction: (r: VaultRequest) => Promise<boolean>;
}) {
  const [vaults, setVaults] = useState<VaultSnapshot | null>(null),
    [city, setCity] = useState<CityStaking | null>(null),
    [readError, setReadError] = useState(""),
    [amount, setAmount] = useState(() => takeStakePrefill() || STAKER_SUGGEST_NEAR),
    [gates, setGates] = useState<StakerGates | null>(null),
    [contribution, setContribution] = useState(50),
    [understood, setUnderstood] = useState(false),
    [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  async function refresh() {
    try {
      const [v, c] = await Promise.all([
        api<VaultSnapshot>(
          "/native/vaults" + (account ? "?account=" + encodeURIComponent(account) : ""),
        ),
        api<CityStaking>("/native/economy").catch(() => null),
      ]);
      setVaults(v);
      setCity(c);
      setReadError("");
    } catch (e) {
      setReadError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [account]);
  useEffect(() => {
    let live = true;
    api<StakerGates>("/staker/gates").then(
      (g) => live && setGates(g),
      () => undefined,
    );
    // A locked chip tapped while this sheet is open prefills it too.
    const onOpen = () => {
      const near = takeStakePrefill();
      if (near) setAmount(near);
    };
    window.addEventListener("questlayer:open-stake", onOpen);
    return () => {
      live = false;
      window.removeEventListener("questlayer:open-stake", onOpen);
    };
  }, []);

  const positions = (vaults?.positions || []) as FuelPosition[];
  const summary = summarizeFuel(positions, {
    weightedStake: city?.staking?.data?.totals?.weightedStake,
    stakers: city?.staking?.data?.stakers,
  });
  const active = positions.find(
    (p) => p.position && p.position.stage === "idle" && !p.position.exit_requested,
  );
  const setupPending = positions.find((p) => !p.position);
  const fixedContribution = active ? contributionBps(active) / 100 : null;
  const adjustable = active && isVaultV2(active) ? active : null;
  const withdrawable = positions.find(
    (p) =>
      p.position &&
      String(p.position.owner_credit) !== "0" &&
      String(p.position.owner_pending) === "0",
  );
  const pct = fixedContribution ?? contribution;
  let amountError = "";
  let amountNear = 0;
  try {
    amountNear = Number(BigInt(parseTestNear(amount)) / 10n ** 21n) / 1000;
  } catch (e) {
    amountError = (e as Error).message;
  }
  const preview = previewFuel(summary, amountError ? 0 : amountNear, pct);

  async function send(
    request: Omit<VaultRequest, "accountId">,
    pending: string,
    done: string,
    where?: "adjust",
  ): Promise<boolean> {
    setOutcome({ kind: "pending", text: pending, where });
    try {
      const ok = await onTransaction({ ...request, accountId: account });
      setOutcome(
        ok
          ? { kind: "done", text: done, where }
          : {
              kind: "failed",
              text: tr("It didn't go through. Nothing was taken; try again."),
              where,
            },
      );
      await refresh();
      return ok;
    } catch (e) {
      setOutcome({ kind: "failed", text: (e as Error).message, where });
      return false;
    }
  }

  // Where the explorer stands on Free → Staker → Tier 2 → Tier 3.
  const stakerMin = Number(gates?.minNear || STAKER_SUGGEST_NEAR) || 2;
  const ladderStep: StakerStep =
    summary.tier >= 3
      ? "tier3"
      : summary.tier === 2
        ? "tier2"
        : gates?.access.staker
          ? "staker"
          : "none";
  const ladderProgress =
    ladderStep === "none"
      ? summary.myStakeNear / stakerMin
      : summary.next
        ? (summary.myWeightedGold - (ladderStep === "tier2" ? 50_000 : 0)) /
          (summary.next.gold - (ladderStep === "tier2" ? 50_000 : 0))
        : 1;
  const ladderNext =
    ladderStep === "none"
      ? summary.myStakeNear > 0
        ? tr("Your stake counts after about two epochs (1–2 days). Then you are a Staker.")
        : tr("Stake {0} NEAR to become a Staker.", { 0: stakerMin })
      : summary.next
        ? tr("{0} GOLD more fuel opens Tier {1} places.", { 0: fmt(summary.next.missingGold), 1: summary.next.tier })
        : tr("Every place on the map is open to you.");
  const busy = outcome.kind === "pending";

  return (
    <section className="fuel" aria-labelledby="fuel-title">
      {active ? (
        <details className="stake-story-more">
          <summary>{tr("How staking works")}</summary>
          <StakeStory sharePct={pct} />
        </details>
      ) : (
        <StakeStory sharePct={pct} />
      )}

      {readError && !vaults && (
        <div className="fuel-state fuel-failed" role="alert">
          <WarningCircle size={20} aria-hidden="true" />
          <span>{tr("Staking can't be read right now.")}{" "}{readError}</span>
          <button className="secondary-button" onClick={() => void refresh()}>
            {tr("Try again")}</button>
        </div>
      )}
      {!vaults && !readError && <p role="status">{tr("Reading the prize pool fuel…")}</p>}
      {vaults?.status === "not-configured" && (
        <p className="fuel-state">
          {tr("Fueling isn't open on this server yet. You can keep exploring for free.")}</p>
      )}

      {vaults?.config && (
        <>
          <TierLadder
            step={ladderStep}
            progress={ladderProgress}
            next={ladderNext}
            numbers={[
              [tr("Staked"), `${fmt(summary.myStakeNear, 3)} NEAR`],
              [tr("Your share"), summary.share === null ? "–" : `${fmt(summary.share * 100, 1)} %`],
              [tr("Explorers"), summary.stakers ?? "–"],
            ]}
          />

          {positions.length > 0 && (
            <ul className="fuel-positions" aria-label={tr("Your stakes")}>
              {positions.map((p) => {
                const st = fuelStatus(p);
                return (
                  <li key={p.account_id}>
                    <span className={`fuel-chip fuel-${st.tone}`}>
                      {st.tone === "failed" ? (
                        <WarningCircle size={14} aria-hidden="true" />
                      ) : st.tone === "active" || st.tone === "ready" ? (
                        <CheckCircle size={14} aria-hidden="true" />
                      ) : (
                        <Clock size={14} aria-hidden="true" />
                      )}
                      {st.label}
                    </span>
                    <span>
                      {contributionBps(p) / 100} {" "}{tr("% of yield to the prize pool ·")}{" "}
                      {fmt(weightedGold(p))} {" "}{tr("GOLD fuel")}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <StakeToday />

          <div className="fuel-action">
            <h2>{active ? tr("Add fuel") : tr("Start fueling")}</h2>
            {!account ? (
              <>
                <p>{tr("Your explorer account is still being prepared.")}</p>
                <button className="secondary-button" onClick={onConnect}>
                  {tr("Activate my account")}</button>
              </>
            ) : (
              <>
                {fixedContribution === null ? (
                  <div className="fuel-choice" role="radiogroup" aria-label={tr("How much yield fuels the prize pool")}>
                    {CONTRIBUTION_CHOICES.map((c) => (
                      <button
                        key={c.pct}
                        role="radio"
                        aria-checked={contribution === c.pct}
                        disabled={busy}
                        onClick={() => setContribution(c.pct)}
                      >
                        <b>{c.label}</b>
                        <span>{c.pct} %</span>
                        <small>{c.hint}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="fuel-fixed">
                    {tr("This stake gives")}{" "}<b>{fixedContribution} %</b> {" "}{tr("of its yield to the prize pool.")}{" "}
                    {adjustable
                      ? tr("You can change it below.")
                      : tr("To change it, exit and start a new one.")}
                  </p>
                )}
                {active && (
                  <label className="fuel-amount">
                    <span>{tr("Amount · test NEAR")}</span>
                    <input
                      inputMode="decimal"
                      value={amount}
                      disabled={busy}
                      aria-invalid={!!amountError}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                )}
                {active && amountError && (
                  <p className="fuel-error" role="alert">
                    {amountError}
                  </p>
                )}
                {active && !amountError && (
                  <p className="fuel-suggest">
                    {gates && !gates.access.staker
                      ? tr("{0} NEAR{1} makes you a Staker after two epochs: the Keeper's inner vault and patron chapters open step by step with your level.", { 0: gates.suggestNear, 1: eurHint(Number(gates.suggestNear), gates.priceEur) ? ` (${eurHint(Number(gates.suggestNear), gates.priceEur)})` : "" })
                      : eurHint(amountNear, gates?.priceEur)
                        ? tr("{0} NEAR is about {1} at today's mainnet price.", { 0: amount, 1: eurHint(amountNear, gates?.priceEur)!.slice(1) })
                        : null}
                  </p>
                )}
                {active && !amountError && (
                  <p className="fuel-preview">
                    +{fmt(preview.addedGold)} {" "}{tr("GOLD fuel →")}{" "}
                    {preview.tierAfter === 1 ? tr("Free") : tr("Tier {0}", { 0: preview.tierAfter })}
                    {preview.tierAfter > summary.tier ? " unlocked" : ""}{tr(". It counts after about two pool epochs (1–2 days).")}</p>
                )}
                {!active && !setupPending && (
                  <label className="fuel-consent">
                    <input
                      type="checkbox"
                      checked={understood}
                      disabled={busy}
                      onChange={(e) => setUnderstood(e.target.checked)}
                    />
                    <span>
                      {tr("I understand the one-time setup of")}{" "}
                      {fmt(Number(BigInt(vaults.config.setup_deposit) / 10n ** 21n) / 1000, 3)}{" "}
                      {tr("test NEAR is not withdrawable, and this is a test-network pilot.")}</span>
                  </label>
                )}
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    (active
                      ? !!amountError
                      : !!setupPending
                        ? setupPending.state !== "created"
                        : !understood ||
                          vaults.config.created >= vaults.config.capacity)
                  }
                  onClick={() =>
                    active
                      ? void send(
                          {
                            action: "deposit",
                            vaultId: active.account_id,
                            amount: parseTestNear(amount),
                          },
                          tr("Adding your fuel…"),
                          tr("Fuel added. It starts counting after about two pool epochs."),
                        )
                      : setupPending
                        ? void send(
                            {
                              action: "register",
                              vaultId: setupPending.account_id,
                              positionId: setupPending.id,
                            },
                            tr("Finishing setup…"),
                            tr("Setup finished. Now add your first fuel."),
                          )
                        : void send(
                            {
                              action: "create",
                              poolId: vaults.pools[0]?.id,
                              contributionBps: contribution * 100,
                              setupDeposit: vaults.config.setup_deposit,
                            },
                            tr("Setting up your stake…"),
                            tr("Your stake is set up. Now add your first fuel."),
                          )
                  }
                >
                  {busy
                    ? outcome.text
                    : active
                      ? tr("Add {0}fuel", { 0: amountError ? "" : `${amount} test NEAR ` })
                      : setupPending
                        ? tr("Finish setup")
                        : tr("Set up my stake")}
                  <Flame size={20} />
                </button>
                <p className="fuel-paid">
                  {managed
                    ? tr("Paid from your balance, no popup. ")
                    : tr("Paid from your balance; your NEAR wallet asks you to approve. ")}
                  {tr("The network fee is tiny and comes from your balance too. Withdraw any time; it takes about 1–7 days.")}</p>
              </>
            )}
            {withdrawable && (
              <div className="fuel-state fuel-ready">
                <CheckCircle size={20} aria-hidden="true" />
                <span>
                  {fmtNear(String(withdrawable.position!.owner_credit))} {" "}{tr("test NEAR is back and ready to withdraw.")}</span>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      { action: "withdraw", vaultId: withdrawable.account_id },
                      "Withdrawing…",
                      tr("Withdrawn to your balance."),
                    )
                  }
                >
                  {tr("Withdraw")}</button>
              </div>
            )}
            {outcome.kind === "done" && !outcome.where && (
              <p className="fuel-state fuel-ready" role="status">
                <CheckCircle size={20} aria-hidden="true" /> {outcome.text}
              </p>
            )}
            {outcome.kind === "failed" && !outcome.where && (
              <p className="fuel-state fuel-failed" role="alert">
                <WarningCircle size={20} aria-hidden="true" /> {outcome.text}
              </p>
            )}
          </div>
        </>
      )}

      {vaults?.config && adjustable && account && (
        <FuelAdjust
          position={adjustable}
          summary={summary}
          busy={busy}
          outcome={outcome}
          send={(r, p, d) => send(r, p, d, "adjust")}
        />
      )}

      <details className="play-details fuel-advanced">
        <summary>
          <ArrowsClockwise size={18} aria-hidden="true" /> {" "}{tr("Manage stakes and withdrawals")}</summary>
        <NativeStaking
          player={player}
          onConnect={onConnect}
          onTransaction={onTransaction}
        />
      </details>
    </section>
  );
}

type Send = (
  request: Omit<VaultRequest, "accountId">,
  pending: string,
  done: string,
) => Promise<boolean>;

/**
 * Vault v2 only: take part of the stake out, or change the city's share of
 * future yield. Both quote first; the vault settles earned gain at the old
 * rate, so nothing already earned is re-priced.
 */
function FuelAdjust({
  position,
  summary,
  busy,
  outcome,
  send,
}: {
  position: FuelPosition;
  summary: FuelSummary;
  busy: boolean;
  outcome: Outcome;
  send: Send;
}) {
  const [takeOut, setTakeOut] = useState(""),
    [share, setShare] = useState<number | null>(null);
  let amountYocto = "",
    amountError = "";
  if (takeOut)
    try {
      amountYocto = parseTestNear(takeOut);
    } catch (e) {
      amountError = (e as Error).message.replace("Stake", "Take out");
    }
  const exitQuote = amountYocto ? quotePartialExit(position, amountYocto, summary) : null;
  const shareQuote = share === null ? null : quoteContribution(position, share * 100, summary);
  const current = contributionBps(position) / 100;
  const pending = position.position?.pending_contribution_bps;
  return (
    <div className="fuel-action fuel-adjust">
      <h2>{tr("Change your stake")}</h2>

      <section aria-labelledby="fuel-partial-title" className="fuel-adjust-part">
        <h3 id="fuel-partial-title">{tr("Take some out")}</h3>
        <p>
          {tr("You have")}{" "}{fmtNear(String(position.position?.principal ?? "0"))} {" "}{tr("test NEAR staked. The rest keeps fueling the prize pool.")}</p>
        <label className="fuel-amount">
          <span>{tr("Amount · test NEAR")}</span>
          <input
            inputMode="decimal"
            value={takeOut}
            placeholder="0.5"
            disabled={busy}
            aria-invalid={!!amountError || exitQuote?.ok === false}
            onChange={(e) => setTakeOut(e.target.value)}
          />
        </label>
        {amountError && (
          <p className="fuel-error" role="alert">
            {amountError}
          </p>
        )}
        {exitQuote && !exitQuote.ok && (
          <p className="fuel-error" role="alert">
            {exitQuote.reason}
          </p>
        )}
        {exitQuote?.ok && (
          <p className="fuel-preview" data-testid="partial-quote">
            {tr("You get back about")}{" "}{fmt(exitQuote.receiveNear, 3)} {" "}{tr("test NEAR")}{exitQuote.cityFeeNear > 0
              ? tr("; {0} test NEAR of yield already earned goes to the prize pool at today's {1} %", { 0: fmt(exitQuote.cityFeeNear, 3), 1: current })
              : ""}
            . {fmt(exitQuote.remainingNear, 3)} {" "}{tr("test NEAR stays staked →")}{" "}
            {fmt(exitQuote.goldAfter)} {" "}{tr("GOLD fuel,")}{" "}{tierName(exitQuote.tierAfter)}{tr(". It arrives after about 1–7 days of unstaking.")}</p>
        )}
        <button
          className="secondary-button"
          disabled={busy || !exitQuote?.ok}
          onClick={() =>
            void send(
              { action: "partial", vaultId: position.account_id, amount: amountYocto },
              tr("Taking part of your stake out…"),
              tr("Requested. Your test NEAR is unstaking; withdraw it here when it's back."),
            ).then((ok) => ok && setTakeOut(""))
          }
        >
          {busy ? tr("Working…") : tr("Take {0}out", { 0: exitQuote?.ok ? takeOut + " test NEAR " : "" })}
        </button>
      </section>

      <section aria-labelledby="fuel-share-title" className="fuel-adjust-part">
        <h3 id="fuel-share-title">{tr("Prize pool share of your yield")}</h3>
        <p>
          {tr("Now")}{" "}<b>{current} %</b>
          {typeof pending === "number"
            ? tr(", switching to {0} % once earned yield settles", { 0: pending / 100 })
            : ""}
          .
        </p>
        <div className="fuel-choice" role="radiogroup" aria-label={tr("New prize pool share")}>
          {[{ pct: 0, label: tr("None"), hint: tr("Keep all yield") }, ...CONTRIBUTION_CHOICES].map(
            (c) => (
              <button
                key={c.pct}
                role="radio"
                aria-checked={share === c.pct}
                disabled={busy}
                onClick={() => setShare(c.pct)}
              >
                <b>{c.label}</b>
                <span>{c.pct} %</span>
                <small>{c.hint}</small>
              </button>
            ),
          )}
        </div>
        {shareQuote && !shareQuote.ok && (
          <p className="fuel-error" role="alert">
            {shareQuote.reason}
          </p>
        )}
        {shareQuote?.ok && (
          <p className="fuel-preview" data-testid="share-quote">
            {shareQuote.settlesFirst
              ? tr("Yield already earned settles at {0} % first; {1} % applies when that settlement arrives (about 1–7 days).", { 0: shareQuote.oldPct, 1: shareQuote.newPct })
              : tr("{0} % applies right away, to yield earned from now on.", { 0: shareQuote.newPct })}{" "}
            → {fmt(shareQuote.goldAfter)} {" "}{tr("GOLD fuel,")}{" "}{tierName(shareQuote.tierAfter)}.
          </p>
        )}
        <button
          className="secondary-button"
          disabled={busy || !shareQuote?.ok}
          onClick={() =>
            void send(
              {
                action: "contribution",
                vaultId: position.account_id,
                contributionBps: share! * 100,
              },
              tr("Changing the prize pool share…"),
              shareQuote?.ok && shareQuote.settlesFirst
                ? tr("Requested. The new share applies once earned yield settles.")
                : tr("Prize pool share changed."),
            ).then((ok) => ok && setShare(null))
          }
        >
          {busy ? tr("Working…") : tr("Change share")}
        </button>
      </section>
      {outcome.where === "adjust" && outcome.kind === "pending" && (
        <p className="fuel-state" role="status">
          <Clock size={20} aria-hidden="true" /> {outcome.text}
        </p>
      )}
      {outcome.where === "adjust" && outcome.kind === "done" && (
        <p className="fuel-state fuel-ready" role="status">
          <CheckCircle size={20} aria-hidden="true" /> {outcome.text}
        </p>
      )}
      {outcome.where === "adjust" && outcome.kind === "failed" && (
        <p className="fuel-state fuel-failed" role="alert">
          <WarningCircle size={20} aria-hidden="true" /> {outcome.text}
        </p>
      )}
    </div>
  );
}
