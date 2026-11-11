// Explainers for /treasury (docs/TREASURY-PAGE.md): the "i" info tips, the
// money pots headline, the animated yield loop, the growth projection and the
// FAQ accordion. Everything reads live numbers passed in by TreasuryPage; the
// only assumption is the staking rate, which is labelled as an estimate.
import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowSquareOut,
  ArrowsLeftRight,
  CaretDown,
  Coins,
  Fire,
  Info,
  MagnifyingGlass,
  MapTrifold,
  Plant,
  Scales,
  UsersThree,
  Vault,
} from "@phosphor-icons/react";
import { shortNear } from "./format";
import { niceScale, num, tickLabel, toNear } from "./treasury-model";

/**
 * Yearly validator staking rate after the pool fee, as an estimate. Testnet:
 * about 9.8 % gross (2.5 % inflation, 90 % to validators, ~23 % of supply
 * staked) less a 3 % pool fee. Mainnet stakes far more of the supply, so less.
 */
export const STAKING_APR: Record<string, number> = { testnet: 9.5, mainnet: 4.5 };

/** A small "i" button that opens a plain-words explanation in place. */
export function InfoTip({ children, label = "What does this mean?" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="tr-info" ref={ref}>
      <button type="button" className="tr-info-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Info size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />
      </button>
      {open ? (
        <span id={id} role="note" className="tr-info-pop">
          {children}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Headline: the three on-chain pots that hold the game's NEAR.

export type Pot = { id: string; name: string; role: string; yocto: string | null; url: string | null; tone: string; info: string };

export function Pots({ pots, usdPerNear, network }: { pots: Pot[]; usdPerNear: number | null; network: string | null }) {
  const known = pots.filter((p) => p.yocto);
  const total = known.reduce((s, p) => s + toNear(p.yocto), 0);
  const ready = known.length === pots.length;
  return (
    <div className="tr-pots">
      <div className="tr-pots-top">
        <span className="tr-hero-label">
          Held on chain right now {network ? `· NEAR ${network}` : ""}
          <InfoTip label="What is counted here?">
            The sum of three NEAR accounts the game uses. Tap any row to open that account on the NEAR explorer and check the balance yourself.
          </InfoTip>
        </span>
        <span className="tr-hero-value">
          {known.length ? num(total, 2) : "…"} <small>{network === "mainnet" ? "NEAR" : "test NEAR"}</small>
        </span>
        <span className="tr-hero-note">{usdPerNear && ready ? `≈ ${num(total * usdPerNear)} USD at today's NEAR price` : ready ? "" : "reading the chain…"}</span>
      </div>
      <span className="tr-strip tr-strip-big" aria-hidden="true">
        {known.map((p) => (
          <span key={p.id} className={p.tone} style={{ flexGrow: Math.max(0.6, toNear(p.yocto)) }} />
        ))}
      </span>
      <ul className="tr-pot-list">
        {pots.map((p) => (
          <li key={p.id}>
            <i className={p.tone} aria-hidden="true" />
            <span className="tr-pot-name">
              <b>
                {p.name}
                <InfoTip label={`About the ${p.name.toLowerCase()}`}>{p.info}</InfoTip>
              </b>
              <small>{p.role}</small>
            </span>
            {p.url ? (
              <a className="tr-pot-value" href={p.url} target="_blank" rel="noreferrer" aria-label={`${p.name}: ${p.yocto ? shortNear(p.yocto, 2) : "…"} NEAR, open on the explorer`}>
                {p.yocto ? shortNear(p.yocto, 2) : "…"} <ArrowSquareOut size={14} aria-hidden="true" />
              </a>
            ) : (
              <span className="tr-pot-value">{p.yocto ? shortNear(p.yocto, 2) : "…"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The loop in four steps, with NEAR visibly moving between them.

const LOOP = [
  { Icon: Vault, title: "Treasury", text: "staked, never spent" },
  { Icon: Plant, title: "Daily yield", text: "becomes map coins" },
  { Icon: Coins, title: "QGOLD", text: "minted with its NEAR" },
  { Icon: Fire, title: "Spent in game", text: "burned, R rises" },
];

export function YieldLoop() {
  return (
    <ol className="tr-loop" aria-label="How the money moves, in four steps">
      {LOOP.map(({ Icon, title, text }, i) => (
        <li key={title} style={{ "--i": i } as React.CSSProperties}>
          <span className="tr-loop-icon" aria-hidden="true">
            <Icon size={26} weight="duotone" />
          </span>
          <b>{title}</b>
          <small>{text}</small>
          {i < LOOP.length - 1 ? <span className="tr-loop-link" aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Projection: where the treasury goes at today's yield.

export function Projection({ totalYocto, aprPercent, earnedYocto }: { totalYocto: string; aprPercent: number; earnedYocto: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<number | null>(null);
  const P = toNear(totalYocto);
  const perDay = (P * aprPercent) / 100 / 365;
  const months = Array.from({ length: 13 }, (_, m) => ({ m, yield: perDay * m * 30.4 }));
  const H = 200,
    L = 44,
    B = 26,
    T = 14;
  const top = P + months[12].yield;
  // Zoom on the band between the treasury and treasury + a year of yield, so
  // the growth is visible next to a much larger principal.
  const gain = Math.max(top - P, P * 0.002, 1e-9);
  const step = niceScale(gain * 1.6).ticks[1] || 1;
  const floor = Math.max(0, Math.floor((P - gain * 0.6) / step) * step);
  const n = Math.max(1, Math.ceil((top + gain * 0.1 - floor) / step - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((floor + i * step).toPrecision(12)));
  const max = floor + n * step;
  const span = max - floor || 1;
  const x = (m: number) => L + ((w - L - 8) * m) / 12;
  const y = (v: number) => T + (H - T - B) * (1 - (v - floor) / span);
  const area = (fn: (p: (typeof months)[number]) => number, base: (p: (typeof months)[number]) => number) =>
    `M${months.map((p) => `${x(p.m).toFixed(1)} ${y(fn(p)).toFixed(1)}`).join(" L")} L${[...months]
      .reverse()
      .map((p) => `${x(p.m).toFixed(1)} ${y(base(p)).toFixed(1)}`)
      .join(" L")} Z`;
  const h = hover != null ? months[hover] : null;
  return (
    <div className="tr-proj">
      <div className="tr-proj-tiles">
        <div>
          <span>Earning now</span>
          <b>≈ {num(aprPercent, 1)} %</b>
          <small>a year, estimated</small>
        </div>
        <div>
          <span>Per day</span>
          <b>{num(perDay, 3)}</b>
          <small>NEAR of yield</small>
        </div>
        <div>
          <span>In one year</span>
          <b>+{num(perDay * 365, 2)}</b>
          <small>NEAR to the map</small>
        </div>
      </div>
      <div className="tr-chart" ref={ref}>
        <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Projection: ${num(P, 1)} NEAR stays in the treasury and earns about ${num(perDay * 365, 2)} NEAR of yield in a year`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={w - 4} y1={y(t)} y2={y(t)} className="tr-grid" />
                <text x={L - 6} y={y(t) + 4} textAnchor="end" className="tr-axis">
                  {tickLabel(t, step)}
                </text>
              </g>
            ))}
          <path d={area(() => P, () => floor)} className="tr-proj-base" />
          <path d={area((p) => P + p.yield, () => P)} className="tr-proj-yield" />
          <path d={`M${x(0)} ${y(P)} L${x(12)} ${y(P + months[12].yield)}`} className="tr-proj-line" pathLength={1} />
          {months.map((p) => (
            <g key={p.m}>
              <rect x={x(p.m) - (w - L) / 26} y={T} width={(w - L) / 13} height={H - T - B} className="tr-hit" onMouseMove={() => setHover(p.m)} onFocus={() => setHover(p.m)} tabIndex={-1} />
              {p.m % 3 === 0 ? (
                <text x={x(p.m)} y={H - 8} textAnchor={p.m === 0 ? "start" : p.m === 12 ? "end" : "middle"} className="tr-axis">
                  {p.m === 0 ? "today" : `${p.m} mo`}
                </text>
              ) : null}
            </g>
          ))}
          {h ? (
            <g>
              <line x1={x(h.m)} x2={x(h.m)} y1={T} y2={H - B} className="tr-cross" />
              <circle cx={x(h.m)} cy={y(P + h.yield)} r={4.5} className="tr-proj-dot" />
            </g>
          ) : null}
        </svg>
        {h ? (
          <div className="tr-tip" style={{ left: `${(x(h.m) / w) * 100}%`, top: "8%" }} role="status">
            <b>{h.m === 0 ? "Today" : `In ${h.m} month${h.m > 1 ? "s" : ""}`}</b>
            <span>treasury {num(P, 2)} NEAR</span>
            <span>yield earned +{num(h.yield, 3)} NEAR</span>
          </div>
        ) : null}
      </div>
      <ul className="tr-legend">
        <li>
          <span className="tr-swatch tr-proj-key-base" aria-hidden="true" /> Treasury, stays put
        </li>
        <li>
          <span className="tr-swatch tr-proj-key-yield" aria-hidden="true" /> Yield it earns, paid out as map coins
        </li>
      </ul>
      <p className="eco-small eco-muted">
        A straight-line estimate at today's rate, not a promise: validator rewards move every epoch (about 7 hours) and new sponsors or fees add to the treasury.
        {earnedYocto ? ` Yield already earned and paid to the map: ${shortNear(earnedYocto, 6)} NEAR.` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQ accordion.

export type Faq = { q: string; a: React.ReactNode; Icon: typeof Vault };

export function FaqList({ items }: { items: Faq[] }) {
  return (
    <div className="tr-faq">
      {items.map(({ q, a, Icon }, i) => (
        <details key={q} open={i === 0}>
          <summary>
            <span className="tr-faq-icon" aria-hidden="true">
              <Icon size={22} weight="duotone" />
            </span>
            <span className="tr-faq-q">{q}</span>
            <CaretDown size={18} className="tr-faq-caret" aria-hidden="true" />
          </summary>
          <div className="tr-faq-a">{a}</div>
        </details>
      ))}
    </div>
  );
}

export const FAQ_ICONS = { Vault, Plant, Coins, Scales, Fire, ArrowsLeftRight, UsersThree, MagnifyingGlass, MapTrifold };
