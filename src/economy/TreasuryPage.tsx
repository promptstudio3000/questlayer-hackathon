// Treasury dashboard at /treasury (docs/TREASURY-PAGE.md). Read-only: it reads
// the public treasury, prize pool, QGOLD vault and map budget endpoints in
// parallel, draws where the money sits and how it moves, and lets anyone model
// "what if" with the same rules the contracts and planners use. No sign-in.
import React, { useEffect, useMemo, useRef, useState } from "react";
import "./economy.css";
import "./treasury.css";
import { shortNear } from "./format";
import { arc, blendedApr, niceScale, num, rateNear, simulate, tickLabel, toNear, toUnits } from "./treasury-model";

type Bucket = { bucket: "lst" | "stable" | "near"; current: string; currentBps: number; policyBps: number };
type Mix = {
  network: string;
  account: string;
  vault: string | null;
  policy: { maxProtocolBps: number; maxUtilBps: number; maxMoveBps: number; driftBps?: number };
  total: string;
  buckets: Bucket[];
  exposure: { protocol: string; value: string; bps: number; overCap: boolean }[];
  holdings: { id: string; label: string; bucket: string; value: string; market: { utilizationBps: number; supplyAprPercent: number | null } | null }[];
  prices: { nearUsdE8: string; stale: { id: string }[] };
  next: { action: string; reason: string | null };
};
type Ledger = {
  network: string;
  explorer: string;
  rewardsContract: { id: string; explorerUrl: string } | null;
  treasury: { status: string; funded?: string; liabilities?: string; awarded?: string; liquid?: string | null };
  audit: { status: string; checks?: { name: string; ok: boolean }[] };
  realizedYield: { status: string; paid?: string; committed?: string; free?: string };
  stnear: { status: string; value?: string; principal?: string; growth?: string; harvested?: string; yieldStatus?: string | null; price?: string; depositPrice?: string | null };
  budget: { date: string; total: string; fromYield: string; coinBudget: string; zoneBudget: string }[];
  payouts: { count: number; total: string };
  tradeFees?: null | { feePips: number | null; swept: string };
  auraRoyalties?: null | { bps: number; swept: string };
};
type Qgold = {
  status: string;
  fees: { id: string; label: string; bps: number; to: string | null }[];
  rules: { buyFeeBps: number; sellFeeBps: number; ladder: number[] };
  vault: null | {
    contract: string;
    explorerUrl: string;
    rate: string;
    rPeak: string | null;
    supply: string;
    backing: string;
    insurance: string;
    burned: string;
    fees: string;
    buyPrice: string;
    sellPrice: string;
    paused: boolean;
    exit: { instantUsed24h: string; instantCap24h: string; queuePending: string; queueCount: number };
  };
  pool: { status: string; near?: string; qgold?: string; price?: string; premiumBps?: number | null };
  keeper: null | { buybackSpent: string; ladder: { multiple: number; price: string }[] };
  chart: { at: string; rate: string; price: string | null }[];
};
type MapDay = {
  day: string;
  coinsU: number;
  zonesU: number;
  pioneerU: number;
  summary: { cells: number; funded: number; pioneers: number; random: number; components: Record<string, number> };
};

type Load<T> = { data: T | null; error: string | null };
function useJson<T>(url: string): Load<T> {
  const [state, setState] = useState<Load<T>>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b?.error || `HTTP ${r.status}`)), () => Promise.reject(new Error(`HTTP ${r.status}`)))))
      .then((data) => live && setState({ data, error: null }))
      .catch((e) => live && setState({ data: null, error: String(e?.message || e) }));
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

const BUCKET_NAMES = { lst: "Liquid staking", stable: "Stablecoins on Rhea Lend", near: "NEAR reserve" } as const;
const BUCKET_TONE = { lst: "tr-c1", stable: "tr-c2", near: "tr-c3" } as const;
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })} %`;

/** Draw charts at their real width so labels stay readable on a phone. */
function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Hover readout shared by the charts: one positioned box per chart. */
type Tip = { x: number; y: number; lines: string[] } | null;
function ChartFrame({ tip, children, label, frameRef }: { tip: Tip; children: React.ReactNode; label: string; frameRef?: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="tr-chart" role="group" aria-label={label} ref={frameRef}>
      {children}
      {tip ? (
        <div className="tr-tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="status">
          {tip.lines.map((l, i) => (i ? <span key={i}>{l}</span> : <b key={i}>{l}</b>))}
        </div>
      ) : null}
    </div>
  );
}

function Legend({ items }: { items: { tone: string; label: string }[] }) {
  return (
    <ul className="tr-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`tr-swatch ${i.tone}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: React.ReactNode }) {
  return (
    <div className="tr-tile">
      <span className="tr-tile-label">{label}</span>
      <span className="tr-tile-value">
        {value} {unit ? <small>{unit}</small> : null}
      </span>
      {note ? <span className="tr-tile-note">{note}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Money flow: an animated map of how NEAR moves between the pots.

const FLOW_NODES = [
  { id: "fees", x: 20, y: 20, w: 170, label: "Fees", sub: "trades 2 % · tasks 10 % · vault 1 %" },
  { id: "treasury", x: 265, y: 20, w: 190, label: "Treasury", sub: "50 % LST · 40 % stables · 10 % NEAR" },
  { id: "insurance", x: 530, y: 20, w: 150, label: "Insurance fund", sub: "10 % of fees" },
  { id: "yield", x: 265, y: 130, w: 190, label: "Daily yield", sub: "staking + lending interest" },
  { id: "budget", x: 265, y: 240, w: 190, label: "Daily map budget", sub: "coins, zones, pioneer cells" },
  { id: "players", x: 20, y: 350, w: 170, label: "Players", sub: "walk, collect, win zones" },
  { id: "vault", x: 265, y: 350, w: 190, label: "QGOLD vault", sub: "backing R = NEAR ÷ supply" },
  { id: "market", x: 530, y: 350, w: 150, label: "Rhea pool", sub: "QGOLD ⇄ NEAR" },
] as const;
type FlowId = (typeof FLOW_NODES)[number]["id"];
const FLOW_EDGES: { from: FlowId; to: FlowId; label: string; d: string }[] = [
  { from: "fees", to: "treasury", label: "90 %", d: "M190 48 H265" },
  { from: "treasury", to: "insurance", label: "10 %", d: "M455 48 H530" },
  { from: "treasury", to: "yield", label: "earns", d: "M360 76 V130" },
  { from: "yield", to: "budget", label: "skimmed daily", d: "M360 186 V240" },
  { from: "budget", to: "vault", label: "NEAR behind each coin", d: "M360 296 V350" },
  { from: "vault", to: "players", label: "mints", d: "M265 378 H190" },
  { from: "players", to: "vault", label: "spend burns, R rises", d: "M105 406 V440 H330 V406" },
  { from: "vault", to: "market", label: "≈ R", d: "M455 378 H530" },
  { from: "players", to: "fees", label: "trades and tasks", d: "M60 350 V76" },
];

function MoneyFlow({ active, onPick }: { active: FlowId | null; onPick: (id: FlowId | null) => void }) {
  return (
    <svg className="tr-flow" viewBox="0 0 700 460" role="img" aria-label="How money moves between the treasury, the daily map budget, players and the QGOLD vault">
      <defs>
        <marker id="tr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="tr-flow-head" />
        </marker>
      </defs>
      {FLOW_EDGES.map((e) => {
        const on = !active || e.from === active || e.to === active;
        return (
          <g key={`${e.from}-${e.to}`} className={on ? "tr-edge" : "tr-edge tr-dim"}>
            <path d={e.d} className="tr-edge-line" markerEnd="url(#tr-arrow)" />
            <path d={e.d} className="tr-edge-flow" />
          </g>
        );
      })}
      {FLOW_EDGES.map((e) => {
        const m = e.d.match(/M(\d+) (\d+) ([HV])(\d+)/);
        if (!m) return null;
        const [x, y, axis, to] = [Number(m[1]), Number(m[2]), m[3], Number(m[4])];
        const lx = axis === "H" ? (x + to) / 2 : x + 8;
        const ly = axis === "H" ? y - 6 : (y + to) / 2 + 4;
        const special = e.from === "players" && e.to === "vault";
        const on = !active || e.from === active || e.to === active;
        return (
          <text
            key={`l-${e.from}-${e.to}`}
            x={special ? 215 : e.from === "players" ? 66 : lx}
            y={special ? 454 : e.from === "players" ? 215 : ly}
            className={on ? "tr-edge-label" : "tr-edge-label tr-dim"}
            textAnchor={axis === "H" && !special ? "middle" : special ? "middle" : "start"}
          >
            {e.label}
          </text>
        );
      })}
      {FLOW_NODES.map((n) => (
        <g
          key={n.id}
          className={`tr-node${active === n.id ? " tr-node-on" : ""}`}
          tabIndex={0}
          role="button"
          aria-pressed={active === n.id}
          aria-label={`${n.label}: ${n.sub}`}
          onClick={() => onPick(active === n.id ? null : n.id)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onPick(active === n.id ? null : n.id);
            }
          }}
        >
          <rect x={n.x} y={n.y} width={n.w} height={56} rx={8} />
          <text x={n.x + 12} y={n.y + 24} className="tr-node-title">
            {n.label}
          </text>
          <text x={n.x + 12} y={n.y + 43} className="tr-node-sub">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

const FLOW_ORDER: FlowId[] = ["fees", "treasury", "insurance", "yield", "budget", "vault", "players", "market"];

const FLOW_COPY: Record<FlowId, string> = {
  fees: "Every fee is paid on top of a trade or a task and lands in the treasury: 2 % of a player-to-player trade, 10 % of a paid task or paid content, 1 % when buying from or selling to the QGOLD vault. Sends and play are free.",
  treasury: "The treasury holds about half in liquid staking tokens (stNEAR, LiNEAR), 40 % in stablecoins lent on Rhea Lend and 10 % in NEAR. No more than 40 % sits with any one protocol, and a daily run moves at most a quarter of it toward the target.",
  insurance: "A tenth of every fee goes to the insurance fund, kept apart from the treasury. It exists for a protocol failure, never for paying rewards.",
  yield: "Staking rewards and lending interest are the only money the map spends. The principal stays put: only the growth is harvested each morning.",
  budget: "The daily budget is spread over the whole map, cell by cell, by a public formula: community votes, recent player demand, a random draw, the area's potential and staking. Unclaimed money rolls into the next days.",
  players: "Players earn QGOLD by walking to coins and winning zones. QXP (experience) is soulbound; QGOLD can be traded, sent or spent in the game.",
  vault: "Every QGOLD is fully backed by NEAR in the vault. R is the NEAR behind one QGOLD. Minting brings its own NEAR, so it never lowers R; spending in the game burns QGOLD and leaves its NEAR behind, so R rises for everyone.",
  market: "The Rhea pool lets anyone swap QGOLD and NEAR. A keeper sells only small, pre-committed amounts above R and buys back below it, so the market price stays near the backing.",
};

// ---------------------------------------------------------------------------
// Charts.

function MixDonut({ mix }: { mix: Mix }) {
  const [tip, setTip] = useState<Tip>(null);
  let a = 0;
  let b = 0;
  const now = mix.buckets.map((x) => {
    const seg = { ...x, from: a, to: a + x.currentBps / 10000 };
    a = seg.to;
    return seg;
  });
  const goal = mix.buckets.map((x) => {
    const seg = { ...x, from: b, to: b + x.policyBps / 10000 };
    b = seg.to;
    return seg;
  });
  const show = (x: Bucket, ring: string) => (ev: React.MouseEvent<SVGPathElement>) => {
    const box = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    setTip({
      x: ((ev.clientX - box.left) / box.width) * 100,
      y: ((ev.clientY - box.top) / box.height) * 100,
      lines: [BUCKET_NAMES[x.bucket], ring === "now" ? `now ${pct(x.currentBps)} · ${shortNear(x.current)} NEAR` : `target ${pct(x.policyBps)}`],
    });
  };
  return (
    <ChartFrame tip={tip} label="Treasury mix now against its target">
      <svg viewBox="0 0 220 220" className="tr-donut" onMouseLeave={() => setTip(null)}>
        {now.map((s) =>
          s.to > s.from ? (
            <path key={`n-${s.bucket}`} d={arc(110, 110, 84, s.from + 0.004, s.to - 0.004)} className={`tr-ring ${BUCKET_TONE[s.bucket]}`} onMouseMove={show(s, "now")}>
              <title>{`${BUCKET_NAMES[s.bucket]} now ${pct(s.currentBps)}`}</title>
            </path>
          ) : null,
        )}
        {goal.map((s) =>
          s.to > s.from ? (
            <path key={`g-${s.bucket}`} d={arc(110, 110, 60, s.from + 0.006, s.to - 0.006)} className={`tr-ring tr-ring-goal ${BUCKET_TONE[s.bucket]}`} onMouseMove={show(s, "goal")}>
              <title>{`${BUCKET_NAMES[s.bucket]} target ${pct(s.policyBps)}`}</title>
            </path>
          ) : null,
        )}
        <text x="110" y="106" textAnchor="middle" className="tr-donut-big">
          {shortNear(mix.total, 2)}
        </text>
        <text x="110" y="126" textAnchor="middle" className="tr-donut-small">
          NEAR in total
        </text>
      </svg>
    </ChartFrame>
  );
}

function ExposureBars({ mix }: { mix: Mix }) {
  const cap = mix.policy.maxProtocolBps;
  return (
    <div className="tr-bars" role="list" aria-label="Share of the treasury per protocol">
      {mix.exposure.map((e) => (
        <div key={e.protocol} className="tr-bar-row" role="listitem">
          <span>{e.protocol}</span>
          <span className="tr-bar-track">
            <span className={`tr-bar-fill ${e.overCap ? "tr-warn-fill" : "tr-c1"}`} style={{ width: `${Math.min(100, e.bps / 100)}%` }} />
            <span className="tr-bar-cap" style={{ left: `${cap / 100}%` }} title={`cap ${pct(cap)}`} />
          </span>
          <span className="tr-bar-num">
            {pct(e.bps)}
            {e.overCap ? <em className="tr-warn"> ⚠ over the {pct(cap)} cap, being reduced</em> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function BudgetChart({ rows }: { rows: Ledger["budget"] }) {
  const [tip, setTip] = useState<Tip>(null);
  const [frame, width] = useWidth<HTMLDivElement>();
  const data = rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((r) => {
      const total = toNear(r.total);
      const fromYield = Math.min(total, toNear(r.fromYield));
      return { date: r.date, total, fromYield, fromTreasury: total - fromYield };
    });
  if (!data.length) return <p className="eco-muted">No daily budget is published yet.</p>;
  const W = width,
    H = 220,
    L = 52,
    B = 28,
    T = 24;
  const { max, ticks } = niceScale(Math.max(...data.map((d) => d.total)));
  const slot = (W - L - 8) / data.length;
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  return (
    <>
      <Legend
        items={[
          { tone: "tr-c2", label: "Paid from yield" },
          { tone: "tr-c1", label: "Paid from the treasury" },
        ]}
      />
      <ChartFrame tip={tip} label="Daily map budget by date" frameRef={frame}>
        <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} className="tr-grid" />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="tr-axis">
                {tickLabel(t, ticks[1] - ticks[0])}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = L + i * slot + (slot - bw) / 2;
            const yTop = y(d.total);
            const ySplit = y(d.fromYield);
            const hit = () =>
              setTip({
                x: ((x + bw / 2) / W) * 100,
                y: (yTop / H) * 100,
                lines: [d.date, `total ${num(d.total, 4)} NEAR`, `from yield ${num(d.fromYield, 6)}`, `from treasury ${num(d.fromTreasury, 4)}`],
              });
            return (
              <g key={d.date} onMouseMove={hit} onFocus={hit} tabIndex={0} aria-label={`${d.date}: ${num(d.total, 4)} NEAR`}>
                <rect x={x - (slot - bw) / 2} y={T} width={slot} height={H - T - B} className="tr-hit" />
                {d.fromTreasury > 0 ? <rect x={x} y={yTop} width={bw} height={Math.max(0, ySplit - yTop - (d.fromYield > 0 ? 2 : 0))} rx={3} className="tr-c1" /> : null}
                {d.fromYield > 0 ? <rect x={x} y={ySplit} width={bw} height={Math.max(2, H - B - ySplit)} rx={3} className="tr-c2" /> : null}
                {i % Math.ceil(data.length / 7) === 0 || i === data.length - 1 ? (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tr-axis">
                    {d.date.slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
          <text x={L - 6} y={12} textAnchor="end" className="tr-axis">
            NEAR
          </text>
        </svg>
      </ChartFrame>
      <details className="tr-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total NEAR</th>
              <th>From yield</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td>{num(d.total, 6)}</td>
                <td>{num(d.fromYield, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function LineChart({
  points,
  label,
  unit,
  series,
  marker,
}: {
  points: { x: number; xLabel: string }[] & { [k: string]: unknown }[];
  label: string;
  unit: string;
  series: { key: string; tone: string; name: string }[];
  marker?: { value: number; name: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const [frame, width] = useWidth<HTMLDivElement>();
  const W = width,
    H = 220,
    L = 56,
    B = 28,
    T = 24;
  const values = points.flatMap((p) => series.map((s) => Number((p as Record<string, unknown>)[s.key]))).filter(Number.isFinite);
  if (marker) values.push(marker.value);
  const lo = Math.min(...values);
  const hiRaw = Math.max(...values);
  // A narrow band (R moves by tenths of a percent) gets a zoomed, step-aligned axis.
  const zoom = lo > 0 && (hiRaw - lo) / hiRaw < 0.2;
  const zoomStep = zoom ? niceScale(Math.max(hiRaw - lo, hiRaw * 0.002)).ticks[1] : 0;
  const floor = zoom ? Math.floor(lo / zoomStep) * zoomStep : 0;
  const { max: span, ticks } = zoom
    ? (() => {
        const n = Math.max(1, Math.ceil((hiRaw - floor) / zoomStep - 1e-9));
        return { max: n * zoomStep, ticks: Array.from({ length: n + 1 }, (_, i) => Number((i * zoomStep).toPrecision(12))) };
      })()
    : niceScale(hiRaw || 1);
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  const px = (x: number) => L + ((W - L - 8) * (x - x0)) / (x1 - x0 || 1);
  const py = (v: number) => T + (H - T - B) * (1 - (v - floor) / span);
  const move = (ev: React.MouseEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const sx = ((ev.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(px(p.x) - sx) < Math.abs(px(points[best].x) - sx)) best = i;
    });
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;
  return (
    <>
      {series.length > 1 ? <Legend items={series.map((s) => ({ tone: s.tone, label: s.name }))} /> : null}
      <ChartFrame
        label={label}
        frameRef={frame}
        tip={
          h
            ? {
                x: (px(h.x) / W) * 100,
                y: 8,
                lines: [h.xLabel, ...series.map((s) => `${s.name}: ${num(Number((h as Record<string, unknown>)[s.key]), 6)} ${unit}`)],
              }
            : null
        }
      >
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={move} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - 4} y1={py(t + floor)} y2={py(t + floor)} className="tr-grid" />
              <text x={L - 6} y={py(t + floor) + 4} textAnchor="end" className="tr-axis">
                {tickLabel(t + floor, ticks[1] - ticks[0])}
              </text>
            </g>
          ))}
          <text x={L - 6} y={12} textAnchor="end" className="tr-axis">
            {unit}
          </text>
          {marker ? (
            <g>
              <line x1={L} x2={W - 4} y1={py(marker.value)} y2={py(marker.value)} className="tr-marker" />
              <text x={W - 6} y={py(marker.value) - 5} textAnchor="end" className="tr-axis">
                {marker.name}
              </text>
            </g>
          ) : null}
          {series.map((s) => {
            let pen = "M";
            const d = points
              .map((p) => {
                const v = Number((p as Record<string, unknown>)[s.key]);
                if (!Number.isFinite(v)) {
                  pen = "M";
                  return "";
                }
                const seg = `${pen}${px(p.x).toFixed(1)} ${py(v).toFixed(1)}`;
                pen = "L";
                return seg;
              })
              .join(" ");
            return <path key={s.key} d={d} className={`tr-line ${s.tone}`} />;
          })}
          {h ? (
            <g>
              <line x1={px(h.x)} x2={px(h.x)} y1={T} y2={H - B} className="tr-cross" />
              {series.map((s) => {
                const v = Number((h as Record<string, unknown>)[s.key]);
                return Number.isFinite(v) ? <circle key={s.key} cx={px(h.x)} cy={py(v)} r={4.5} className={`tr-dot ${s.tone}`} /> : null;
              })}
            </g>
          ) : null}
          <text x={L} y={H - 8} className="tr-axis">
            {points[0]?.xLabel}
          </text>
          <text x={W - 6} y={H - 8} textAnchor="end" className="tr-axis">
            {points[points.length - 1]?.xLabel}
          </text>
        </svg>
      </ChartFrame>
    </>
  );
}

function PriceLadder({ q }: { q: Qgold }) {
  const v = q.vault!;
  const R = rateNear(v.rate);
  const marks = [
    { name: "Sell to vault", v: rateNear(v.sellPrice), tone: "tr-c3" },
    { name: "R (backing)", v: R, tone: "tr-c2" },
    { name: "Buy from vault", v: rateNear(v.buyPrice), tone: "tr-c3" },
    ...(q.pool.price ? [{ name: "Rhea pool", v: rateNear(q.pool.price), tone: "tr-c1" }] : []),
    ...(q.keeper?.ladder ?? []).map((l) => ({ name: `Keeper ask ${l.multiple}×R`, v: rateNear(l.price), tone: "tr-c4" })),
  ].sort((a, b) => a.v - b.v);
  const lo = R * 0.97,
    hi = Math.max(...marks.map((m) => m.v)) * 1.01;
  const x = (n: number) => 4 + (92 * (n - lo)) / (hi - lo);
  return (
    <div className="tr-ladder" role="list" aria-label="QGOLD prices around the backing rate R">
      <div className="tr-ladder-axis" aria-hidden="true">
        {marks.map((m) => (
          <span key={m.name} className={`tr-ladder-dot ${m.tone}`} style={{ left: `${x(m.v)}%` }} />
        ))}
      </div>
      <ul>
        {marks.map((m) => (
          <li key={m.name} role="listitem">
            <span className={`tr-swatch ${m.tone}`} aria-hidden="true" />
            {m.name} <b>{m.v.toFixed(6)}</b> NEAR <small>({m.v >= R ? "+" : ""}{(((m.v - R) / R) * 100).toFixed(1)} % vs R)</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meter({ used, cap, label }: { used: number; cap: number; label: string }) {
  const f = cap > 0 ? Math.min(1, used / cap) : 0;
  return (
    <div className="tr-meter">
      <span>{label}</span>
      <span className="tr-bar-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} aria-label={label}>
        <span className={`tr-bar-fill ${f > 0.8 ? "tr-warn-fill" : "tr-c2"}`} style={{ width: `${Math.max(1, f * 100)}%` }} />
      </span>
      <span className="tr-bar-num">
        {num(used, 4)} / {num(cap, 4)} NEAR ({(f * 100).toFixed(1)} %)
      </span>
    </div>
  );
}

const FORMULA = [
  { key: "votes", name: "Community votes", weight: 5000, note: "up to half; unused share goes to the others" },
  { key: "demand", name: "Player demand (7 days)", weight: 2000 },
  { key: "random", name: "Random draw", weight: 1500 },
  { key: "potential", name: "Area potential", weight: 1000 },
  { key: "stake", name: "Staking (30 days)", weight: 500 },
];

function MapSplit({ day }: { day: MapDay }) {
  const comps = day.summary.components || {};
  const used = FORMULA.filter((f) => (comps[f.key] ?? 0) > 0);
  const usedWeight = used.reduce((s, f) => s + f.weight, 0) || 1;
  return (
    <>
      <div className="tr-bars" role="list" aria-label="How today's map budget is split">
        {FORMULA.map((f) => {
          const live = (comps[f.key] ?? 0) > 0;
          const effective = live ? (f.weight / usedWeight) * 10000 : 0;
          return (
            <div key={f.key} className="tr-bar-row" role="listitem">
              <span>
                {f.name}
                <small className="eco-muted"> · {live ? `${num(comps[f.key])} cells` : f.key === "votes" ? "voting not open yet" : "no data today"}</small>
              </span>
              <span className="tr-bar-track">
                <span className="tr-bar-ghost" style={{ width: `${f.weight / 100}%` }} />
                <span className="tr-bar-fill tr-c1" style={{ width: `${effective / 100}%` }} />
              </span>
              <span className="tr-bar-num">
                {pct(effective)} <small>of {pct(f.weight)}</small>
              </span>
            </div>
          );
        })}
      </div>
      <p className="eco-small eco-muted">
        Outline: the formula weight. Fill: what it carries today after unused shares are redistributed. Then 5 % goes off the top to pioneer cells (not visited in 30 days, paid double),
        no area gets more than 25 % of a day and no cell more than 1 %.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// The simulator.

type Knobs = { treasury: number; lst: number; stable: number; lstApr: number; stableApr: number; fees: number; burn: number; days: number };

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (n: number) => void }) {
  return (
    <label className="tr-slider">
      <span>
        {label} <b>{num(value, 2)} {unit}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Simulator({ mix, q }: { mix: Mix | null; q: Qgold | null }) {
  const startTreasury = mix ? Math.max(1, Math.round(toNear(mix.total))) : 2;
  const stableApr = mix?.holdings.find((h) => h.bucket === "stable" && h.market?.supplyAprPercent)?.market?.supplyAprPercent ?? null;
  const [k, setK] = useState<Knobs>({ treasury: startTreasury, lst: 50, stable: 40, lstApr: 4.5, stableApr: stableApr && stableApr > 1 ? stableApr : 12, fees: 0.02, burn: 0.2, days: 180 });
  useEffect(() => setK((o) => ({ ...o, treasury: startTreasury })), [startTreasury]);
  const set = (key: keyof Knobs) => (n: number) =>
    setK((o) => {
      const next = { ...o, [key]: n };
      if (key === "lst" && next.lst + next.stable > 100) next.stable = 100 - next.lst;
      if (key === "stable" && next.lst + next.stable > 100) next.lst = 100 - next.stable;
      return next;
    });
  const backing = q?.vault ? toNear(q.vault.backing) : 5;
  const supply = q?.vault ? toUnits(q.vault.supply, 6) : 5000;
  const days = useMemo(
    () =>
      simulate({
        treasury: k.treasury,
        lstBps: k.lst * 100,
        stableBps: k.stable * 100,
        lstApr: k.lstApr,
        stableApr: k.stableApr,
        backing,
        supply,
        burnBpsPerDay: k.burn * 100,
        feesPerDay: k.fees,
        days: k.days,
      }),
    [k, backing, supply],
  );
  const last = days[days.length - 1];
  const apr = blendedApr(k.lst * 100, k.stable * 100, k.lstApr, k.stableApr);
  const step = Math.max(1, Math.floor(days.length / 120));
  const sample = days.filter((d, i) => i % step === 0 || i === days.length - 1);
  const yieldPoints = sample.map((d) => ({ x: d.day, xLabel: `day ${d.day}`, cumulative: d.cumulativeYield, insurance: d.insurance }));
  const ratePoints = sample.map((d) => ({ x: d.day, xLabel: `day ${d.day}`, rate: d.rate }));
  return (
    <div className="tr-sim">
      <div className="tr-sim-knobs">
        <Slider label="Treasury" value={k.treasury} min={1} max={5000} step={1} unit="NEAR" onChange={set("treasury")} />
        <Slider label="Liquid staking share" value={k.lst} min={0} max={100} step={5} unit="%" onChange={set("lst")} />
        <Slider label="Stablecoin share" value={k.stable} min={0} max={100} step={5} unit="%" onChange={set("stable")} />
        <Slider label="Staking yield" value={k.lstApr} min={0} max={10} step={0.1} unit="% a year" onChange={set("lstApr")} />
        <Slider label="Lending yield" value={k.stableApr} min={0} max={20} step={0.5} unit="% a year" onChange={set("stableApr")} />
        <Slider label="Fees per day" value={k.fees} min={0} max={5} step={0.01} unit="NEAR" onChange={set("fees")} />
        <Slider label="QGOLD spent in game per day" value={k.burn} min={0} max={2} step={0.05} unit="% of supply" onChange={set("burn")} />
        <Slider label="Horizon" value={k.days} min={30} max={730} step={10} unit="days" onChange={set("days")} />
      </div>
      <div className="tr-tiles">
        <Tile label="Blended yield" value={apr.toFixed(2)} unit="% a year" note={`NEAR reserve ${100 - k.lst - k.stable} % earns nothing`} />
        <Tile label="To the map per day" value={num(days[0].yieldToMap, 4)} unit="NEAR" note={`${num(last.yieldToMap, 4)} on day ${last.day}`} />
        <Tile label={`Sent to the map in ${k.days} days`} value={num(last.cumulativeYield, 3)} unit="NEAR" note="principal is never spent" />
        <Tile label={`R after ${k.days} days`} value={last.rate.toFixed(6)} unit="NEAR" note={`${(((last.rate - days[0].rate) / (days[0].rate || 1)) * 100).toFixed(1)} % from burns`} />
      </div>
      <h3>Money sent to the map, cumulative</h3>
      <LineChart
        points={yieldPoints as never}
        label="Cumulative yield sent to the map and insurance fund over time"
        unit="NEAR"
        series={[
          { key: "cumulative", tone: "tr-c2", name: "Yield to the map" },
          { key: "insurance", tone: "tr-c3", name: "Insurance fund" },
        ]}
      />
      <h3>QGOLD backing rate R</h3>
      <LineChart points={ratePoints as never} label="Modelled backing rate R over time" unit="NEAR" series={[{ key: "rate", tone: "tr-c1", name: "R" }]} />
      <p className="eco-small eco-muted">
        A model, not a promise: yields move, and testnet lending pays close to nothing. It follows the published rules: only yield is spent, principal stays, every QGOLD is minted
        with its NEAR, and spending burns QGOLD so R can only stay or rise. QGOLD is a game currency, not an investment.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

const CHECK_LABELS: Record<string, string> = {
  "ledger-conservation": "Every funded yoctoNEAR is accounted for",
  "coin-reservations-explained": "Coin reservations equal unclaimed coins of open days",
  "zone-reservations-explained": "Zone reservations equal unwon zone prizes",
  "open-days-match-manifests": "Every open day matches its published manifest",
  "receipts-within-chain-claims": "Our receipts never exceed claims the chain accepted",
  "date-totals-match-publications": "Daily totals match what was published",
  "yield-backed-days-covered": "Days paid from yield cost no more than the yield received",
  "account-covers-liabilities": "The contract holds enough to pay everything it owes",
};

const SAFETY = [
  "Nobody, including the team, can withdraw backing from the QGOLD vault. There is no admin withdraw.",
  "You can only ever redeem the QGOLD you hold, at R minus 1 %.",
  "Instant exits are capped at about 5 % of the vault per 24 hours, and per account; the rest waits in a fair queue.",
  "A guardian can only pause. Upgrades need several signers and a 48 hour wait.",
  "No paid chance anywhere: randomness in the game is free or earned.",
];

export default function TreasuryPage() {
  const mix = useJson<Mix>("/api/treasury/mix");
  const ledger = useJson<Ledger>("/api/economy/ledger");
  const qgold = useJson<Qgold>("/api/economy/qgold");
  const day = useJson<MapDay>("/api/map/rewards/day");
  const [flow, setFlow] = useState<FlowId | null>(null);

  useEffect(() => {
    document.title = "QuestLayer · Treasury";
    document.documentElement.classList.add("eco-root");
    return () => document.documentElement.classList.remove("eco-root");
  }, []);

  const m = mix.data,
    l = ledger.data,
    q = qgold.data,
    v = q?.vault ?? null;
  const network = m?.network ?? l?.network;
  const rChart = (q?.chart ?? []).map((p) => ({ x: Date.parse(p.at), xLabel: p.at.slice(5, 16).replace("T", " "), rate: rateNear(p.rate), price: p.price ? rateNear(p.price) : NaN }));

  return (
    <main className="eco tr">
      <header className="eco-top">
        <a className="eco-brand" href="/">
          QuestLayer
        </a>
        <nav>
          <a href="/economy">Ledger</a>
          <a href="/how-it-works">How it works</a>
          <a className="eco-play" href="/">
            Play
          </a>
        </nav>
      </header>

      <section className="eco-hero">
        <h1>Treasury</h1>
        <p>
          Where the game's money sits, how it earns, and how that yield becomes coins on the map. Live from the NEAR chain and the server's public records; the model at the bottom
          shows what happens over time.
        </p>
        {network ? <span className="eco-chip">{network === "mainnet" ? "NEAR mainnet" : "NEAR testnet"}</span> : null}
      </section>

      <section className="tr-tiles" aria-label="Headline numbers">
        <Tile label="Treasury" value={m ? shortNear(m.total, 3) : "…"} unit="NEAR" note={m ? `≈ ${num(toNear(m.total) * (Number(m.prices.nearUsdE8) / 1e8))} USD` : mix.error ? "not available" : null} />
        <Tile label="Prize pool funded" value={l?.treasury.funded ? shortNear(l.treasury.funded, 4) : "…"} unit="NEAR" note={l?.treasury.awarded ? `${shortNear(l.treasury.awarded)} paid out` : null} />
        <Tile label="QGOLD backing" value={v ? shortNear(v.backing, 3) : "…"} unit="NEAR" note={v ? `${num(toUnits(v.supply, 6), 0)} QGOLD in circulation` : null} />
        <Tile label="Backing rate R" value={v ? rateNear(v.rate).toFixed(6) : "…"} unit="NEAR" note="NEAR behind one QGOLD" />
        <Tile label="Insurance fund" value={v ? shortNear(v.insurance, 4) : "…"} unit="NEAR" note="10 % of fees" />
        <Tile label="Yield realized" value={l?.realizedYield.paid ? shortNear(l.realizedYield.paid, 6) : "…"} unit="NEAR" note="staking yield paid into the prize pool" />
      </section>

      <section className="eco-card" aria-labelledby="tr-flow">
        <h2 id="tr-flow">How the money moves</h2>
        <p className="eco-muted eco-small">Tap a box to follow its flows.</p>
        <MoneyFlow active={flow} onPick={setFlow} />
        <ol className="tr-flow-list" aria-label="Money flow, step by step">
          {FLOW_ORDER.map((id) => {
            const n = FLOW_NODES.find((x) => x.id === id)!;
            const out = FLOW_EDGES.filter((e) => e.from === id);
            return (
              <li key={id}>
                <button type="button" className={flow === id ? "tr-step tr-step-on" : "tr-step"} aria-pressed={flow === id} onClick={() => setFlow(flow === id ? null : id)}>
                  <b>{n.label}</b>
                  <small>{n.sub}</small>
                </button>
                {out.length ? (
                  <span className="tr-step-out">
                    {out.map((e) => `${e.label} → ${FLOW_NODES.find((x) => x.id === e.to)!.label}`).join(" · ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="tr-flow-copy" aria-live="polite">
          {flow ? FLOW_COPY[flow] : "Fees and sponsors fill the treasury. Only its yield is spent: every morning the growth becomes the map budget, coins carry their NEAR into the QGOLD vault, and spending QGOLD in the game raises its backing."}
        </p>
      </section>

      <section className="eco-card" aria-labelledby="tr-mix">
        <h2 id="tr-mix">Treasury mix</h2>
        {mix.error ? <p className="eco-muted">Not available on this host right now: {mix.error}</p> : null}
        {m ? (
          <div className="tr-two">
            <div>
              <MixDonut mix={m} />
              <Legend items={m.buckets.map((b) => ({ tone: BUCKET_TONE[b.bucket], label: `${BUCKET_NAMES[b.bucket]} ${pct(b.currentBps)} → ${pct(b.policyBps)}` }))} />
              <p className="eco-small eco-muted">Outer ring: now. Inner ring: the target.</p>
            </div>
            <div>
              <h3>Exposure per protocol</h3>
              <ExposureBars mix={m} />
              <p className="eco-small eco-muted">
                The line marks the {pct(m.policy.maxProtocolBps)} cap. Nothing new goes to a lending market that is {pct(m.policy.maxUtilBps)} lent out or more, and each daily run moves at most{" "}
                {pct(m.policy.maxMoveBps)}.
              </p>
              <p className="eco-small">
                Next run:{" "}
                {m.next.action === "rebalance" ? "rebalance toward the target." : m.next.reason === "within-drift" ? "nothing to do, within 3 points of the target." : (m.next.reason ?? m.next.action)}
              </p>
              {l?.stnear.status === "observed" ? (
                <p className="eco-small eco-muted">
                  stNEAR: {shortNear(l.stnear.value, 4)} NEAR against {shortNear(l.stnear.principal, 4)} principal, growth {shortNear(l.stnear.growth, 6)} NEAR
                  {l.stnear.yieldStatus === "price-flat" ? " (the testnet staking price is flat, so no growth yet)." : "."}
                </p>
              ) : null}
            </div>
          </div>
        ) : !mix.error ? (
          <p className="eco-muted">Reading the chain…</p>
        ) : null}
      </section>

      <section className="eco-card" aria-labelledby="tr-budget">
        <h2 id="tr-budget">Daily map budget</h2>
        <p className="eco-muted eco-small">What each day put on the map, and how much of it came from yield rather than the treasury itself.</p>
        {ledger.error ? <p className="eco-muted">Not available right now: {ledger.error}</p> : null}
        {l ? <BudgetChart rows={l.budget} /> : null}
        {day.data ? (
          <>
            <h3>Where today's budget goes ({day.data.day})</h3>
            <div className="tr-tiles tr-tiles-small">
              <Tile label="Cells funded" value={num(day.data.summary.funded)} note={`of ${num(day.data.summary.cells)} on the map`} />
              <Tile label="Coins" value={num(day.data.coinsU / 1e6, 2)} unit="QGOLD" />
              <Tile label="Zone prizes" value={num(day.data.zonesU / 1e6, 2)} unit="QGOLD" />
              <Tile label="Pioneer reserve" value={num(day.data.pioneerU / 1e6, 2)} unit="QGOLD" />
            </div>
            <MapSplit day={day.data} />
          </>
        ) : null}
      </section>

      <section className="eco-card" aria-labelledby="tr-qgold">
        <h2 id="tr-qgold">QGOLD backing</h2>
        {qgold.error ? <p className="eco-muted">Not available right now: {qgold.error}</p> : null}
        {v ? (
          <>
            <div className="tr-tiles tr-tiles-small">
              <Tile label="R now" value={rateNear(v.rate).toFixed(6)} unit="NEAR" note={v.rPeak ? `peak ${rateNear(v.rPeak).toFixed(6)}` : null} />
              <Tile label="Burned in game" value={num(toUnits(v.burned, 6), 2)} unit="QGOLD" />
              <Tile label="Fees collected" value={shortNear(v.fees, 4)} unit="NEAR" />
              <Tile label="Pool liquidity" value={q?.pool.near ? shortNear(q.pool.near, 3) : "—"} unit="NEAR" note={q?.pool.premiumBps != null ? `pool ${pct(q.pool.premiumBps)} over R` : null} />
            </div>
            {rChart.length > 1 ? (
              <>
                <h3>R and the pool price over time</h3>
                <LineChart
                  points={rChart as never}
                  label="Backing rate R and Rhea pool price over time"
                  unit="NEAR"
                  series={[
                    { key: "rate", tone: "tr-c2", name: "R (backing)" },
                    { key: "price", tone: "tr-c1", name: "Rhea pool price" },
                  ]}
                />
              </>
            ) : null}
            <h3>Prices around R</h3>
            <PriceLadder q={q!} />
            <h3>Exit capacity today</h3>
            <Meter used={toNear(v.exit.instantUsed24h)} cap={toNear(v.exit.instantCap24h)} label="Instant exits used in the last 24 h" />
            <p className="eco-small eco-muted">
              {v.paused ? "The vault is paused by the guardian. " : ""}
              {v.exit.queueCount ? `${v.exit.queueCount} queued exits wait for ${shortNear(v.exit.queuePending)} NEAR.` : "No exits are waiting in the queue."}{" "}
              <a href={v.explorerUrl} target="_blank" rel="noreferrer">
                Vault on the explorer ↗
              </a>
            </p>
          </>
        ) : !qgold.error ? (
          <p className="eco-muted">Reading the vault…</p>
        ) : null}
      </section>

      <section className="eco-card" aria-labelledby="tr-model">
        <h2 id="tr-model">Model the treasury</h2>
        <p className="eco-muted eco-small">Move the sliders to see how the mix, yields, fees and in-game spending shape the map budget and the backing rate. Starts from today's live numbers.</p>
        <Simulator mix={m} q={q} />
      </section>

      <section className="eco-card" aria-labelledby="tr-fees">
        <h2 id="tr-fees">Fees</h2>
        <table className="tr-fee-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Fee</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            {(q?.fees ?? []).map((f) => (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td>{pct(f.bps)}</td>
                <td>{f.to ? "treasury (10 % insurance)" : "free"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {l?.tradeFees ? <p className="eco-small eco-muted">Trade fees swept into the prize pool so far: {shortNear(l.tradeFees.swept, 6)} NEAR.</p> : null}
      </section>

      <section className="eco-card" aria-labelledby="tr-safety">
        <h2 id="tr-safety">Safety rules and live checks</h2>
        <ul className="eco-list">
          {SAFETY.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {l?.audit.checks ? (
          <>
            <h3>Prize pool audit</h3>
            <ul className="tr-checks">
              {l.audit.checks.map((c) => (
                <li key={c.name} className={c.ok ? "tr-ok" : "tr-warn"}>
                  <span aria-hidden="true">{c.ok ? "✓" : "⚠"}</span> {CHECK_LABELS[c.name] ?? c.name}
                  <span className="eco-muted"> · {c.ok ? "passes" : "under review"}</span>
                </li>
              ))}
            </ul>
            <p className="eco-small">
              Every transaction behind these numbers is on the <a href="/economy">prize pool ledger</a>.
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
