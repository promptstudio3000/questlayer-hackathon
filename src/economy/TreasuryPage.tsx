// Treasury dashboard at /treasury (docs/TREASURY-PAGE.md). It reads the public
// treasury, prize pool, QGOLD vault and map budget endpoints in parallel, shows
// one headline card and splits the rest into tabs (overview, vote, money flow,
// QGOLD, model, safety). Reading needs no sign-in; the Vote tab lets a signed-in
// explorer vote on the weekly treasury mix (TreasuryVoteCard).
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  CaretRight,
  ChartPieSlice,
  CheckCircle,
  CheckSquareOffset,
  Coins,
  Percent,
  Plant,
  ShieldCheck,
  SlidersHorizontal,
  Warning,
} from "@phosphor-icons/react";
import TreasuryVoteCard, { closesIn, type VoteView } from "./TreasuryVoteCard";
import QgoldExchange from "./QgoldExchange";
import { FAQ_ICONS, FaqList, GLOSSARY, InfoTip, Pots, Projection, STAKING_APR, Term, YieldLoop, type Faq, type Pot } from "./TreasuryExplain";
import "./economy.css";
import "./treasury.css";
import "../public-polish.css";
import { shortNear } from "./format";
import { arc, blendedApr, niceScale, num, qgoldCount, QGOLD_B_TOKENS, rateB, simulate, tickLabel, toNear, toUnits } from "./treasury-model";

type Bucket = { bucket: "staked" | "lst" | "stable" | "near"; current: string; currentBps: number; policyBps: number };
type Mix = {
  network: string;
  account: string;
  vault: string | null;
  policy: { maxProtocolBps: number; maxUtilBps: number; maxMoveBps: number; driftBps?: number; target?: Targets };
  total: string;
  buckets: Bucket[];
  exposure: { protocol: string; value: string; bps: number; overCap: boolean }[];
  holdings: { id: string; label: string; bucket: string; value: string; vault?: string; market: { utilizationBps: number; supplyAprPercent: number | null } | null }[];
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
  network?: string;
  status: string;
  exitPaths?: { id: "near_instant" | "near_queue" | "lst"; label: string; available: boolean }[];
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
    exit: { instantUsed24h: string; instantCap24h: string; accountCap24h?: string | null; queuePending: string; queueCount: number; safeWindowMs?: number | null };
  };
  pool: { status: string; near?: string; qgold?: string; price?: string; premiumBps?: number | null; swapUrl?: string | null };
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

const BUCKET_NAMES = { staked: "Staked with validators", lst: "Liquid staking tokens", stable: "Stablecoins on Rhea Lend", near: "NEAR reserve" } as const;
const BUCKET_INFO = {
  staked: GLOSSARY.validator,
  lst: GLOSSARY.lst,
  stable: `${GLOSSARY.stable} ${GLOSSARY.rhea}`,
  near: GLOSSARY.reserve,
} as const;
const protocolInfo = (p: string) => (p.startsWith("Validator") ? GLOSSARY.validator : p === "Rhea Lend" ? GLOSSARY.rhea : p === "NEAR" ? GLOSSARY.reserve : GLOSSARY.lst);
const BUCKET_SHORT = { staked: "Staked", lst: "Liquid staking", stable: "Stablecoins", near: "NEAR" } as const;
const BUCKET_TONE = { staked: "tr-c1", lst: "tr-c4", stable: "tr-c2", near: "tr-c3" } as const;
/** Buckets worth a row: anything held or targeted (liquid staking is 0 / 0 since 11 Nov). */
const shown = (m: Mix) => m.buckets.filter((b) => b.currentBps > 0 || b.policyBps > 0);
type Targets = { staked?: number; lst: number; stable: number; near: number };
/** "90/10/0": staking (validators + liquid staking) / stablecoins / reserve. */
const mixShort = (t: Targets) => `${((t.staked ?? 0) + t.lst) / 100}/${t.stable / 100}/${t.near / 100}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })} %`;
/** Two decimals, so a share just over a cap never reads as equal to it ("40.02 %", not "40 %"). */
const pctExact = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
/** A tile value while its source is loading ("…") or could not be read ("—"). */
const pendingValue = (load: Load<unknown>) => (load.error ? "—" : "…");
const pendingNote = (load: Load<unknown>) => (load.error ? "not available on this host right now" : "reading…");

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

function Tile({ label, value, unit, note, info }: { label: string; value: string; unit?: string; note?: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div className="tr-tile">
      <span className="tr-tile-label">
        {label}
        {info ? <InfoTip label={`About ${label.toLowerCase()}`}>{info}</InfoTip> : null}
      </span>
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
  { id: "treasury", x: 265, y: 20, w: 190, label: "Treasury", sub: "staked NEAR · stablecoins" },
  { id: "insurance", x: 530, y: 20, w: 150, label: "Insurance fund", sub: "10 % of fees" },
  { id: "yield", x: 265, y: 130, w: 190, label: "Daily yield", sub: "staking + lending interest" },
  { id: "budget", x: 265, y: 240, w: 190, label: "Daily map budget", sub: "coins, zones, pioneer cells" },
  { id: "players", x: 20, y: 350, w: 170, label: "Players", sub: "walk, collect, win zones" },
  { id: "vault", x: 265, y: 350, w: 190, label: "QGOLD vault", sub: "NEAR behind every QGOLD" },
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
  { from: "players", to: "vault", label: "spending burns, backing rises", d: "M105 406 V440 H330 V406" },
  { from: "vault", to: "market", label: "≈ backing", d: "M455 378 H530" },
  { from: "players", to: "fees", label: "trades and tasks", d: "M60 350 V76" },
];

function MoneyFlow({ active, onPick, subs = {} }: { active: FlowId | null; onPick: (id: FlowId | null) => void; subs?: Partial<Record<FlowId, string>> }) {
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
          aria-label={`${n.label}: ${subs[n.id] ?? n.sub}`}
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
            {subs[n.id] ?? n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

const FLOW_ORDER: FlowId[] = ["fees", "treasury", "insurance", "yield", "budget", "vault", "players", "market"];

const FLOW_COPY: Record<FlowId, string> = {
  fees: "Every fee is paid on top of a trade or a task and lands in the treasury: 2 % of a player-to-player trade, 10 % of a paid task or paid content, 1 % when buying from or selling to the QGOLD vault. Sends and play are free.",
  treasury: "The treasury is held in the mix explorers vote on each week: NEAR staked with validators, which earns the yield, and a share of stablecoins (USDC and USDT) lent on Rhea Lend, which keeps part of it steady when the NEAR price moves. No more than 40 % sits with any one validator or protocol, and a daily run moves at most a quarter of it toward the target.",
  insurance: "A tenth of every fee goes to the insurance fund, kept apart from the treasury. It exists for a protocol failure, never for paying rewards.",
  yield: "Validator staking rewards (and any lending interest) are the only money the map spends. The principal stays put: only the growth is harvested each morning.",
  budget: "The daily budget is spread over the whole map, cell by cell, by a public formula: community votes, recent player demand, a random draw, the area's potential and staking. Unclaimed money rolls into the next days.",
  players: "Players earn QGOLD by walking to coins and winning zones; a payout round mints it to their own NEAR account within minutes. QXP (experience) is soulbound; QGOLD can be traded, sent or spent in the game.",
  vault: "Every QGOLD is backed by NEAR locked in the vault; the NEAR behind one QGOLD is its backing. Minting brings its own NEAR, so it never lowers the backing; spending in the game burns QGOLD and leaves its NEAR behind, so the backing per QGOLD rises for everyone.",
  market: "The Rhea pool lets anyone swap QGOLD and NEAR. A keeper bot sells only small, pre-announced amounts above the backing per QGOLD and buys back below it, so the market price stays near the backing.",
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
  const driftPoints = (mix.policy.driftBps ?? 300) / 100;
  const moving = mix.next.action === "rebalance";
  return (
    <div className="tr-bars" role="list" aria-label="Share of the treasury per protocol">
      {mix.exposure.map((e) => (
        <div key={e.protocol} className="tr-bar-row" role="listitem">
          <span>
            <Term tip={protocolInfo(e.protocol)}>{e.protocol}</Term>
          </span>
          <span className="tr-bar-track">
            <span className={`tr-bar-fill ${e.overCap ? "tr-warn-fill" : "tr-c1"}`} style={{ width: `${Math.min(100, e.bps / 100)}%` }} />
            <span className="tr-bar-cap" style={{ left: `${cap / 100}%` }} title={`cap ${pct(cap)}`} />
          </span>
          <span className="tr-bar-num">
            {e.overCap ? pctExact(e.bps) : pct(e.bps)}
            {e.overCap ? (
              <em className="tr-warn">
                {" "}
                <Warning size={16} weight="bold" aria-hidden="true" /> above the {pct(cap)} cap
                {moving ? "; the next run reduces it" : `; within the ${driftPoints}-point tolerance, so nothing moves yet`}
              </em>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

type History = { buckets: string[]; points: { day: string; at: number; total: string; buckets: Record<string, string>; source: string }[] };
const HISTORY_ORDER = ["staked", "lst", "stable", "near"] as const;

/** The treasury day by day: one stacked bar per day, split by bucket. */
function HistoryChart({ history }: { history: History }) {
  const [tip, setTip] = useState<Tip>(null);
  const [frame, width] = useWidth<HTMLDivElement>();
  const data = history.points.slice(-30).map((p) => ({
    day: p.day,
    total: toNear(p.total),
    parts: HISTORY_ORDER.map((b) => ({ b, v: toNear(p.buckets[b] ?? "0") })),
  }));
  if (!data.length) return <p className="eco-muted">No day is recorded on this host yet.</p>;
  const used = HISTORY_ORDER.filter((b) => data.some((d) => d.parts.some((x) => x.b === b && x.v > 0)));
  const W = width,
    H = 220,
    L = 52,
    B = 28,
    T = 24;
  const { max, ticks } = niceScale(Math.max(...data.map((d) => d.total)));
  const slot = (W - L - 8) / data.length;
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const first = data[0],
    last = data[data.length - 1];
  return (
    <>
      <div className="tr-history-head">
        <span>
          <b>{num(last.total, 2)} NEAR</b> on {last.day}
        </span>
        {data.length > 1 ? (
          <span className={last.total >= first.total ? "tr-up" : "tr-down"}>
            {last.total >= first.total ? "+" : "−"}
            {num(Math.abs(last.total - first.total), 2)} NEAR since {first.day}
          </span>
        ) : null}
      </div>
      <Legend items={used.map((b) => ({ tone: BUCKET_TONE[b], label: BUCKET_SHORT[b] }))} />
      <ChartFrame tip={tip} label="Treasury total by day, split by where it is held" frameRef={frame}>
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
            let acc = 0;
            const hit = () =>
              setTip({
                x: ((x + bw / 2) / W) * 100,
                y: (y(d.total) / H) * 100,
                lines: [d.day, `total ${num(d.total, 3)} NEAR`, ...d.parts.filter((p) => p.v > 0).map((p) => `${BUCKET_SHORT[p.b].toLowerCase()} ${num(p.v, 3)}`)],
              });
            return (
              <g key={d.day} onMouseMove={hit} onFocus={hit} tabIndex={0} aria-label={`${d.day}: ${num(d.total, 3)} NEAR`}>
                <rect x={x - (slot - bw) / 2} y={T} width={slot} height={H - T - B} className="tr-hit" />
                {d.parts.map((p) => {
                  if (p.v <= 0) return null;
                  const top = y(acc + p.v),
                    bottom = y(acc);
                  acc += p.v;
                  return <rect key={p.b} x={x} y={top} width={bw} height={Math.max(1.5, bottom - top)} className={BUCKET_TONE[p.b]} />;
                })}
                {i % Math.ceil(data.length / 7) === 0 || i === data.length - 1 ? (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="tr-axis">
                    {d.day.slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </ChartFrame>
    </>
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
  if (!data.length) return <p className="eco-muted">No funded day is recorded on this host yet. Today's plan below shows how the map budget is split.</p>;
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
  const R = rateB(v.rate);
  const marks = [
    { name: "Sell to vault", v: rateB(v.sellPrice), tone: "tr-c3" },
    { name: "Backing", v: R, tone: "tr-c2" },
    { name: "Buy from vault", v: rateB(v.buyPrice), tone: "tr-c3" },
    ...(q.pool.price ? [{ name: "Rhea pool", v: rateB(q.pool.price), tone: "tr-c1" }] : []),
    ...(q.keeper?.ladder ?? []).map((l) => ({ name: `Keeper offer at ${l.multiple}× backing`, v: rateB(l.price), tone: "tr-c4" })),
  ].sort((a, b) => a.v - b.v);
  const lo = R * 0.97,
    hi = Math.max(...marks.map((m) => m.v)) * 1.01;
  const x = (n: number) => 4 + (92 * (n - lo)) / (hi - lo);
  return (
    <div className="tr-ladder" role="list" aria-label="Prices for 1B QGOLD around the backing">
      <div className="tr-ladder-axis" aria-hidden="true">
        {marks.map((m) => (
          <span key={m.name} className={`tr-ladder-dot ${m.tone}`} style={{ left: `${x(m.v)}%` }} />
        ))}
      </div>
      <ul>
        {marks.map((m) => (
          <li key={m.name} role="listitem">
            <span className={`tr-swatch ${m.tone}`} aria-hidden="true" />
            {m.name} <b>{m.v.toFixed(4)}</b> NEAR per 1B QGOLD <small>({m.v >= R ? "+" : ""}{(((m.v - R) / R) * 100).toFixed(1)} % vs backing)</small>
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

function Simulator({ mix, q, stakingApr }: { mix: Mix | null; q: Qgold | null; stakingApr: number }) {
  const startTreasury = mix ? Math.max(1, Math.round(toNear(mix.total))) : 2;
  const stableApr = mix?.holdings.find((h) => h.bucket === "stable" && h.market?.supplyAprPercent != null)?.market?.supplyAprPercent ?? 0;
  const share = (b: string[]) => (mix ? Math.round(mix.buckets.filter((x) => b.includes(x.bucket)).reduce((n, x) => n + x.currentBps, 0) / 500) * 5 : 0);
  const startStake = mix ? share(["staked", "lst"]) : 90;
  const startStable = mix ? Math.min(100 - startStake, share(["stable"])) : 10;
  const [k, setK] = useState<Knobs>({ treasury: startTreasury, lst: startStake, stable: startStable, lstApr: stakingApr, stableApr, fees: 0.02, burn: 0.2, days: 365 });
  useEffect(() => setK((o) => ({ ...o, treasury: startTreasury, lst: startStake, stable: startStable })), [startTreasury, startStake, startStable]);
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
  const ratePoints = sample.map((d) => ({ x: d.day, xLabel: `day ${d.day}`, rate: d.rate * QGOLD_B_TOKENS }));
  return (
    <div className="tr-sim">
      <div className="tr-sim-knobs">
        <Slider label="Treasury" value={k.treasury} min={1} max={5000} step={1} unit="NEAR" onChange={set("treasury")} />
        <Slider label="Staked share" value={k.lst} min={0} max={100} step={5} unit="%" onChange={set("lst")} />
        <Slider label="Stablecoin share" value={k.stable} min={0} max={100} step={5} unit="%" onChange={set("stable")} />
        <Slider label="Staking yield" value={k.lstApr} min={0} max={10} step={0.1} unit="% a year" onChange={set("lstApr")} />
        <Slider label="Stablecoin lending yield" value={k.stableApr} min={0} max={20} step={0.5} unit="% a year" onChange={set("stableApr")} />
        <Slider label="Fees per day" value={k.fees} min={0} max={5} step={0.01} unit="NEAR" onChange={set("fees")} />
        <Slider label="QGOLD spent in game per day" value={k.burn} min={0} max={2} step={0.05} unit="% of supply" onChange={set("burn")} />
        <Slider label="Horizon" value={k.days} min={30} max={730} step={10} unit="days" onChange={set("days")} />
      </div>
      <div className="tr-tiles">
        <Tile label="Blended yield" value={apr.toFixed(2)} unit="% a year" note={`NEAR reserve ${100 - k.lst - k.stable} % earns nothing`} />
        <Tile label="To the map per day" value={num(days[0].yieldToMap, 4)} unit="NEAR" note={`${num(last.yieldToMap, 4)} on day ${last.day}`} />
        <Tile label={`Sent to the map in ${k.days} days`} value={num(last.cumulativeYield, 3)} unit="NEAR" note="principal is never spent" />
        <Tile label={`Backing per 1B QGOLD after ${k.days} days`} value={(last.rate * QGOLD_B_TOKENS).toFixed(4)} unit="NEAR" note={`${(((last.rate - days[0].rate) / (days[0].rate || 1)) * 100).toFixed(1)} % from burns`} />
      </div>
      <h3>Money to the map and to insurance, cumulative</h3>
      <LineChart
        points={yieldPoints as never}
        label="Cumulative yield sent to the map and insurance fund over time"
        unit="NEAR"
        series={[
          { key: "cumulative", tone: "tr-c2", name: "Yield to the map" },
          { key: "insurance", tone: "tr-c3", name: "Insurance fund" },
        ]}
      />
      <h3>Backing per 1B QGOLD</h3>
      <LineChart points={ratePoints as never} label="Modelled backing per 1B QGOLD over time" unit="NEAR" series={[{ key: "rate", tone: "tr-c1", name: "Backing per 1B QGOLD" }]} />
      <p className="eco-small eco-muted">
        A model, not a promise: yields move, and testnet stablecoin lending pays close to nothing. It follows the published rules: only yield is spent, principal stays, every QGOLD is minted
        with its NEAR, and spending burns QGOLD so the backing per QGOLD can only stay or rise. QGOLD is a game currency, not an investment.
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
  "You can only ever redeem the QGOLD you hold, at its backing minus 1 %.",
  "Instant exits are capped at about 5 % of the vault per 24 hours, and per account; the rest waits in a fair queue.",
  "A guardian can only pause. Upgrades need several signers and a 48 hour wait.",
  "No paid chance anywhere: randomness in the game is free or earned.",
];

type Dao = VoteView & {
  network: string;
  trezu: string | null;
  council?: string[];
  approvals?: number | null;
  keeper?: string;
  explorers?: number;
  week?: string;
  adopted?: { proposalId: number; option: string; poll: string; targets: Targets } | null;
  today?: { id: number; status: string; approvals: number; action: string } | null;
  decisions?: { id: number; type: string; title: string; status: string; approvals: number; submittedAt: number }[];
};

// ---------------------------------------------------------------------------
// Page layout: a hero with the one number that matters, then tabs, so each
// topic gets its own screen instead of one long scroll.

const TABS = [
  { id: "overview", label: "Overview", Icon: ChartPieSlice },
  { id: "vote", label: "Vote", Icon: CheckSquareOffset },
  { id: "flow", label: "Money flow", Icon: ArrowsClockwise },
  { id: "qgold", label: "QGOLD", Icon: Coins },
  { id: "model", label: "Model", Icon: SlidersHorizontal },
  { id: "safety", label: "Safety", Icon: ShieldCheck },
] as const;
type TabId = (typeof TABS)[number]["id"];
/** Old section anchors (#dao from the game, #tr-mix …) still land on the right tab. */
const HASH_TAB: Record<string, TabId> = {
  dao: "vote",
  "tr-dao": "vote",
  "tr-mix": "overview",
  "tr-history": "overview",
  history: "overview",
  "tr-flow": "flow",
  "tr-budget": "flow",
  "tr-qgold": "qgold",
  "tr-fees": "qgold",
  "tr-model": "model",
  "tr-safety": "safety",
};
function tabFromHash(): TabId {
  const h = typeof location === "undefined" ? "" : location.hash.replace(/^#/, "");
  return (TABS.find((t) => t.id === h)?.id ?? HASH_TAB[h] ?? "overview") as TabId;
}

function Section({ id, title, lead, info, children }: { id: string; title: string; lead?: React.ReactNode; info?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="tr-card" aria-labelledby={id}>
      <h2 id={id}>
        {title}
        {info ? <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip> : null}
      </h2>
      {lead ? <p className="tr-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

function VoteTeaser({ d, onOpen }: { d: Dao; onOpen: () => void }) {
  const p = d.weeklyMix;
  const lead = p?.options.find((o) => o.option === p.winner);
  return (
    <button type="button" className="tr-teaser" onClick={onOpen}>
      <span className="tr-teaser-icon" aria-hidden="true">
        <CheckSquareOffset size={26} weight="duotone" />
      </span>
      <span className="tr-teaser-text">
        <b>{p?.open ? "This week's vote is open" : "Weekly treasury vote"}</b>
        <small>
          {lead ? `Leading: ${lead.label}` : "Explorers choose the mix"}
          {p?.open && p.closesAt ? ` · ${closesIn(p.closesAt)}` : ""}
        </small>
      </span>
      <CaretRight size={20} aria-hidden="true" />
    </button>
  );
}

function DaoFacts({ d }: { d: Dao }) {
  const explorer = (id: string) => `https://${d.network === "mainnet" ? "" : "testnet."}nearblocks.io/address/${id}`;
  return (
    <>
      <div className="tr-tiles tr-tiles-small" aria-label="DAO numbers">
        <Tile label="Mix in force" value={d.adopted ? mixShort(d.adopted.targets) : "…"} note="staked / stables / reserve" />
        <Tile label="Today's run" value={d.today ? d.today.status : "not filed"} note={d.today ? `${d.today.approvals} council approvals` : "filed at 06:30"} />
        <Tile label="Explorer voters" value={String(d.explorers ?? 0)} note="synced once a day" />
        <Tile label="Council" value={String(d.council?.length ?? 0)} unit="keys" note={`${d.approvals ?? "?"} approve a run`} />
      </div>
      <ol className="tr-steps-mini">
        <li>
          <b>Explorers vote</b> each week on the mix, each with voting power earned by play (up to 100). The recommended option gets one automatic vote, so it wins when nobody votes.
        </li>
        <li>
          <b>
            The <Term tip={GLOSSARY.keeper}>keeper</Term> files
          </b>{" "}
          the day's run each morning.
        </li>
        <li>
          <b>
            Two <Term tip={GLOSSARY.council}>council</Term> keys approve
          </b>{" "}
          it after checking it against the adopted mix and the safety limits. Only then does the run happen.
        </li>
      </ol>
      {d.decisions?.length ? (
        <details className="tr-more">
          <summary>Recent decisions ({d.decisions.length})</summary>
          <ol className="tr-dao-log">
            {d.decisions.map((x) => (
              <li key={x.id}>
                #{x.id} {x.title} <small className="eco-muted">· {x.status}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <p className="eco-small eco-muted">
        A <Term tip={GLOSSARY.dao}>Sputnik DAO</Term> on NEAR:{" "}
        <a href={explorer(d.dao)} rel="noreferrer" target="_blank">
          {d.dao}
        </a>
        . Roles use Trezu's names (Requestor, Admin, Approver)
        {d.trezu ? (
          <>
            ,{" "}
            <a href={d.trezu} rel="noreferrer" target="_blank">
              open in Trezu
            </a>
          </>
        ) : null}
        . Custody stays with the operator account on testnet for now; the DAO approves every run.
      </p>
    </>
  );
}

export default function TreasuryPage() {
  const mix = useJson<Mix>("/api/treasury/mix");
  const dao = useJson<Dao>("/api/treasury/dao");
  const ledger = useJson<Ledger>("/api/economy/ledger");
  const qgold = useJson<Qgold>("/api/economy/qgold");
  const day = useJson<MapDay>("/api/map/rewards/day");
  const hist = useJson<History>("/api/treasury/history");
  const [flow, setFlow] = useState<FlowId | null>(null);
  const [tab, setTabState] = useState<TabId>(tabFromHash);
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "QuestLayer · Treasury";
    document.documentElement.classList.add("eco-root");
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      document.documentElement.classList.remove("eco-root");
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  function setTab(next: TabId, scroll = false) {
    setTabState(next);
    history.replaceState(null, "", next === "overview" ? location.pathname : `#${next}`);
    if (scroll) tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const m = mix.data,
    l = ledger.data,
    q = qgold.data,
    v = q?.vault ?? null,
    d = dao.data?.exists ? dao.data : null;
  const network = m?.network ?? l?.network;
  const rChart = (q?.chart ?? []).map((p) => ({ x: Date.parse(p.at), xLabel: p.at.slice(5, 16).replace("T", " "), rate: rateB(p.rate), price: p.price ? rateB(p.price) : NaN }));
  const nearUsd = m ? Number(m.prices.nearUsdE8) / 1e8 : null;
  const explorerBase = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  const stakingApr = STAKING_APR[network ?? "testnet"] ?? STAKING_APR.testnet;
  // Blended yearly rate of what the treasury holds today: staked NEAR at the
  // validator rate, stablecoins at Rhea's live lending rate, the rest earns nothing
  // (testnet liquid staking prices are frozen).
  const apr = m && toNear(m.total) > 0
    ? m.holdings.reduce((sum, h) => {
        const rate = h.bucket === "staked" ? stakingApr : h.bucket === "stable" ? (h.market?.supplyAprPercent ?? 0) : h.bucket === "lst" && network === "mainnet" ? stakingApr : 0;
        return sum + toNear(h.value) * rate;
      }, 0) / toNear(m.total)
    : null;
  const perDay = m && apr != null ? (toNear(m.total) * apr) / 100 / 365 : null;
  const target = d?.adopted?.targets ?? m?.policy.target ?? null;
  const stakedNow = m ? m.buckets.filter((b) => b.bucket === "staked" || b.bucket === "lst").reduce((n, b) => n + b.currentBps, 0) : null;
  const stableNow = m ? (m.buckets.find((b) => b.bucket === "stable")?.currentBps ?? 0) : null;
  const flowSubs: Partial<Record<FlowId, string>> = target
    ? { treasury: `${(((target.staked ?? 0) + target.lst) / 100).toLocaleString("en-GB")} % staked · ${(target.stable / 100).toLocaleString("en-GB")} % stables` }
    : {};
  const pots: Pot[] = [
    {
      id: "treasury",
      name: "Treasury",
      role: "earns the yield, never spent",
      yocto: m?.total ?? null,
      url: m ? `${explorerBase}/address/${m.account}` : null,
      tone: "tr-c1",
      info: "The game's savings, mostly NEAR staked with validators plus a small share of stablecoins, in the mix explorers vote on. Only its yield is paid out. The link opens the operator account; its staking vaults are listed under Safety.",
    },
    {
      id: "pool",
      name: "Prize pool",
      role: "pays coins and zone prizes",
      yocto: l?.treasury.liquid ?? l?.treasury.funded ?? null,
      url: l?.rewardsContract?.explorerUrl ?? null,
      tone: "tr-c2",
      info: "The rewards contract. It holds what the map pays out each day. On testnet sponsors filled it; the treasury's daily yield tops it up.",
    },
    {
      id: "vault",
      name: "QGOLD vault",
      role: "backs every QGOLD",
      yocto: v?.backing ?? null,
      url: v?.explorerUrl ?? null,
      tone: "tr-c3",
      info: "Holds the NEAR behind every QGOLD in circulation. It has no admin withdraw: only QGOLD holders can take NEAR out, by selling their own QGOLD back.",
    },
  ];
  const faq: Faq[] = [
    {
      Icon: FAQ_ICONS.Vault,
      q: "What is the treasury?",
      a: (
        <p>
          The game's shared savings{m ? `: ${shortNear(m.total, 1)} NEAR right now` : ""}, held mostly as NEAR staked with validators. It is never spent. Only the yield it earns is.
        </p>
      ),
    },
    {
      Icon: FAQ_ICONS.Plant,
      q: "So what pays for the coins on the map?",
      a: (
        <p>
          The staking yield{perDay != null ? `, about ${num(perDay, 3)} NEAR a day today` : ""}. Every morning it becomes that day's map budget: coins, zone prizes and pioneer cells all over the map.
        </p>
      ),
    },
    {
      Icon: FAQ_ICONS.Coins,
      q: "What backs QGOLD?",
      a: (
        <>
          <p>
            NEAR. Every QGOLD is minted together with its NEAR, which stays locked in the QGOLD vault{v ? ` (${shortNear(v.backing, 2)} NEAR now)` : ""}. The backing per QGOLD is vault NEAR ÷ QGOLD supply{v ? `, now ${rateB(v.rate).toFixed(4)} NEAR per 1B QGOLD` : ""}.
          </p>
          <p>
            The NEAR for new QGOLD comes from the treasury's yield, and the treasury itself is held in the mix explorers vote on: staked NEAR plus a share of stablecoins
            {target ? ` (target ${(((target.staked ?? 0) + target.lst) / 100).toLocaleString("en-GB")} % staked, ${(target.stable / 100).toLocaleString("en-GB")} % stablecoins)` : ""}.
          </p>
        </>
      ),
    },
    {
      Icon: FAQ_ICONS.Scales,
      q: "Why does the treasury hold stablecoins at all?",
      a: (
        <p>
          Staked NEAR earns the yield. Stablecoins (USDC and USDT, lent on Rhea) keep part of the treasury steady in dollars when the NEAR price falls, so the map budget can still be paid. Explorers vote each week on the split
          {stakedNow != null && stableNow != null ? `; today it is ${pct(stakedNow)} staked and ${pct(stableNow)} stablecoins` : ""}.
        </p>
      ),
    },
    {
      Icon: FAQ_ICONS.Fire,
      q: "Why does spending QGOLD make the rest worth more?",
      a: <p>Spending in the game burns the QGOLD but leaves its NEAR in the vault. Fewer QGOLD now share the same NEAR, so the backing per QGOLD goes up for everyone who holds it.</p>,
    },
    {
      Icon: FAQ_ICONS.ArrowsLeftRight,
      q: "Can I swap QGOLD back to NEAR?",
      a: (
        <p>
          Yes, any time, at its backing minus a 1 % fee, with the swap card at the top of this page. Instant exits are capped per day
          {v ? ` (${shortNear(v.exit.instantCap24h, 2)} NEAR for everyone together)` : ""} so a bad day cannot drain the vault; anything above waits in a fair queue for up to 48 hours and stays yours.
        </p>
      ),
    },
    {
      Icon: FAQ_ICONS.UsersThree,
      q: "Who decides how the treasury is held?",
      a: (
        <p>
          Explorers at level {d?.rule.minLevel ?? 3}+ who played this week vote on the weekly mix in the{" "}
          <button type="button" className="tr-inline-link" onClick={() => setTab("vote", true)}>
            Vote tab
          </button>
          . Each morning the keeper files the day's run and {d?.approvals ?? 2} of {d?.council?.length ?? 3} council keys approve it after checking it against the voted mix and the safety limits.
        </p>
      ),
    },
    {
      Icon: FAQ_ICONS.MagnifyingGlass,
      q: "How can I check all of this myself?",
      a: (
        <ul className="tr-proof">
          {pots.map((p) =>
            p.url ? (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.name} on the NEAR explorer ↗
                </a>
              </li>
            ) : null,
          )}
          {d ? (
            <li>
              <a href={`${explorerBase}/address/${d.dao}`} target="_blank" rel="noreferrer">
                Treasury DAO {d.dao} ↗
              </a>
            </li>
          ) : null}
          <li>
            <a href="/economy">Prize pool ledger: every day and payout with its transaction</a>
          </li>
        </ul>
      ),
    },
  ];

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

      <section className="tr-hero" aria-label="Treasury at a glance">
        <div className="tr-hero-top">
          <h1>Treasury</h1>
          {network ? <span className="tr-chip">{network === "mainnet" ? "NEAR mainnet" : "NEAR testnet"}</span> : null}
        </div>
        <p className="tr-hero-sub">The game's shared money, all of it on chain. The treasury is never spent: only its yield pays for the coins on the map.</p>
        <div className="tr-hero-grid">
          <div className="tr-hero-main">
            <div className="tr-hero-card">
              <Pots pots={pots} usdPerNear={nearUsd} network={network ?? null} />
            </div>
            <div className="tr-stats">
              <div className="tr-stat">
                <Percent size={20} weight="duotone" aria-hidden="true" />
                <span>
                  Treasury earns
                  <InfoTip label="How is this rate worked out?">
                    An estimate from what the treasury holds today: staked NEAR at about {num(stakingApr, 1)} % a year (the validator rate after the pool's fee), stablecoins at Rhea's live lending rate, the rest at 0.
                  </InfoTip>
                </span>
                <b>{apr != null ? `≈ ${num(apr, 1)} % a year` : pendingValue(mix)}</b>
              </div>
              <div className="tr-stat">
                <Plant size={20} weight="duotone" aria-hidden="true" />
                <span>
                  Yield per day
                  <InfoTip label="What is the daily yield?">The NEAR the treasury earns in a day at that rate. This is what goes to the map as coins and zone prizes; the treasury itself stays.</InfoTip>
                </span>
                <b>{perDay != null ? `${num(perDay, 3)} NEAR` : pendingValue(mix)}</b>
              </div>
              <div className="tr-stat">
                <Coins size={20} weight="duotone" aria-hidden="true" />
                <span>
                  1B QGOLD is backed by
                  <InfoTip label="What is the backing per QGOLD?">{GLOSSARY.backing}</InfoTip>
                </span>
                <b>{v ? `${rateB(v.rate).toFixed(4)} NEAR` : q ? "—" : pendingValue(qgold)}</b>
              </div>
            </div>
          </div>
          {q?.vault ? <QgoldExchange data={{ ...q, network: network ?? undefined }} compact /> : null}
        </div>
      </section>

      <div className="tr-tabs" role="tablist" aria-label="Treasury topics" ref={tabsRef}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tr-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="tr-panel"
            className={tab === id ? "tr-tab on" : "tr-tab"}
            onClick={() => setTab(id)}
          >
            <Icon size={18} weight={tab === id ? "fill" : "regular"} aria-hidden="true" /> {label}
            {id === "vote" && d?.weeklyMix?.open ? <span className="tr-dot" aria-label="open" /> : null}
          </button>
        ))}
      </div>

      <div id="tr-panel" role="tabpanel" aria-labelledby={`tr-tab-${tab}`} className="tr-panel">
        {tab === "overview" ? (
          <>
            <YieldLoop />
            {d ? <VoteTeaser d={d} onOpen={() => setTab("vote", true)} /> : null}
            {m && apr != null ? (
              <Section
                id="tr-growth"
                title="Where the treasury is heading"
                lead="At today's yield, if nothing else changes."
                info="The treasury itself stays the same; the green band is the yield it earns, which is paid out to players as map coins day by day."
              >
                <Projection totalYocto={m.total} aprPercent={apr} earnedYocto={l?.realizedYield.paid ?? null} />
              </Section>
            ) : null}
            <Section
              id="tr-mix"
              title="Treasury mix"
              lead="Outer ring: how it is held now. Inner ring: the target explorers voted for."
              info="Staked NEAR earns the yield. Stablecoins keep part of the treasury steady in dollars. The daily run moves the treasury toward the voted target, at most a quarter at a time."
            >
              {mix.error ? <p className="eco-muted">Not available on this host right now: {mix.error}</p> : null}
              {m ? (
                <div className="tr-two">
                  <div>
                    <MixDonut mix={m} />
                  </div>
                  <div>
                    <ul className="tr-buckets">
                      {shown(m).map((b) => (
                        <li key={b.bucket}>
                          <i className={BUCKET_TONE[b.bucket]} aria-hidden="true" />
                          <span>
                            <b>
                              {BUCKET_NAMES[b.bucket]}
                              <InfoTip label={`What is ${BUCKET_NAMES[b.bucket].toLowerCase()}?`}>{BUCKET_INFO[b.bucket]}</InfoTip>
                            </b>
                            <small>
                              {shortNear(b.current, 3)} NEAR · target {pct(b.policyBps)}
                            </small>
                          </span>
                          <b className="tr-bucket-pct">{pct(b.currentBps)}</b>
                        </li>
                      ))}
                    </ul>
                    <p className="tr-next">
                      <ArrowsClockwise size={18} aria-hidden="true" /> Next run:{" "}
                      {m.next.action === "rebalance"
                        ? "rebalance toward the target."
                        : m.next.reason === "within-drift"
                          ? `nothing to do, within ${(m.policy.driftBps ?? 300) / 100} points of the target.`
                          : (m.next.reason ?? m.next.action)}
                    </p>
                  </div>
                </div>
              ) : !mix.error ? (
                <p className="eco-muted">Reading the chain…</p>
              ) : null}
            </Section>
            <Section
              id="tr-history"
              title="Treasury history"
              lead="The treasury day by day since 1 November, and where it was held."
              info="One bar per day. The jump on 11 November is when 93 test NEAR were staked with a validator through the treasury's staking vault."
            >
              {hist.error ? <p className="eco-muted">Not available on this host right now.</p> : hist.data ? <HistoryChart history={hist.data} /> : <p className="eco-muted">Reading…</p>}
            </Section>
            <Section id="tr-faq" title="How it works">
              <FaqList items={faq} />
            </Section>
            {day.data ? (
              <Section id="tr-today" title="Today on the map" lead={`What the daily budget put on the map on ${day.data.day}.`}>
                <div className="tr-tiles tr-tiles-small">
                  <Tile label="Coins" value={qgoldCount(day.data.coinsU)} unit="QGOLD" info="All coins on the map today together. Walking to one mints its share to the finder's own NEAR account." />
                  <Tile label="Zone prizes" value={qgoldCount(day.data.zonesU)} unit="QGOLD" info="Prizes for winning zones today, all zones together." />
                  <Tile label="Pioneer reserve" value={qgoldCount(day.data.pioneerU)} unit="QGOLD" info="5 % kept for cells nobody visited in 30 days; a pioneer who goes there gets double." />
                  <Tile label="Cells funded" value={num(day.data.summary.funded)} note={`of ${num(day.data.summary.cells)}`} info="The map is split into hexagonal cells. A funded cell has at least one coin or prize today." />
                </div>
                <button type="button" className="tr-link" onClick={() => setTab("flow", true)}>
                  How the budget is split <CaretRight size={16} aria-hidden="true" />
                </button>
              </Section>
            ) : null}
          </>
        ) : null}

        {tab === "vote" ? (
          <>
            {dao.error && !dao.data ? <p className="eco-muted">The treasury vote is not available on this host.</p> : null}
            {dao.data && !dao.data.exists ? <p className="eco-muted">The DAO {dao.data.dao} is not created yet.</p> : null}
            {!dao.data && !dao.error ? <p className="eco-muted">Reading the DAO…</p> : null}
            {d ? (
              <>
                <Section id="tr-dao" title="Weekly treasury vote" lead="Explorers choose how the shared treasury is held. The council carries out the result.">
                  <TreasuryVoteCard initial={d} />
                </Section>
                <Section id="tr-who" title="Who decides">
                  <DaoFacts d={d} />
                </Section>
              </>
            ) : null}
          </>
        ) : null}

        {tab === "flow" ? (
          <>
            <Section id="tr-flow" title="How the money moves" lead="Tap a box to follow its flows.">
              <MoneyFlow active={flow} onPick={setFlow} subs={flowSubs} />
              <ol className="tr-flow-list" aria-label="Money flow, step by step">
                {FLOW_ORDER.map((id) => {
                  const n = FLOW_NODES.find((x) => x.id === id)!;
                  const out = FLOW_EDGES.filter((e) => e.from === id);
                  return (
                    <li key={id}>
                      <button type="button" className={flow === id ? "tr-step tr-step-on" : "tr-step"} aria-pressed={flow === id} onClick={() => setFlow(flow === id ? null : id)}>
                        <b>{n.label}</b>
                        <small>{flowSubs[id] ?? n.sub}</small>
                      </button>
                      {out.length ? <span className="tr-step-out">{out.map((e) => `${e.label} → ${FLOW_NODES.find((x) => x.id === e.to)!.label}`).join(" · ")}</span> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="tr-flow-copy" aria-live="polite">
                {flow
                  ? FLOW_COPY[flow]
                  : "Fees and sponsors fill the treasury. Only its yield is spent: the daily harvest becomes the map budget, every collected coin is minted as QGOLD with its NEAR in the vault, and spending QGOLD in the game burns it, so each remaining QGOLD is backed by more."}
              </p>
            </Section>
            <Section id="tr-budget" title="Daily map budget" lead="What each day put on the map, and how much of it came from yield.">
              {ledger.error ? <p className="eco-muted">Not available right now: {ledger.error}</p> : null}
              {l ? <BudgetChart rows={l.budget} /> : null}
              {day.data ? (
                <>
                  <h3>How today's budget is split ({day.data.day})</h3>
                  <MapSplit day={day.data} />
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        {tab === "qgold" ? (
          <>
            <Section id="tr-qgold" title="QGOLD backing" lead="Every QGOLD is backed by NEAR in the vault. The backing per QGOLD is the NEAR behind one QGOLD." info={GLOSSARY.backing}>
              {qgold.error ? <p className="eco-muted">Not available right now: {qgold.error}</p> : null}
              {v ? (
                <>
                  <div className="tr-tiles tr-tiles-small">
                    <Tile label="Backing per 1B QGOLD" info={GLOSSARY.backing} value={rateB(v.rate).toFixed(4)} unit="NEAR" note={v.rPeak ? `peak ${rateB(v.rPeak).toFixed(4)}` : null} />
                    <Tile label="In circulation" value={qgoldCount(v.supply)} unit="QGOLD" />
                    <Tile label="Burned in game" value={qgoldCount(v.burned)} unit="QGOLD" />
                    <Tile label="Pool liquidity" value={q?.pool.near ? shortNear(q.pool.near, 3) : "—"} unit="NEAR" note={q?.pool.premiumBps != null ? `pool price ${pct(q.pool.premiumBps)} over the backing` : null} />
                  </div>
                  {rChart.length > 1 ? (
                    <>
                      <h3>Backing per 1B QGOLD and the Rhea pool price over time</h3>
                      <LineChart
                        points={rChart as never}
                        label="Backing per 1B QGOLD and Rhea pool price over time"
                        unit="NEAR"
                        series={[
                          { key: "rate", tone: "tr-c2", name: "Backing per 1B QGOLD" },
                          { key: "price", tone: "tr-c1", name: "Rhea pool price" },
                        ]}
                      />
                    </>
                  ) : null}
                  <h3>
                    Prices around the backing
                    <InfoTip label="What are these prices?">
                      The vault always buys QGOLD back at the backing minus 1 % and sells it at the backing plus 1 %. The Rhea pool price floats in between or above. {GLOSSARY.keeper}
                    </InfoTip>
                  </h3>
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
            </Section>
            <Section id="tr-fees" title="Fees" lead="Fees are paid on top of trades and tasks. Sends and play are free.">
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
              {v ? <p className="eco-small eco-muted">Fees collected by the vault: {shortNear(v.fees, 4)} NEAR. Insurance fund: {shortNear(v.insurance, 4)} NEAR.</p> : null}
              {l?.tradeFees ? <p className="eco-small eco-muted">Trade fees swept into the prize pool so far: {shortNear(l.tradeFees.swept, 6)} NEAR.</p> : null}
            </Section>
          </>
        ) : null}

        {tab === "model" ? (
          <Section id="tr-model" title="Model the treasury" lead="Move the sliders to see how the mix, yields, fees and in-game spending shape the map budget and the backing rate. Starts from today's live numbers.">
            <Simulator mix={m} q={q} stakingApr={stakingApr} />
          </Section>
        ) : null}

        {tab === "safety" ? (
          <>
            <Section id="tr-safety" title="Safety rules">
              <ul className="tr-rules">
                {SAFETY.map((s) => (
                  <li key={s}>
                    <ShieldCheck size={20} weight="duotone" aria-hidden="true" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Section>
            {m ? (
              <Section id="tr-exposure" title="Exposure per protocol">
                <ExposureBars mix={m} />
                <p className="eco-small eco-muted">
                  The line marks the {pct(m.policy.maxProtocolBps)} cap. Nothing new goes to a lending market that is {pct(m.policy.maxUtilBps)} lent out or more <InfoTip label="What is utilization?">{GLOSSARY.utilization}</InfoTip>, and each daily run moves at most{" "}
                  {pct(m.policy.maxMoveBps)}.
                </p>
                {l?.stnear.status === "observed" ? (
                  <p className="eco-small eco-muted">
                    <Term tip={GLOSSARY.lst}>stNEAR</Term>: {shortNear(l.stnear.value, 4)} NEAR against {shortNear(l.stnear.principal, 4)} principal, growth {shortNear(l.stnear.growth, 6)} NEAR
                    {l.stnear.yieldStatus === "price-flat" ? " (the testnet staking price is flat, so no growth yet)." : "."}
                  </p>
                ) : null}
              </Section>
            ) : null}
            <Section id="tr-audit" title="Prize pool checks">
              <div className="tr-tiles tr-tiles-small">
                <Tile label="Prize pool funded" value={l?.treasury.funded ? shortNear(l.treasury.funded, 4) : l ? "—" : pendingValue(ledger)} unit="NEAR" note={l?.treasury.awarded ? `${shortNear(l.treasury.awarded)} paid out` : null} />
                <Tile label="Insurance fund" info={GLOSSARY.insurance} value={v ? shortNear(v.insurance, 4) : q ? "—" : pendingValue(qgold)} unit="NEAR" note="10 % of fees, kept apart" />
              </div>
              {l?.audit.checks ? (
                <ul className="tr-checks">
                  {l.audit.checks.map((c) => (
                    <li key={c.name} className={c.ok ? "tr-ok" : "tr-warn"}>
                      {c.ok ? <CheckCircle size={18} weight="bold" aria-hidden="true" /> : <Warning size={18} weight="bold" aria-hidden="true" />} {CHECK_LABELS[c.name] ?? c.name}
                      <span className="eco-muted"> · {c.ok ? "passes" : "under review"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="eco-small">
                Every transaction behind these numbers is on the <a href="/economy">prize pool ledger</a>.
              </p>
            </Section>
          </>
        ) : null}
      </div>
    </main>
  );
}
