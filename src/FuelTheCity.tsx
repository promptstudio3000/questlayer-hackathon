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
  fuelStatus,
  previewFuel,
  summarizeFuel,
  weightedGold,
  type FuelPosition,
} from "./city-fuel";
import { NativeStaking, type VaultSnapshot } from "./NativeStaking";
import { parseTestNear, type VaultRequest } from "./native-vault-quote";
import type { Player } from "./types";
import "./fuel-the-city.css";

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

type Outcome =
  | { kind: "idle" }
  | { kind: "pending"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

/** Profile → Fuel the city. Staking as a choice with a city meter, not an APY table. */
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
    [amount, setAmount] = useState("1"),
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

  const positions = (vaults?.positions || []) as FuelPosition[];
  const summary = summarizeFuel(positions, {
    weightedStake: city?.staking?.data?.totals?.weightedStake,
    stakers: city?.staking?.data?.stakers,
  });
  const active = positions.find(
    (p) => p.position && p.position.stage === "idle" && !p.position.exit_requested,
  );
  const setupPending = positions.find((p) => !p.position);
  const fixedContribution = active ? active.contribution_bps / 100 : null;
  const pct = fixedContribution ?? contribution;
  let amountError = "";
  let amountNear = 0;
  try {
    amountNear = Number(BigInt(parseTestNear(amount)) / 10n ** 21n) / 1000;
  } catch (e) {
    amountError = (e as Error).message;
  }
  const preview = previewFuel(summary, amountError ? 0 : amountNear, pct);

  async function send(request: Omit<VaultRequest, "accountId">, pending: string, done: string) {
    setOutcome({ kind: "pending", text: pending });
    try {
      const ok = await onTransaction({ ...request, accountId: account });
      setOutcome(
        ok
          ? { kind: "done", text: done }
          : { kind: "failed", text: "It didn't go through. Nothing was taken; try again." },
      );
      await refresh();
    } catch (e) {
      setOutcome({ kind: "failed", text: (e as Error).message });
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
        Stake test NEAR and choose how much of its yield fuels{" "}
        {cityName || "the city"}. Your stake stays yours; the yield you share
        grows tomorrow's pot and opens Tier 2 and Tier 3 places for you.
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
      {!vaults && !readError && <p role="status">Reading the city's fuel…</p>}
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
                <h2 id="fuel-title">{cityName || "City"} fuel</h2>
                <p>
                  {summary.cityWeightedGold === null
                    ? "City total not readable right now"
                    : `${fmt(summary.cityWeightedGold)} GOLD of stake fueling the city${
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
                  ? "City fuel meter"
                  : `You give ${fmt(summary.share * 100, 1)} % of the city's fuel`
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
                  : "Every place in the city is open to you."}
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
                      {p.contribution_bps / 100} % of yield to the city ·{" "}
                      {fmt(weightedGold(p))} GOLD fuel
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

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
                  <div className="fuel-choice" role="radiogroup" aria-label="How much yield fuels the city">
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
                    the city. To change it, exit and start a new one.
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
            {outcome.kind === "done" && (
              <p className="fuel-state fuel-ready" role="status">
                <CheckCircle size={20} aria-hidden="true" /> {outcome.text}
              </p>
            )}
            {outcome.kind === "failed" && (
              <p className="fuel-state fuel-failed" role="alert">
                <WarningCircle size={20} aria-hidden="true" /> {outcome.text}
              </p>
            )}
          </div>
        </>
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
