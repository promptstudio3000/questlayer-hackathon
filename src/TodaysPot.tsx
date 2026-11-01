import { useEffect, useState } from "react";
import {
  ArrowRight,
  Coins,
  Flag,
  HandCoins,
  Leaf,
  ShieldCheck,
  ArrowCounterClockwise,
  Vault,
} from "@phosphor-icons/react";
import { api } from "./api";
import {
  formatPotGold,
  nativePot,
  practicePot,
  sourceLabel,
  type Distribution,
  type EconomyFunding,
  type PracticeDashboard,
  type TodaysPot as Pot,
} from "./todays-pot";
import "./todays-pot.css";

export type PotLedger = "practice" | "test-network";

type PotState =
  | { status: "loading" }
  | { status: "ready"; pot: Pot }
  | { status: "unavailable" };

const REFRESH_MS = 60_000;

// Reads the pot for the chosen ledger. Test-network numbers need the audited
// treasury; when it cannot be read we say so instead of showing zero.
export function useTodaysPot(ledger: PotLedger, timeZone?: string): PotState {
  const [state, setState] = useState<PotState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    async function read() {
      try {
        let pot: Pot;
        if (ledger === "practice") {
          pot = practicePot(
            await api<PracticeDashboard>("/dashboard"),
            Date.now(),
            timeZone,
          );
        } else {
          const [distribution, economy] = await Promise.all([
            api<Distribution>("/native/distribution"),
            api<EconomyFunding>("/native/economy").catch(() => null),
          ]);
          if (distribution.status === "unavailable") throw Error("unavailable");
          pot = nativePot(distribution, economy, Date.now(), timeZone);
        }
        if (alive) setState({ status: "ready", pot });
      } catch {
        if (alive) setState({ status: "unavailable" });
      }
    }
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [ledger, timeZone]);
  return state;
}

function unitLabel(pot: Pot) {
  return pot.ledger === "practice" ? "practice GOLD" : "GOLD";
}

function Meter({ pot }: { pot: Pot }) {
  if (!pot.fundedGold) return null;
  const left = Math.max(0, Math.min(1, pot.leftGold / pot.fundedGold));
  return (
    <span className="pot-meter" aria-hidden="true">
      <span style={{ width: `${Math.round(left * 100)}%` }} />
    </span>
  );
}

/** One element on the Explore sheet. Tapping opens "How rewards are funded". */
export function TodaysPotCard({
  ledger,
  timeZone,
  onOpen,
}: {
  ledger: PotLedger;
  timeZone?: string;
  onOpen: () => void;
}) {
  const state = useTodaysPot(ledger, timeZone);
  if (state.status === "loading")
    return (
      <button className="todays-pot is-loading" onClick={onOpen}>
        <span className="pot-icon">
          <Coins size={22} aria-hidden="true" />
        </span>
        <span className="pot-copy">
          <strong>Today's pot</strong>
          <small role="status">Checking what backs today's rewards…</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    );
  if (state.status === "unavailable")
    return (
      <button className="todays-pot is-unavailable" onClick={onOpen}>
        <span className="pot-icon">
          <Coins size={22} aria-hidden="true" />
        </span>
        <span className="pot-copy">
          <strong>Today's pot</strong>
          <small>Can't be read right now. Rewards on the map stay backed.</small>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    );
  const { pot } = state;
  return (
    <button
      className="todays-pot"
      onClick={onOpen}
      aria-label={`Today's pot: ${formatPotGold(pot.leftGold)} ${unitLabel(pot)} left${
        pot.fundedGold !== null
          ? ` of ${formatPotGold(pot.fundedGold)} funded today`
          : ""
      }. Source: ${sourceLabel(pot)}. How rewards are funded.`}
    >
      <span className="pot-icon">
        <Coins size={22} aria-hidden="true" />
      </span>
      <span className="pot-copy">
        <span className="pot-title">
          <strong>Today's pot</strong>
          {pot.booksChecked && (
            <span className="pot-checked">
              <ShieldCheck size={13} weight="fill" aria-hidden="true" />
              Books checked
            </span>
          )}
        </span>
        <span className="pot-amount">
          <b>{formatPotGold(pot.leftGold)}</b> {unitLabel(pot)} left
          {pot.fundedGold !== null && (
            <> of {formatPotGold(pot.fundedGold)}</>
          )}
        </span>
        <Meter pot={pot} />
        <small>
          {pot.ledger === "practice" ? "Play money" : "Test NEAR"} ·{" "}
          {sourceLabel(pot)}
        </small>
      </span>
      <ArrowRight size={18} aria-hidden="true" />
    </button>
  );
}

/** "How rewards are funded": the rules from docs/ECONOMY-RULES.md in player words. */
export function RewardsFundedGuide({
  ledger,
  timeZone,
}: {
  ledger: PotLedger;
  timeZone?: string;
}) {
  const state = useTodaysPot(ledger, timeZone);
  return (
    <section className="funded-guide" aria-labelledby="funded-today">
      <div className="funded-today">
        <h2 id="funded-today">Today's pot</h2>
        {state.status === "loading" && (
          <p role="status">Checking what backs today's rewards…</p>
        )}
        {state.status === "unavailable" && (
          <p role="status">
            Today's numbers can't be read right now. Nothing is shown as zero
            while we can't check it.
          </p>
        )}
        {state.status === "ready" && (
          <>
            <dl className="funded-numbers">
              {state.pot.ledger === "practice" ? (
                <div>
                  <dt>Added to the fund today</dt>
                  <dd>
                    {state.pot.toppedUpGold === null
                      ? "Nothing new yet"
                      : `${formatPotGold(state.pot.toppedUpGold)} ${unitLabel(state.pot)}`}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>Funded today</dt>
                  <dd>
                    {state.pot.fundedGold === null
                      ? "Today's map is not published yet"
                      : `${formatPotGold(state.pot.fundedGold)} ${unitLabel(state.pot)}`}
                  </dd>
                </div>
              )}
              <div>
                <dt>Left to find</dt>
                <dd>
                  {formatPotGold(state.pot.leftGold)} {unitLabel(state.pot)}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{sourceLabel(state.pot)}</dd>
              </div>
            </dl>
            <Meter pot={state.pot} />
            {state.pot.booksChecked ? (
              <p className="funded-checked">
                <ShieldCheck size={16} weight="fill" aria-hidden="true" />
                Books checked: every reward on today's map is backed by funds
                already received.
              </p>
            ) : ledger === "test-network" ? (
              <p className="fine-print">
                The last books check did not pass yet. New days are not
                published until it does.
              </p>
            ) : null}
            <p className="fine-print">
              {ledger === "practice"
                ? "Practice GOLD is play money and never mixes with test-network rewards."
                : "On the test network, GOLD is test NEAR (1 NEAR = 1,000 GOLD) with no monetary value."}
            </p>
          </>
        )}
      </div>
      <h2>Where rewards come from</h2>
      <ol className="funded-rules">
        <li>
          <span>
            <Vault size={22} aria-hidden="true" />
          </span>
          <div>
            <b>Only money that already arrived</b>
            <p>
              Rewards are paid from staking yield that was actually received, or
              from a named sponsor. Your own stake never pays for anyone's
              rewards.
            </p>
          </div>
        </li>
        <li>
          <span>
            <HandCoins size={22} aria-hidden="true" />
          </span>
          <div>
            <b>Half for streets, half for places</b>
            <p>
              Each top-up is split 50 / 50: street coins on one side, prizes at
              today's places on the other.
            </p>
          </div>
        </li>
        <li>
          <span>
            <Flag size={22} aria-hidden="true" />
          </span>
          <div>
            <b>Backed before it appears</b>
            <p>
              A coin or prize is set aside before it shows on the map, so the
              first explorer to reach it is always paid. On the test network a
              day can use at most 100 GOLD across all cities.
            </p>
          </div>
        </li>
        <li>
          <span>
            <ArrowCounterClockwise size={22} aria-hidden="true" />
          </span>
          <div>
            <b>Nothing found goes back</b>
            <p>
              Coins and prizes nobody collects return to the same fund for the
              next days. They never go to the team.
            </p>
          </div>
        </li>
        <li>
          <span>
            <Leaf size={22} aria-hidden="true" />
          </span>
          <div>
            <b>Stake to grow the pot</b>
            <p>
              Explorers who stake choose how much of their yield fuels the city.
              More fuel means bigger days and opens Tier 2 and Tier 3 places.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}
