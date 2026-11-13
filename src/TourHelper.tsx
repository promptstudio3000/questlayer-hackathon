// Helper Pip (docs/GUIDED-TOUR.md): a small card in the top-right corner of the
// Test Layer map. It says what just happened, the one thing to do next and
// where that is, with an arrow and the distance. The server decides which step
// is done from the game's own records; this card only reads /api/tour.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, CaretDown, X } from "@phosphor-icons/react";
import { api, meters } from "./api";
import { headingTo } from "./map-motion";
import { EXPLORER_BASE } from "./near-network";
import { tr } from "./i18n";
import "./tour-helper.css";

export type TourTarget =
  | { kind: "coin" }
  | { kind: "find" }
  | { kind: "quest"; quest: string }
  | { kind: "actor"; role: string }
  | { kind: "screen"; screen: string }
  | { kind: "action"; action: string };
type TourTx = { kind: string; contract?: string; tx: string | null; state: string; at: number };
export type TourState = {
  enabled: boolean;
  started?: boolean;
  hidden?: boolean;
  finished?: boolean;
  done?: number;
  total?: number;
  current?: { id: string; chapter: string; say: string; hint?: string; next: string; target: TourTarget } | null;
  last?: { id: string; next: string } | null;
  transactions?: { count: number; kinds: number; list: TourTx[] };
};
type Point = { lat: number; lng: number };

// Step copy comes from the server (server/tour/tour.mjs), in English, the game's
// default language: one short sentence per step.
const say = (text: string) => text;

export function Pip({ mood = "talk" }: { mood?: "talk" | "point" | "cheer" }) {
  return (
    <svg className={`pip pip-${mood}`} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="pip-glow" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#fff7c2" />
          <stop offset="0.55" stopColor="#ffd35c" />
          <stop offset="1" stopColor="#ff9d2e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pip-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="1" stopColor="#ffb648" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="30" r="27" fill="url(#pip-glow)" opacity="0.55" />
      {/* a little flame on top, so Pip never looks like an explorer's ghost */}
      <path d="M32 4c4 5 5 8 2 12-1 1.5-3 1.5-4 0-3-4-2-7 2-12z" fill="#ff7a3d" stroke="#3b2a6d" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 34c0-11 8-19 18-19s18 9 18 20v14c-3 0-4 4-6 4s-3-4-6-4-3 4-6 4-3-4-6-4-3 4-6 4-3-4-6-4z" fill="url(#pip-body)" stroke="#3b2a6d" strokeWidth="2.2" strokeLinejoin="round" />
      <ellipse cx="25.5" cy="31" rx="3.2" ry="4" fill="#2a1c55" />
      <ellipse cx="38.5" cy="31" rx="3.2" ry="4" fill="#2a1c55" />
      <circle cx="26.6" cy="29.6" r="1.1" fill="#fff" />
      <circle cx="39.6" cy="29.6" r="1.1" fill="#fff" />
      <path d={mood === "cheer" ? "M26 38c3 4 9 4 12 0" : "M28 38.5c2 1.6 6 1.6 8 0"} fill="none" stroke="#2a1c55" strokeWidth="2" strokeLinecap="round" />
      <circle cx="21" cy="36" r="2.4" fill="#ff9fb8" opacity="0.7" />
      <circle cx="43" cy="36" r="2.4" fill="#ff9fb8" opacity="0.7" />
      {/* the lantern Pip carries */}
      <g className="pip-lantern">
        <path d="M9 38 l0 -6" stroke="#3b2a6d" strokeWidth="2" strokeLinecap="round" />
        <rect x="3.5" y="38" width="11" height="13" rx="3.5" fill="#8fe3ff" stroke="#3b2a6d" strokeWidth="2" />
        <circle cx="9" cy="44.5" r="2.6" fill="#ffffff" />
      </g>
    </svg>
  );
}

// The wisp roll sits in Inventory's "Secured on NEAR" fold: open it and scroll there.
function openRolls(t: TourTarget) {
  if (t.kind !== "screen" || t.screen !== "rolls") return;
  window.setTimeout(() => {
    const rolls = document.querySelector<HTMLElement>(".wisp-rolls");
    const fold = rolls?.closest("details");
    if (fold) fold.open = true;
    rolls?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 600);
}
export default function TourHelper({
  position,
  heading,
  resolve,
  onGo,
  onRunning,
}: {
  position: Point;
  /** Where the explorer faces (demo walk or GPS course), for the arrow. */
  heading?: number;
  /** The map point of a step target in the current world, if there is one. */
  resolve: (target: TourTarget) => (Point & { label?: string }) | null;
  /** Open the target: navigation on the map, a screen or a create dialog. */
  onGo: (target: TourTarget) => void;
  /** Started, not finished, not hidden: the first-steps coach steps aside. */
  onRunning?: (running: boolean) => void;
}) {
  const [state, setState] = useState<TourState | null>(null);
  const [folded, setFolded] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastDone = useRef<number | null>(null);
  const [fresh, setFresh] = useState(false);
  const load = useCallback(async () => {
    try {
      const s = await api<TourState>("/tour");
      setState(s);
      if (lastDone.current !== null && (s.done ?? 0) > lastDone.current) {
        setFresh(true);
        setFolded(false);
      }
      lastDone.current = s.done ?? 0;
    } catch {
      /* offline or signed out: keep the last card */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(false), 6000);
    return () => window.clearTimeout(t);
  }, [fresh]);
  async function act(action: string, step?: string) {
    setBusy(true);
    try {
      setState(await api<TourState>("/tour", { action, step }));
    } catch {
      /* the next poll shows the real state */
    } finally {
      setBusy(false);
    }
  }
  const running = !!state?.enabled && !!state.started && !state.finished && !state.hidden;
  useEffect(() => onRunning?.(running), [running, onRunning]);
  if (!state?.enabled || state.hidden === true) return null;

  if (!state.started)
    return (
      <aside className="tour-helper" aria-label={tr("Tour")}>
        <Pip />
        <div className="tour-body">
          <p className="tour-line">{tr("Hi, I'm Pip. Want the tour?")}</p>
          <p className="tour-sub">{tr("Every quest, encounter and trade, step by step.")}</p>
          <div className="tour-buttons">
            <button type="button" className="tour-go" disabled={busy} onClick={() => void act("start")}>{tr("Start the tour")}</button>
          </div>
        </div>
      </aside>
    );

  if (state.finished)
    return (
      <aside className={`tour-helper tour-finished${folded ? " is-folded" : ""}`} aria-label={tr("Tour")}>
        <button type="button" className="tour-avatar" onClick={() => setFolded(!folded)} aria-label={folded ? tr("Open the tour") : tr("Fold the tour")}><Pip mood="cheer" /></button>
        {!folded && (
          <div className="tour-body">
            <p className="tour-line">{tr("Tour done: {0} transactions on NEAR.", { 0: state.transactions?.count ?? 0 })}</p>
            <ul className="tour-txs">
              {(state.transactions?.list || []).map((t, i) => (
                <li key={i}>
                  <span>{t.kind}</span>
                  {t.tx ? <a href={`${EXPLORER_BASE}/txns/${t.tx}`} target="_blank" rel="noreferrer">{t.tx.slice(0, 8)}…</a> : <small>{tr("confirming")}</small>}
                </li>
              ))}
            </ul>
            <div className="tour-buttons">
              <button type="button" className="tour-quiet" onClick={() => void act("hide")}>{tr("Close")}</button>
              <button type="button" className="tour-quiet" onClick={() => void act("restart")}>{tr("Again")}</button>
            </div>
          </div>
        )}
      </aside>
    );

  const step = state.current!;
  const spot = resolve(step.target);
  const distance = spot ? Math.round(meters(position, spot)) : null;
  const bearing = spot ? headingTo(position, spot) : null;
  const turn = bearing === null || bearing === undefined ? null : bearing - (heading ?? 0);
  return (
    <aside className={`tour-helper${folded ? " is-folded" : ""}${fresh ? " is-fresh" : ""}`} aria-label={tr("Tour")} aria-live="polite">
      <button type="button" className="tour-avatar" onClick={() => setFolded(!folded)} aria-label={folded ? tr("Open the tour") : tr("Fold the tour")}>
        <Pip mood={fresh ? "cheer" : spot ? "point" : "talk"} />
        <span className="tour-count">{state.done}/{state.total}</span>
      </button>
      {!folded && (
        <div className="tour-body">
          {fresh && state.last && <p className="tour-sub tour-happened">{say(state.last.next)}</p>}
          <p className="tour-line">{say(step.say)}</p>
          {step.hint && <p className="tour-sub">{say(step.hint)}</p>}
          {spot && distance !== null && distance > 15 && (
            <p className="tour-where">
              <ArrowUp size={16} weight="bold" style={{ transform: `rotate(${turn ?? 0}deg)` }} aria-hidden="true" />
              <span>{tr("{0} m", { 0: distance })}{spot.label ? ` · ${spot.label}` : ""}</span>
            </p>
          )}
          <div className="tour-buttons">
            <button type="button" className="tour-go" onClick={() => { onGo(step.target); openRolls(step.target); void load(); }}>{tr("Show me")}</button>
            <button type="button" className="tour-quiet" disabled={busy} onClick={() => void act("skip", step.id)}>{tr("Skip")}</button>
          </div>
        </div>
      )}
      {!folded && (
        <button type="button" className="tour-fold" onClick={() => setFolded(true)} aria-label={tr("Fold the tour")}>
          <CaretDown size={16} aria-hidden="true" />
        </button>
      )}
      {folded && (
        <button type="button" className="tour-close" onClick={() => void act("hide")} aria-label={tr("Close")}>
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
