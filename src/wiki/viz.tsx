// Small, dependency-free SVG building blocks for the /wiki know-how pages:
// flow diagrams with moving dashes, sequence diagrams that replay message by
// message, line/bar/stacked/donut charts and a 24-hour timeline. Motion is
// CSS only and stops under prefers-reduced-motion (see wiki.css).
import React, { useId } from "react";
import { scrollRegionKeys } from "../scroll-region";

export type Tone = "core" | "chain" | "money" | "player" | "ai" | "world" | "muted" | "warn";

// ---------------------------------------------------------------- flow ----

export type FlowNode = {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  sub?: string;
  tone?: Tone;
  pulse?: boolean;
};
export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  /** Animate a moving dash along the edge (money or data flowing). */
  flow?: boolean;
  tone?: Tone;
  bend?: number;
};

function anchor(a: Required<Pick<FlowNode, "x" | "y" | "w" | "h">>, toward: { x: number; y: number }) {
  const dx = toward.x - a.x,
    dy = toward.y - a.y;
  if (Math.abs(dx) * a.h > Math.abs(dy) * a.w) return { x: a.x + Math.sign(dx) * (a.w / 2), y: a.y };
  return { x: a.x, y: a.y + Math.sign(dy) * (a.h / 2) };
}

export function Flow({
  nodes,
  edges,
  width = 720,
  height = 360,
  title,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  width?: number;
  height?: number;
  title: string;
}) {
  const uid = useId().replace(/:/g, "");
  const full = new Map(nodes.map((n) => [n.id, { ...n, w: n.w ?? 132, h: n.h ?? (n.sub ? 52 : 38) }]));
  return (
    <figure className="wk-fig">
      <div className="wk-scroll" tabIndex={0} role="group" aria-label={title} onKeyDown={scrollRegionKeys}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="wk-svg">
        <defs>
          <marker id={`arr-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="wk-arrowhead" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = full.get(e.from)!,
            b = full.get(e.to)!;
          if (!a || !b) return null;
          const p1 = anchor(a, b),
            p2 = anchor(b, a);
          const mx = (p1.x + p2.x) / 2 + (e.bend ?? 0) * (p2.y - p1.y) * -0.3,
            my = (p1.y + p2.y) / 2 + (e.bend ?? 0) * (p2.x - p1.x) * 0.3;
          const d = e.bend ? `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}` : `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
          return (
            <g key={i} className={`wk-edge tone-${e.tone ?? "muted"}`}>
              <path d={d} className={e.dashed ? "wk-edge-line dashed" : "wk-edge-line"} markerEnd={`url(#arr-${uid})`} />
              {e.flow ? <path d={d} className="wk-edge-flow" style={{ animationDelay: `${(i % 5) * -0.4}s` }} /> : null}
              {e.label ? (
                <text x={mx} y={my - 6} className="wk-edge-label" textAnchor="middle">
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {[...full.values()].map((n) => (
          <g key={n.id} className={`wk-node tone-${n.tone ?? "core"}${n.pulse ? " pulse" : ""}`} transform={`translate(${n.x - n.w / 2},${n.y - n.h / 2})`}>
            <rect width={n.w} height={n.h} rx="10" />
            <text x={n.w / 2} y={n.sub ? n.h / 2 - 4 : n.h / 2 + 5} textAnchor="middle" className="wk-node-label">
              {n.label}
            </text>
            {n.sub ? (
              <text x={n.w / 2} y={n.h / 2 + 14} textAnchor="middle" className="wk-node-sub">
                {n.sub}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------ sequence ----

export type SeqMsg = { from: number; to: number; label: string; tone?: Tone; note?: boolean };

export function Sequence({ lanes, msgs, title }: { lanes: string[]; msgs: SeqMsg[]; title: string }) {
  const lw = 150,
    width = Math.max(560, lanes.length * lw),
    gap = width / lanes.length,
    top = 44,
    step = 38,
    height = top + msgs.length * step + 24;
  const cx = (i: number) => gap * i + gap / 2;
  const total = msgs.length * 0.7 + 2;
  return (
    <figure className="wk-fig">
      <div className="wk-scroll" tabIndex={0} role="group" aria-label={title} onKeyDown={scrollRegionKeys}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} className="wk-svg wk-seq">
        {lanes.map((l, i) => (
          <g key={l}>
            <rect x={cx(i) - 66} y={6} width={132} height={28} rx={8} className="wk-lane-head" />
            <text x={cx(i)} y={25} textAnchor="middle" className="wk-node-label">
              {l}
            </text>
            <line x1={cx(i)} x2={cx(i)} y1={34} y2={height - 8} className="wk-lane" />
          </g>
        ))}
        {msgs.map((m, i) => {
          const y = top + i * step + 14;
          const x1 = cx(m.from),
            x2 = cx(m.to);
          const self = m.from === m.to;
          const style = { animationDelay: `${i * 0.7}s`, animationDuration: `${total}s` } as React.CSSProperties;
          return (
            <g key={i} className={`wk-msg tone-${m.tone ?? "core"}`} style={style}>
              {self ? (
                <path d={`M${x1},${y - 6} h34 v14 h-30`} className="wk-msg-line" />
              ) : (
                <line x1={x1} x2={x2 + (x2 > x1 ? -6 : 6)} y1={y} y2={y} className="wk-msg-line" />
              )}
              {!self ? <path d={x2 > x1 ? `M${x2 - 8},${y - 5} L${x2},${y} L${x2 - 8},${y + 5}z` : `M${x2 + 8},${y - 5} L${x2},${y} L${x2 + 8},${y + 5}z`} className="wk-msg-head" /> : null}
              <text x={self ? x1 + 40 : (x1 + x2) / 2} y={y - 6} textAnchor={self ? "start" : "middle"} className="wk-msg-label">
                {i + 1}. {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

// -------------------------------------------------------------- charts ----

export type Series = { label: string; points: [number, number][]; tone?: Tone; dashed?: boolean };

export function LineChart({
  series,
  title,
  xLabel,
  yLabel,
  xTicks,
  yFormat = (v) => v.toLocaleString("en-US"),
  xFormat = (v) => String(v),
  height = 260,
  markers = false,
}: {
  series: Series[];
  title: string;
  xLabel?: string;
  yLabel?: string;
  xTicks?: number[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  height?: number;
  markers?: boolean;
}) {
  const W = 680,
    H = height,
    L = 64,
    R = 16,
    T = 16,
    B = 40;
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  let y0 = Math.min(0, ...ys),
    y1 = Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.06;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const yt = [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + f * (y1 - y0));
  const xt = xTicks ?? [x0, x0 + (x1 - x0) / 4, x0 + (x1 - x0) / 2, x0 + ((x1 - x0) * 3) / 4, x1];
  return (
    <figure className="wk-fig">
      <div className="wk-scroll" tabIndex={0} role="group" aria-label={title} onKeyDown={scrollRegionKeys}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="wk-svg">
        {yt.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} className="wk-grid" />
            <text x={L - 8} y={sy(v) + 4} textAnchor="end" className="wk-axis">
              {yFormat(v)}
            </text>
          </g>
        ))}
        {xt.map((v, i) => (
          <text key={i} x={sx(v)} y={H - B + 18} textAnchor="middle" className="wk-axis">
            {xFormat(v)}
          </text>
        ))}
        {xLabel ? (
          <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="wk-axis-title">
            {xLabel}
          </text>
        ) : null}
        {yLabel ? (
          <text x={12} y={T + 4} className="wk-axis-title">
            {yLabel}
          </text>
        ) : null}
        {series.map((s, i) => {
          const d = s.points.map((p, j) => `${j ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
          return (
            <g key={i} className={`wk-series tone-${s.tone ?? "core"}`}>
              <path d={d} className={s.dashed ? "wk-line dashed" : "wk-line draw"} pathLength={1} />
              {markers ? s.points.map((p, j) => <circle key={j} cx={sx(p[0])} cy={sy(p[1])} r={3.5} className="wk-dot" />) : null}
            </g>
          );
        })}
      </svg>
      </div>
      {series.length > 1 ? (
        <ul className="wk-legend">
          {series.map((s) => (
            <li key={s.label} className={`tone-${s.tone ?? "core"}`}>
              <i className={s.dashed ? "dashed" : ""} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export type Bar = { label: string; value: number; tone?: Tone; note?: string };

export function Bars({ bars, title, format = (v) => v.toLocaleString("en-US"), max }: { bars: Bar[]; title: string; format?: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(...bars.map((b) => b.value), 1);
  return (
    <figure className="wk-fig">
      <div className="wk-bars" role="img" aria-label={title}>
        {bars.map((b, i) => (
          <div key={b.label} className={`wk-bar tone-${b.tone ?? "core"}`}>
            <span className="wk-bar-label">{b.label}</span>
            <span className="wk-bar-track">
              <span className="wk-bar-fill" style={{ width: `${Math.max(1.5, (b.value / top) * 100)}%`, animationDelay: `${i * 0.06}s` }} />
            </span>
            <span className="wk-bar-value">
              {format(b.value)}
              {b.note ? <small> {b.note}</small> : null}
            </span>
          </div>
        ))}
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export type Segment = { label: string; value: number; tone?: Tone };

export function StackBar({ segments, title, unit = "%" }: { segments: Segment[]; title: string; unit?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <figure className="wk-fig">
      <div className="wk-stack" role="img" aria-label={title}>
        {segments.map((s, i) => (
          <span key={s.label} className={`wk-stack-seg tone-${s.tone ?? "core"}`} style={{ flexGrow: s.value, animationDelay: `${i * 0.08}s` }} title={`${s.label}: ${s.value}${unit}`}>
            <b>{s.value}{unit}</b>
          </span>
        ))}
      </div>
      <ul className="wk-legend">
        {segments.map((s) => (
          <li key={s.label} className={`tone-${s.tone ?? "core"}`}>
            <i />
            {s.label} · {Math.round((s.value / total) * 1000) / 10} %
          </li>
        ))}
      </ul>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export function Donut({ segments, title, center }: { segments: Segment[]; title: string; center?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 70,
    c = 2 * Math.PI * r;
  let at = 0;
  return (
    <figure className="wk-fig wk-donut-fig">
      <svg viewBox="0 0 200 200" role="img" aria-label={title} className="wk-svg wk-donut">
        <circle cx="100" cy="100" r={r} className="wk-donut-bg" />
        {segments.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={s.label}
              cx="100"
              cy="100"
              r={r}
              className={`wk-donut-seg tone-${s.tone ?? "core"}`}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-at}
              transform="rotate(-90 100 100)"
            />
          );
          at += len;
          return el;
        })}
        {center ? (
          <text x="100" y="106" textAnchor="middle" className="wk-donut-center">
            {center}
          </text>
        ) : null}
      </svg>
      <ul className="wk-legend">
        {segments.map((s) => (
          <li key={s.label} className={`tone-${s.tone ?? "core"}`}>
            <i />
            {s.label} · {Math.round((s.value / total) * 1000) / 10} %
          </li>
        ))}
      </ul>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

// ------------------------------------------------------------ timeline ----

export type Span = { from: number; to: number; label?: string; tone?: Tone };
export type TimeRow = { label: string; spans: Span[] };

/** Rows of spans on a 0–24 h axis, with a moving "now" needle. */
export function Timeline24({ rows, title, now }: { rows: TimeRow[]; title: string; now?: number }) {
  const W = 680,
    L = 150,
    R = 12,
    rowH = 30,
    T = 8,
    H = T + rows.length * rowH + 30;
  const sx = (h: number) => L + (h / 24) * (W - L - R);
  return (
    <figure className="wk-fig">
      <div className="wk-scroll" tabIndex={0} role="group" aria-label={title} onKeyDown={scrollRegionKeys}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="wk-svg">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <g key={h}>
            <line x1={sx(h)} x2={sx(h)} y1={T} y2={H - 26} className="wk-grid" />
            <text x={sx(h)} y={H - 10} textAnchor="middle" className="wk-axis">
              {String(h).padStart(2, "0")}:00
            </text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.label}>
            <text x={L - 10} y={T + i * rowH + 20} textAnchor="end" className="wk-axis wk-row-label">
              {r.label}
            </text>
            {r.spans.map((s, j) => (
              <g key={j} className={`wk-span tone-${s.tone ?? "core"}`}>
                <rect x={sx(s.from)} y={T + i * rowH + 6} width={Math.max(3, sx(s.to) - sx(s.from))} height={rowH - 10} rx={5} style={{ animationDelay: `${(i + j) * 0.05}s` }} />
                {s.label && sx(s.to) - sx(s.from) > 30 ? (
                  <text x={(sx(s.from) + sx(s.to)) / 2} y={T + i * rowH + 20} textAnchor="middle" className="wk-span-label">
                    {s.label}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
        ))}
        {now != null ? <line x1={sx(now)} x2={sx(now)} y1={T} y2={H - 26} className="wk-now" /> : null}
      </svg>
      </div>
      <figcaption>{title}</figcaption>
    </figure>
  );
}
