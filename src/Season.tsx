import { useCallback, useEffect, useState } from "react";
import {
  Trophy,
} from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { api, remaining } from "./api";
import { Dialog } from "./Dialog";
import { goldCompact } from "./reward-funding";
import "./season.css";
import { tr } from "./i18n";

// Season (docs/SEASON.md): a cosmetic leaderboard of hunts, zone
// visits and NPC lines, a season mark and Aura at the goal, and a meter of the
// reward pot that funded the season's days. Ranks never change rewards or odds.
type Row = {
  place: number;
  name: string;
  points: number;
  hunts: number;
  visits: number;
  lines: number;
  title: string;
  rank: number;
  you: boolean;
};
type Me = Omit<Row, "place" | "name" | "you"> & {
  place: number | null;
  goal: number;
  reached: boolean;
  claimed: boolean;
  aura: { edition: string; itemId: string } | null;
};
type Pot = {
  total: string;
  fromYield: string;
  fromSponsors: string;
  publishedDays: number;
  traderSweeps: string;
  target: string;
  fillBps: number;
};
type Season = {
  enabled: boolean;
  name?: string;
  phase?: "upcoming" | "live" | "ended";
  startsAt?: number;
  endsAt?: number;
  goal?: number;
  points?: { hunt: number; visit: number; line: number };
  players?: number;
  finishers?: number;
  leaderboard?: Row[];
  me?: Me | null;
  aura?: { id: string; name: string } | null;
  pot?: Pot;
};

const gold = (v: string) => `${goldCompact(v)} QGOLD`;

export function SeasonCard({ signedIn, refreshKey, onClaimed }: { signedIn: boolean; refreshKey?: string | number; onClaimed?: () => void }) {
  const [season, setSeason] = useState<Season | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setSeason(await api<Season>("/season", undefined, { signal }));
    } catch {
      /* Optional card: keep what we had. */
    }
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, refreshKey, signedIn]);
  if (!season?.enabled || !season.endsAt || !season.goal) return null;
  const me = season.me;
  const pct = me ? Math.min(100, (me.points / season.goal) * 100) : 0;
  const when =
    season.phase === "ended"
      ? tr("Final standings")
      : season.phase === "upcoming"
        ? tr("Starts in {0}", { 0: remaining(season.startsAt || 0) })
        : tr("Ends in {0}", { 0: remaining(season.endsAt) });
  const claim = async () => {
    setBusy(true);
    setError("");
    try {
      setSeason(await api<Season>("/season/claim", {}));
      onClaimed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Could not claim the season mark."));
    } finally {
      setBusy(false);
    }
  };
  const p = season.points || { hunt: 1, visit: 2, line: 3 };
  return (
    <>
      <button
        type="button"
        className={`season-card${me?.reached && !me.claimed ? " is-ready" : ""}`}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <span className="season-card-art" aria-hidden="true">
          <Trophy size={28} weight="duotone" />
        </span>
        <span className="season-card-body">
          <span className="season-card-title">
            <strong>{tr("Season")}</strong>
            <span className="season-chip">{when}</span>
          </span>
          <span className="season-card-line">
            {me
              ? `${tr("{0}/{1} points", { 0: me.points, 1: season.goal })}${me.place ? ` · #${me.place}` : ""}${me.claimed ? tr(" · goal reached") : ""}`
              : tr("{0} explorers on the board", { 0: season.players || 0 })}
            {season.pot ? tr(" · pot {0}", { 0: gold(season.pot.total) }) : ""}
          </span>
        </span>
        <ArrowRight size={20} aria-hidden="true" className="season-card-go" />
      </button>
      {open && (
        <Dialog label={tr("Season")} onClose={() => setOpen(false)}>
          <section className="season-sheet">
            <h2>{tr("Season")}</h2>
            <p className="season-lead">
              {tr("Until")}{" "}{new Date(season.endsAt).toUTCString().replace(":59 GMT", " UTC").replace(/:\d\d UTC$/, " UTC")}{tr(". Points for hunts (")}{p.hunt}{tr("), zone visits (")}{p.visit}{tr(") and NPC lines (")}{p.line}{tr("). Never QGOLD, NEAR or stake. Ranks are cosmetic titles; they change no reward, odds or damage.")}</p>
            {me && (
              <div className="season-me">
                <div className="season-me-head">
                  <b>{me.title}</b>
                  <span>
                    {me.points}/{season.goal}
                  </span>
                </div>
                <span className="season-bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <small>
                  {me.hunts} {" "}{tr("hunts ·")}{" "}{me.visits} {" "}{tr("visits ·")}{" "}{me.lines} {" "}{tr("NPC lines")}</small>
                {me.claimed ? (
                  <p className="season-done">
                    {tr("Season mark earned.")}{" "}
                    {me.aura ? tr("The season Aura is in your wardrobe.") : season.aura ? "" : tr("The season Aura arrives with the next collectibles update.")}
                  </p>
                ) : (
                  <button
                    className="primary-button"
                    disabled={!me.reached || busy || season.phase !== "live"}
                    onClick={() => void claim()}
                  >
                    {me.reached ? tr("Claim the season mark") : tr("{0} points to the season mark", { 0: season.goal - me.points })}
                  </button>
                )}
                {me.claimed && season.aura && !me.aura && (
                  <button className="secondary-button" disabled={busy} onClick={() => void claim()}>
                    {tr("Collect the")}{" "}{season.aura.name}
                  </button>
                )}
                {error && <p className="season-error">{error}</p>}
              </div>
            )}
            <h3>{tr("Leaderboard")}</h3>
            {season.leaderboard?.length ? (
              <ol className="season-board">
                {season.leaderboard.map((r) => (
                  <li key={`${r.place}-${r.name}`} className={r.you ? "you" : ""} data-rank={r.rank}>
                    <span className="season-place">{r.place}</span>
                    <span className="season-name">
                      <b>{r.name}</b>
                      <small>{r.title}</small>
                    </span>
                    <span className="season-points">{r.points}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="fine-print">{tr("Nobody has scored yet. Beat a monster, visit a zone or finish an NPC line.")}</p>
            )}
            {season.pot && (
              <div className="season-pot">
                <div className="season-me-head">
                  <b>{tr("Season pot")}</b>
                  <span>{gold(season.pot.total)}</span>
                </div>
                <span
                  className="season-bar is-pot"
                  role="meter"
                  aria-label={tr("Season pot")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(season.pot.fillBps / 100)}
                >
                  <span style={{ width: `${season.pot.fillBps / 100}%` }} />
                </span>
                <small>
                  {season.pot.publishedDays} {" "}{tr("reward days published on NEAR:")}{" "}{gold(season.pot.fromYield)} {" "}{tr("from staking yield,")}{" "}
                  {gold(season.pot.fromSponsors)} {" "}{tr("from sponsors. Trader margins swept to the treasury:")}{" "}
                  {gold(season.pot.traderSweeps)} {" "}{tr("(paid out through later days).")}</small>
              </div>
            )}
            <p className="fine-print">
              {season.finishers ? tr("{0} explorers reached the goal. ", { 0: season.finishers }) : ""}
              {when}.
            </p>
            <button className="secondary-button" onClick={() => setOpen(false)}>
              {tr("Close")}</button>
          </section>
        </Dialog>
      )}
    </>
  );
}
