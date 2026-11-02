import { useEffect, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Flame,
  LockKeyOpen,
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
import { STAKER_SUGGEST_NEAR, takeStakePrefill } from "./LockedChip";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
import type { Player } from "./types";
import "./fuel-the-city.css";

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
const tierName = (t: number) => (t === 1 ? "Free" : `Tier ${t}`);

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
              text: "It didn't go through. Nothing was taken; try again.",
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

  const busy = outcome.kind === "pending";
  const tierPct = summary.next
    ? Math.min(100, (summary.myWeightedGold / summary.next.gold) * 100)
    : 100;
  // Full bar = all fuel in the city; the coin-coloured part is yours.
  const cityPct = summary.cityWeightedGold ? 100 : 0;

  return (
    <section className="fuel" aria-labelledby="fuel-title">
      <p className="fuel-intro">
        Stake test NEAR and choose how much of its yield fuels the global prize
        pool. Your stake stays yours; the yield you share grows tomorrow's
        rewards wherever people play, and opens Tier 2 and Tier 3 places for
        you.
      </p>

      {readError && !vaults && (
        <div className="fuel-state fuel-failed" role="alert">
          <WarningCircle size={20} aria-hidden="true" />
          <span>Staking can't be read right now. {readError}</span>
          <button className="secondary-button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {!vaults && !readError && <p role="status">Reading the prize pool fuel…</p>}
      {vaults?.status === "not-configured" && (
        <p className="fuel-state">
          Fueling isn't open on this server yet. You can keep exploring for free.
        </p>
      )}

      {vaults?.config && (
        <>
          <div className="fuel-meter-card">
            <div className="fuel-meter-head">
              <Flame size={28} weight="duotone" aria-hidden="true" />
              <div>
                <h2 id="fuel-title">Prize pool fuel</h2>
                <p>
                  {summary.cityWeightedGold === null
                    ? "Pool total not readable right now"
                    : `${fmt(summary.cityWeightedGold)} GOLD of stake fueling the prize pool${
                        summary.stakers ? ` · ${summary.stakers} explorers` : ""
                      }`}
                </p>
              </div>
            </div>
            <span
              className="fuel-meter"
              role="img"
              aria-label={
                summary.share === null
                  ? "Prize pool fuel meter"
                  : `You give ${fmt(summary.share * 100, 1)} % of the prize pool's fuel`
              }
            >
              <span style={{ width: `${cityPct}%` }} />
              {summary.share !== null && summary.share > 0 && (
                <i style={{ width: `${Math.max(2, cityPct * summary.share)}%` }} />
              )}
            </span>
            <dl className="fuel-numbers">
              <div>
                <dt>Your fuel</dt>
                <dd>{fmt(summary.myWeightedGold)} GOLD</dd>
              </div>
              <div>
                <dt>Your share</dt>
                <dd>
                  {summary.share === null ? "–" : `${fmt(summary.share * 100, 1)} %`}
                </dd>
              </div>
              <div>
                <dt>Your tier</dt>
                <dd>{summary.tier === 1 ? "Free" : `Tier ${summary.tier}`}</dd>
              </div>
            </dl>
            <div className="fuel-tier">
              <span className="fuel-tier-bar" aria-hidden="true">
                <span style={{ width: `${tierPct}%` }} />
              </span>
              <p>
                <LockKeyOpen size={16} aria-hidden="true" />{" "}
                {summary.next
                  ? `${fmt(summary.next.missingGold)} GOLD more fuel opens Tier ${summary.next.tier} places.`
                  : "Every place on the map is open to you."}
              </p>
            </div>
          </div>

          {positions.length > 0 && (
            <ul className="fuel-positions" aria-label="Your stakes">
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
                      {contributionBps(p) / 100} % of yield to the prize pool ·{" "}
                      {fmt(weightedGold(p))} GOLD fuel
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <StakeToday />

          <div className="fuel-action">
            <h2>{active ? "Add fuel" : "Start fueling"}</h2>
            {!account ? (
              <>
                <p>Your explorer account is still being prepared.</p>
                <button className="secondary-button" onClick={onConnect}>
                  Link a NEAR account instead
                </button>
              </>
            ) : (
              <>
                {fixedContribution === null ? (
                  <div className="fuel-choice" role="radiogroup" aria-label="How much yield fuels the prize pool">
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
                    This stake gives <b>{fixedContribution} %</b> of its yield to
                    the prize pool.{" "}
                    {adjustable
                      ? "You can change it below."
                      : "To change it, exit and start a new one."}
                  </p>
                )}
                {active && (
                  <label className="fuel-amount">
                    <span>Amount · test NEAR</span>
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
                      ? `${gates.suggestNear} NEAR${eurHint(Number(gates.suggestNear), gates.priceEur) ? ` (${eurHint(Number(gates.suggestNear), gates.priceEur)})` : ""} makes you a Staker after two epochs: the Keeper's inner vault and patron chapters open step by step with your level.`
                      : eurHint(amountNear, gates?.priceEur)
                        ? `${amount} NEAR is about ${eurHint(amountNear, gates?.priceEur)!.slice(1)} at today's mainnet price.`
                        : null}
                  </p>
                )}
                {active && !amountError && (
                  <p className="fuel-preview">
                    +{fmt(preview.addedGold)} GOLD fuel →{" "}
                    {preview.tierAfter === 1 ? "Free" : `Tier ${preview.tierAfter}`}
                    {preview.tierAfter > summary.tier ? " unlocked" : ""}. It
                    counts after about two pool epochs (1–2 days).
                  </p>
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
                      I understand the one-time setup of{" "}
                      {fmt(Number(BigInt(vaults.config.setup_deposit) / 10n ** 21n) / 1000, 3)}{" "}
                      test NEAR is not withdrawable, and this is a test-network
                      pilot.
                    </span>
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
                          "Adding your fuel…",
                          "Fuel added. It starts counting after about two pool epochs.",
                        )
                      : setupPending
                        ? void send(
                            {
                              action: "register",
                              vaultId: setupPending.account_id,
                              positionId: setupPending.id,
                            },
                            "Finishing setup…",
                            "Setup finished. Now add your first fuel.",
                          )
                        : void send(
                            {
                              action: "create",
                              poolId: vaults.pools[0]?.id,
                              contributionBps: contribution * 100,
                              setupDeposit: vaults.config.setup_deposit,
                            },
                            "Setting up your stake…",
                            "Your stake is set up. Now add your first fuel.",
                          )
                  }
                >
                  {busy
                    ? outcome.text
                    : active
                      ? `Add ${amountError ? "" : `${amount} test NEAR `}fuel`
                      : setupPending
                        ? "Finish setup"
                        : "Set up my stake"}
                  <Flame size={20} />
                </button>
                <p className="fuel-paid">
                  {managed
                    ? "Paid from your balance, no popup. "
                    : "Paid from your balance; your NEAR wallet asks you to approve. "}
                  The network fee is tiny and comes from your balance too.
                  Withdraw any time; it takes about 1–7 days.
                </p>
              </>
            )}
            {withdrawable && (
              <div className="fuel-state fuel-ready">
                <CheckCircle size={20} aria-hidden="true" />
                <span>
                  {fmtNear(String(withdrawable.position!.owner_credit))} test NEAR
                  is back and ready to withdraw.
                </span>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void send(
                      { action: "withdraw", vaultId: withdrawable.account_id },
                      "Withdrawing…",
                      "Withdrawn to your balance.",
                    )
                  }
                >
                  Withdraw
                </button>
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
          <ArrowsClockwise size={18} aria-hidden="true" /> Manage stakes and
          withdrawals
        </summary>
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
      <h2>Change your stake</h2>

      <section aria-labelledby="fuel-partial-title" className="fuel-adjust-part">
        <h3 id="fuel-partial-title">Take some out</h3>
        <p>
          You have {fmtNear(String(position.position?.principal ?? "0"))} test
          NEAR staked. The rest keeps fueling the prize pool.
        </p>
        <label className="fuel-amount">
          <span>Amount · test NEAR</span>
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
            You get back about {fmt(exitQuote.receiveNear, 3)} test NEAR
            {exitQuote.cityFeeNear > 0
              ? `; ${fmt(exitQuote.cityFeeNear, 3)} test NEAR of yield already earned goes to the prize pool at today's ${current} %`
              : ""}
            . {fmt(exitQuote.remainingNear, 3)} test NEAR stays staked →{" "}
            {fmt(exitQuote.goldAfter)} GOLD fuel, {tierName(exitQuote.tierAfter)}.
            It arrives after about 1–7 days of unstaking.
          </p>
        )}
        <button
          className="secondary-button"
          disabled={busy || !exitQuote?.ok}
          onClick={() =>
            void send(
              { action: "partial", vaultId: position.account_id, amount: amountYocto },
              "Taking part of your stake out…",
              "Requested. Your test NEAR is unstaking; withdraw it here when it's back.",
            ).then((ok) => ok && setTakeOut(""))
          }
        >
          {busy ? "Working…" : `Take ${exitQuote?.ok ? takeOut + " test NEAR " : ""}out`}
        </button>
      </section>

      <section aria-labelledby="fuel-share-title" className="fuel-adjust-part">
        <h3 id="fuel-share-title">Prize pool share of your yield</h3>
        <p>
          Now <b>{current} %</b>
          {typeof pending === "number"
            ? `, switching to ${pending / 100} % once earned yield settles`
            : ""}
          .
        </p>
        <div className="fuel-choice" role="radiogroup" aria-label="New prize pool share">
          {[{ pct: 0, label: "None", hint: "Keep all yield" }, ...CONTRIBUTION_CHOICES].map(
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
              ? `Yield already earned settles at ${shareQuote.oldPct} % first; ${shareQuote.newPct} % applies when that settlement arrives (about 1–7 days).`
              : `${shareQuote.newPct} % applies right away, to yield earned from now on.`}{" "}
            → {fmt(shareQuote.goldAfter)} GOLD fuel, {tierName(shareQuote.tierAfter)}.
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
              "Changing the prize pool share…",
              shareQuote?.ok && shareQuote.settlesFirst
                ? "Requested. The new share applies once earned yield settles."
                : "Prize pool share changed.",
            ).then((ok) => ok && setShare(null))
          }
        >
          {busy ? "Working…" : "Change share"}
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
