import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  Coins,
  Flag,
  Leaf,
  ChartDonut,
} from "@phosphor-icons/react";
import { api } from "./api";
import { formatNativeNear } from "./native-amounts";
import "./play-ui.css";
type Bucket = { available: string; reserved: string };
type Read<T> = { status: string; observedAt: string | null; data: T | null };
type Economy = {
  status: string;
  treasury: Read<{
    funded: string;
    available: string;
    reserved: string;
    owed: string;
    pending: string;
    withdrawn: string;
    buckets: Record<string, Bucket>;
    reconciled: boolean;
  }>;
  staking: Read<{
    complete: boolean;
    coverage: { registeredPositions: number; observedPositions: number };
    totals: {
      principal: string;
      weightedStake: string;
      realizedGameYieldPaid: string;
    } | null;
    stakers: number | null;
    poolBalances: { staked: string; unstaked: string } | null;
    phases: Record<string, number>;
    pools: {
      id: string;
      name: string;
      status: string;
      staked: string | null;
      unstaked: string | null;
    }[];
    outlook: { reason: string };
  }>;
  worker: {
    status: string;
    queued: number | null;
    retrying?: number;
    ageMs?: number | null;
  };
};
const amount = (s: string | null | undefined) => {
  if (s == null) return "Unavailable";
  const n = BigInt(s),
    scale = 10n ** 18n,
    rounded = ((n + scale / 2n) / scale) * scale;
  return `${rounded !== n ? "≈ " : ""}${formatNativeNear(rounded.toString())} test NEAR`;
};
export function NativeEconomyPanel() {
  const [data, setData] = useState<Economy | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      setData(await api<Economy>("/native/economy"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const treasury = data?.treasury.data,
    staking = data?.staking.data;
  return (
    <section className="play-economy" aria-label="NEAR game economy">
      <div className="play-toolbar">
        <span className="play-chip">
          <ChartDonut size={18} />
          NEAR testnet
        </span>
        <button
          className="play-icon"
          aria-label="Refresh game economy"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={22} />
        </button>
      </div>
      <p className="play-hint">Test tokens have no monetary value.</p>
      {error && (
        <p role="alert" className="play-error">
          {error}
        </p>
      )}
      {!data && busy && <p role="status">Reading confirmed funds…</p>}
      {data && (
        <>
          {(data.treasury.status !== "observed" ||
            data.staking.status !== "observed") && (
            <p role="status" className="play-hint">
              Some observations are {data.status}. Unavailable values are not
              counted as zero.
            </p>
          )}
          <h2>Rewards for the next adventure</h2>
          {data.treasury.status === "stale" && (
            <p className="play-hint">
              Last observed{" "}
              {data.treasury.observedAt
                ? new Date(data.treasury.observedAt).toLocaleString("en-GB")
                : "at an unknown time"}
              ; current funding could not be verified.
            </p>
          )}
          <div className="economy-grid">
            <div>
              <Coins size={25} />
              <small>Street coins · 50%</small>
              <strong>{amount(treasury?.buckets.coins.available)}</strong>
            </div>
            <div>
              <Flag size={25} />
              <small>Zone quests · 50%</small>
              <strong>{amount(treasury?.buckets.zones.available)}</strong>
            </div>
          </div>
          <p className="play-hint">
            Unclaimed funds stay in their own bucket for later days.
          </p>
          <details className="play-details">
            <summary>
              <Leaf size={20} />
              Staking & validator pools
            </summary>
            {data.staking.status === "stale" && (
              <p className="play-hint">
                Last observed{" "}
                {data.staking.observedAt
                  ? new Date(data.staking.observedAt).toLocaleString("en-GB")
                  : "at an unknown time"}
                ; these are not current balances.
              </p>
            )}
            <p>
              Observed pooled stake:{" "}
              <b>{amount(staking?.poolBalances?.staked)}</b>
            </p>
            <p>
              Eligible weighted stake:{" "}
              <b>{amount(staking?.totals?.weightedStake)}</b>
            </p>
            <p>
              Contributing to rewards:{" "}
              <b>{amount(staking?.totals?.realizedGameYieldPaid)}</b> realized
              yield paid by these vaults.
            </p>
            {staking?.pools.map((p) => (
              <div className="economy-pool" key={p.id}>
                <b>{p.name}</b>
                <span>{amount(p.staked)} staked</span>
                <small>
                  {p.status} · {amount(p.unstaked)} unstaked
                </small>
              </div>
            ))}
            <p>
              {staking?.outlook.reason || "Yield forecasts are unavailable."}
            </p>
          </details>
          <details className="play-details">
            <summary>
              <ChartDonut size={20} />
              Accounting & worker
            </summary>
            {treasury && (
              <details className="play-details">
                <summary>Exact confirmed amounts</summary>
                <p>
                  Funded: {formatNativeNear(treasury.funded)} test NEAR
                  <br />
                  Street coins available:{" "}
                  {formatNativeNear(treasury.buckets.coins.available)} test NEAR
                  <br />
                  Zone rewards available:{" "}
                  {formatNativeNear(treasury.buckets.zones.available)} test NEAR
                </p>
              </details>
            )}
            <p>
              Total funded: {amount(treasury?.funded)}
              <br />
              Reserved for published days: {amount(treasury?.reserved)}
              <br />
              Earned player credit: {amount(treasury?.owed)}
              <br />
              Withdrawals pending: {amount(treasury?.pending)}
              <br />
              Withdrawn: {amount(treasury?.withdrawn)}
            </p>
            <p>
              Worker: {data.worker.status} · {data.worker.queued ?? "unknown"}{" "}
              queued receipts.
            </p>
            {data.treasury.observedAt && (
              <p>
                Observed{" "}
                {new Date(data.treasury.observedAt).toLocaleString("en-GB")}
              </p>
            )}
            <p>
              Sponsored funds and realized staking yield are separate sources.
              Neither principal nor projected returns are a spendable reward.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
