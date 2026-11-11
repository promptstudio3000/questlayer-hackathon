// QGOLD token section of /economy (docs/QGOLD-MARKET.md): backing rate R, buy
// and sell at the vault, exit paths and queue, what backs QGOLD, the Rhea
// pool, burns, fees, the keeper's committed sale times and the R chart.
// Reads GET /api/economy/qgold. Before the vault exists it shows the rules
// only, never invented numbers.
import { useEffect, useMemo, useState } from "react";
import { shortHash, shortNear } from "./format";
import { scrollRegionKeys } from "../scroll-region";
import { type ExitPath } from "./qgold-quote";
import QgoldExchange from "./QgoldExchange";

type Path = { id: ExitPath; label: string; available: boolean; note: string; left24h?: string | null; safeWindowMs?: number | null };
type KeeperAction = { day: string; slot: number; at: string; kind: string; state: string; qgold: string | null; near: string | null; reason: string | null; txHashes: string[] };
export type QgoldData = {
  network: string;
  status: "live" | "vault-pending" | "vault-unreachable";
  reason?: string;
  token: { symbol: string; decimals: number; contract: string | null; explorerUrl: string | null };
  rules: { buyFeeBps: number; sellFeeBps: number; ladder: number[]; salesPerDay: number; maxDailySaleSupplyBps: number; buybackFeeBps: number; minPoolNear: string; initialRate: string };
  fees: { id: string; label: string; bps: number; to: string | null }[];
  vault: null | {
    contract: string;
    explorerUrl: string;
    rate: string;
    rPeak: string | null;
    supply: string;
    backing: string;
    reserveNear: string;
    lsts: { token: string; amount: string; nearValue: string }[];
    insurance: string;
    burned: string;
    fees: string;
    buyPrice: string;
    sellPrice: string;
    paused: boolean;
    exit: { instantUsed24h: string; instantCap24h: string; accountCap24h: string | null; queuePending: string; queueCount: number; safeWindowMs: number | null };
  };
  exitPaths: Path[];
  pool: { status: string; dex: string | null; poolId?: number; feeBps?: number; near?: string; qgold?: string; price?: string; premiumBps?: number | null; keeperActive?: boolean; explorerUrl?: string; swapUrl?: string | null };
  keeper: null | {
    execute: boolean;
    minPoolNear: string;
    soldToday: string;
    buybackSpent: string;
    ladder: { multiple: number; price: string; amount: string }[];
    schedule: { day: string; commitment: string; committedAt: string; salt: string | null; seed: string | null; times: string[] | null; done: number }[];
    actions: KeeperAction[];
  };
  chart: { at: string; rate: string; price: string | null }[];
};

const QG = 10n ** 6n;
/** QGOLD base units → short label. */
export function qgoldLabel(units?: string | null, digits = 2): string {
  if (!units || !/^\d+$/.test(units)) return "—";
  const v = BigInt(units);
  const whole = v / QG,
    frac = (v % QG).toString().padStart(6, "0").slice(0, digits).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
const bps = (b: number) => `${(b / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;
const nearPrice = (yocto?: string | null) => shortNear(yocto, 6);
const KIND_LABEL: Record<string, string> = {
  sale: "Sale above 1.1 R",
  "inverse-buy-burn": "Bought below R and burned",
  "buyback-burn": "Buyback from fees and burned",
  slot: "Sale time",
};

function Chart({ points }: { points: QgoldData["chart"] }) {
  const series = useMemo(() => {
    const rows = points.map((p) => ({ t: Date.parse(p.at), r: Number(BigInt(p.rate)) / 1e24, p: p.price ? Number(BigInt(p.price)) / 1e24 : null }));
    if (rows.length < 2) return null;
    const values = rows.flatMap((x) => (x.p != null ? [x.r, x.p] : [x.r]));
    const lo = Math.min(...values) * 0.98,
      hi = Math.max(...values) * 1.02 || 1;
    const t0 = rows[0].t,
      t1 = rows.at(-1)!.t || t0 + 1;
    const X = (t: number) => 8 + ((t - t0) / Math.max(1, t1 - t0)) * 584;
    const Y = (v: number) => 152 - ((v - lo) / Math.max(1e-30, hi - lo)) * 140;
    const line = (key: "r" | "p") =>
      rows
        .filter((x) => x[key] != null)
        .map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x[key] as number).toFixed(1)}`)
        .join(" ");
    return { r: line("r"), p: line("p"), lo, hi, last: rows.at(-1)! };
  }, [points]);
  if (!series) return <p className="eco-muted">The chart starts after the first readings (every 10 minutes).</p>;
  return (
    <figure className="qg-chart">
      <svg viewBox="0 0 600 160" role="img" aria-label="Backing rate R and pool price over time">
        <path d={series.r} className="qg-line-r" />
        {series.p ? <path d={series.p} className="qg-line-p" /> : null}
      </svg>
      <figcaption>
        <span className="qg-key qg-key-r">R (backing per QGOLD)</span>
        {series.p ? <span className="qg-key qg-key-p">Rhea pool price</span> : null}
        <span className="eco-muted">
          {series.lo.toPrecision(4)}–{series.hi.toPrecision(4)} NEAR
        </span>
      </figcaption>
    </figure>
  );
}

export default function QgoldSection() {
  const [data, setData] = useState<QgoldData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/economy/qgold")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  if (failed) return <section className="eco-card"><h2>QGOLD token</h2><p className="eco-muted">The token page could not be loaded. Try again in a minute.</p></section>;
  if (!data) return null;
  const v = data.vault;
  const k = data.keeper;
  return (
    <section className="eco-card qg" aria-labelledby="eco-qgold" id="qgold">
      <div className="eco-card-head">
        <h2 id="eco-qgold">QGOLD token</h2>
        <span className={`eco-badge ${data.status === "live" ? "ok" : ""}`}>{data.status === "live" ? (v?.paused ? "paused" : "live") : data.status === "vault-pending" ? "coming to testnet" : "unreachable"}</span>
      </div>
      <p className="eco-muted">
        QGOLD is the gold you earn on the map. Every QGOLD is backed by NEAR held in the QGOLD vault, so it is always worth
        at least its share R = vault NEAR ÷ QGOLD supply. Spending QGOLD in the game burns it and leaves its NEAR in the
        vault, so R only goes up. QGOLD is not an investment and pays holders nothing; the backing's staking yield goes to
        the daily prize budget.
      </p>

      {v ? (
        <>
          <div className="eco-stats qg-stats">
            <div className="eco-stat"><span className="eco-stat-label">Backing rate R</span><span className="eco-stat-value">{nearPrice(v.rate)} <small>NEAR</small></span><span className="eco-stat-note">per QGOLD{v.rPeak ? ` · peak ${nearPrice(v.rPeak)}` : ""}</span></div>
            <div className="eco-stat"><span className="eco-stat-label">Buy · Sell at the vault</span><span className="eco-stat-value">{nearPrice(v.buyPrice)} · {nearPrice(v.sellPrice)}</span><span className="eco-stat-note">R + {bps(data.rules.buyFeeBps)} · R − {bps(data.rules.sellFeeBps)}</span></div>
            <div className="eco-stat"><span className="eco-stat-label">Supply</span><span className="eco-stat-value">{qgoldLabel(v.supply, 0)}</span><span className="eco-stat-note">{qgoldLabel(v.burned, 0)} burned so far</span></div>
            <div className="eco-stat"><span className="eco-stat-label">Backing</span><span className="eco-stat-value">{shortNear(v.backing)} <small>NEAR</small></span><span className="eco-stat-note">insurance {shortNear(v.insurance)} NEAR</span></div>
          </div>
          <Chart points={data.chart} />
          <QgoldExchange data={{ ...data, exitPaths: data.exitPaths }} />
        </>
      ) : (
        <p className="eco-note">
          The QGOLD vault is not deployed on testnet yet. Until then the game pays practice GOLD. It starts at R = 0.001 NEAR
          per QGOLD (1 NEAR = 1,000 GOLD).
        </p>
      )}

      <h3>Ways out, at any time</h3>
      <ul className="eco-list qg-paths">
        {data.exitPaths.map((p) => (
          <li key={p.id} className={p.available ? "" : "qg-off"}>
            <b>{p.label}</b> — {p.note}
            {p.left24h ? <span className="eco-muted"> Instant left today: {shortNear(p.left24h)} NEAR.</span> : null}
          </li>
        ))}
      </ul>
      {v ? (
        <p className="eco-muted eco-small">
          Exit queue: {v.exit.queueCount} waiting, {shortNear(v.exit.queuePending)} NEAR. Instant exits are capped at{" "}
          {shortNear(v.exit.instantCap24h)} NEAR per 24 h for everyone together so one bad day or one exploit cannot drain the
          vault; anything above waits{v.exit.safeWindowMs ? ` ${Math.round(v.exit.safeWindowMs / 3_600_000)} h` : ""} in the queue and stays yours.
        </p>
      ) : null}

      {v ? (
        <>
          <h3>What backs QGOLD</h3>
          <ul className="eco-list">
            {v.lsts.map((l) => (
              <li key={l.token}>{l.token}: {shortNear(l.amount)} (≈ {shortNear(l.nearValue)} NEAR)</li>
            ))}
            <li>NEAR reserve: {shortNear(v.reserveNear)} NEAR</li>
          </ul>
        </>
      ) : null}

      <h3>Rhea pool</h3>
      {data.pool.status === "live" ? (
        <p>
          QGOLD/wNEAR pool #{data.pool.poolId} on {data.pool.dex}: {shortNear(data.pool.near)} NEAR and {qgoldLabel(data.pool.qgold, 0)} QGOLD,
          price {nearPrice(data.pool.price)} NEAR
          {data.pool.premiumBps != null ? ` (${data.pool.premiumBps >= 0 ? "+" : ""}${bps(data.pool.premiumBps)} vs R)` : ""}.{" "}
          {data.pool.swapUrl ? <a href={data.pool.swapUrl} target="_blank" rel="noreferrer">Swap on Rhea ↗</a> : null}
        </p>
      ) : (
        <p className="eco-muted">The QGOLD/wNEAR pool on Rhea ({data.pool.dex ?? "Rhea"}) opens once the vault is live, at the vault's buy price.</p>
      )}

      <h3>How the market is kept close to R</h3>
      <ul className="eco-list">
        <li>Sell offers on NEAR Intents at {data.rules.ladder.map((m) => `${m} R`).join(", ")}.</li>
        <li>
          {data.rules.salesPerDay} sales a day at times nobody knows in advance: committed before a NEAR block's random seed
          fixes them, revealed after the day. Each sells a twelfth of half the gap above 1.1 R, at most{" "}
          {bps(data.rules.maxDailySaleSupplyBps)} of supply a day, measured against the 24 h average price.
        </li>
        <li>{bps(data.rules.buybackFeeBps)} of all fees buy QGOLD back and burn it.</li>
        <li>Below R the keeper buys and burns until the price is back at R.</li>
        <li>All of it is off while the pool holds less than {shortNear(data.rules.minPoolNear, 0)} NEAR.</li>
      </ul>
      {k ? (
        <details className="eco-details">
          <summary>Keeper record ({k.execute ? "live" : "dry run"})</summary>
          {k.ladder.length ? (
            <p>
              Today's offers:{" "}
              {k.ladder.map((l) => `${qgoldLabel(l.amount, 0)} QGOLD at ${nearPrice(l.price)} NEAR`).join(" · ")}
            </p>
          ) : null}
          <div className="eco-table-wrap" tabIndex={0} onKeyDown={scrollRegionKeys}>
            <table className="eco-table">
              <thead><tr><th>Day</th><th>Commitment</th><th>Revealed times</th></tr></thead>
              <tbody>
                {k.schedule.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td><code title={d.commitment}>{d.commitment.slice(0, 12)}…</code></td>
                    <td>{d.times ? d.times.map((t) => t.slice(11, 16)).join(" ") : `${d.done} of 12 done, hidden until the day ends`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {k.actions.length ? (
            <ul className="eco-list eco-small">
              {k.actions.slice(0, 20).map((a, i) => (
                <li key={i}>
                  {a.at.slice(0, 16).replace("T", " ")} · {KIND_LABEL[a.kind] ?? a.kind} · {a.state}
                  {a.qgold ? ` · ${qgoldLabel(a.qgold)} QGOLD` : ""}
                  {a.near ? ` · ${shortNear(a.near)} NEAR` : ""}
                  {a.reason ? ` · ${a.reason}` : ""}
                  {a.txHashes.map((h) => (
                    <a key={h} className="eco-tx" href={`https://testnet.nearblocks.io/txns/${h}`} target="_blank" rel="noreferrer"> {shortHash(h)} ↗</a>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}

      <h3>Fees</h3>
      <div className="eco-table-wrap" tabIndex={0} onKeyDown={scrollRegionKeys}>
        <table className="eco-table">
          <tbody>
            {data.fees.map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td>{bps(f.bps)}</td>
                <td className="eco-muted">{f.to ? "to the treasury" : "free"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v ? <p className="eco-muted eco-small">Fees received so far: {shortNear(v.fees)} NEAR. <a href={v.explorerUrl} target="_blank" rel="noreferrer">Vault on the explorer ↗</a></p> : null}
    </section>
  );
}
