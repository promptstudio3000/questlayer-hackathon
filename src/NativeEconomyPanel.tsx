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
import { tr } from "./i18n";
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
  if (s == null) return tr("Unavailable");
  const n = BigInt(s),
    scale = 10n ** 18n,
    rounded = ((n + scale / 2n) / scale) * scale;
  return tr("{0}{1} test NEAR", { 0: rounded !== n ? "≈ " : "", 1: formatNativeNear(rounded.toString()) });
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
    <section className="play-economy" aria-label={tr("NEAR game economy")}>
      <div className="play-toolbar">
        <span className="play-chip">
          <ChartDonut size={18} />
          {tr("NEAR testnet")}</span>
        <button
          className="play-icon"
          aria-label={tr("Refresh game economy")}
          disabled={busy}
          onClick={() => void refresh()}
        >
          <ArrowClockwise size={22} />
        </button>
      </div>
      <p className="play-hint">{tr("Test tokens have no monetary value.")}</p>
      {error && (
        <p role="alert" className="play-error">
          {error}
        </p>
      )}
      {!data && busy && <p role="status">{tr("Reading confirmed funds…")}</p>}
      {data && (
        <>
          {(data.treasury.status !== "observed" ||
            data.staking.status !== "observed") && (
            <p role="status" className="play-hint">
              {tr("Some observations are")}{" "}{data.status}{tr(". Unavailable values are not counted as zero.")}</p>
          )}
          <h2>{tr("Rewards for the next adventure")}</h2>
          {data.treasury.status === "stale" && (
            <p className="play-hint">
              {tr("Last observed")}{" "}
              {data.treasury.observedAt
                ? new Date(data.treasury.observedAt).toLocaleString("en-GB")
                : tr("at an unknown time")}
              {tr("; current funding could not be verified.")}</p>
          )}
          <div className="economy-grid">
            <div>
              <Coins size={25} />
              <small>{tr("Street coins · 50%")}</small>
              <strong>{amount(treasury?.buckets.coins.available)}</strong>
            </div>
            <div>
              <Flag size={25} />
              <small>{tr("Zone quests · 50%")}</small>
              <strong>{amount(treasury?.buckets.zones.available)}</strong>
            </div>
          </div>
          <p className="play-hint">
            {tr("Unclaimed funds stay in their own bucket for later days.")}</p>
          <details className="play-details">
            <summary>
              <Leaf size={20} />
              {tr("Staking & validator pools")}</summary>
            {data.staking.status === "stale" && (
              <p className="play-hint">
                {tr("Last observed")}{" "}
                {data.staking.observedAt
                  ? new Date(data.staking.observedAt).toLocaleString("en-GB")
                  : tr("at an unknown time")}
                {tr("; these are not current balances.")}</p>
            )}
            <p>
              {tr("Observed pooled stake:")}{" "}
              <b>{amount(staking?.poolBalances?.staked)}</b>
            </p>
            <p>
              {tr("Eligible weighted stake:")}{" "}
              <b>{amount(staking?.totals?.weightedStake)}</b>
            </p>
            <p>
              {tr("Contributing to rewards:")}{" "}
              <b>{amount(staking?.totals?.realizedGameYieldPaid)}</b> {" "}{tr("realized yield paid by these vaults.")}</p>
            {staking?.pools.map((p) => (
              <div className="economy-pool" key={p.id}>
                <b>{p.name}</b>
                <span>{tr("{0} staked", { 0: amount(p.staked) })}</span>
                <small>
                  {p.status} · {tr("{0} unstaked", { 0: amount(p.unstaked) })}
                </small>
              </div>
            ))}
            <p>
              {staking?.outlook.reason || tr("Yield forecasts are unavailable.")}
            </p>
          </details>
          <details className="play-details">
            <summary>
              <ChartDonut size={20} />
              {tr("Accounting & worker")}</summary>
            {treasury && (
              <details className="play-details">
                <summary>{tr("Exact confirmed amounts")}</summary>
                <p>
                  {tr("Funded:")}{" "}{formatNativeNear(treasury.funded)} {" "}{tr("test NEAR")}<br />
                  {tr("Street coins available:")}{" "}
                  {formatNativeNear(treasury.buckets.coins.available)} {" "}{tr("test NEAR")}<br />
                  {tr("Zone rewards available:")}{" "}
                  {formatNativeNear(treasury.buckets.zones.available)} {" "}{tr("test NEAR")}</p>
              </details>
            )}
            <p>
              {tr("Total funded:")}{" "}{amount(treasury?.funded)}
              <br />
              {tr("Reserved for published days:")}{" "}{amount(treasury?.reserved)}
              <br />
              {tr("Earned player credit:")}{" "}{amount(treasury?.owed)}
              <br />
              {tr("Withdrawals pending:")}{" "}{amount(treasury?.pending)}
              <br />
              {tr("Withdrawn:")}{" "}{amount(treasury?.withdrawn)}
            </p>
            <p>
              {tr("Worker:")}{" "}{data.worker.status} · {data.worker.queued ?? "unknown"}{" "}
              {tr("queued receipts.")}</p>
            {data.treasury.observedAt && (
              <p>
                {tr("Observed")}{" "}
                {new Date(data.treasury.observedAt).toLocaleString("en-GB")}
              </p>
            )}
            <p>
              {tr("Sponsored funds and realized staking yield are separate sources. Neither principal nor projected returns are a spendable reward.")}</p>
          </details>
        </>
      )}
    </section>
  );
}
