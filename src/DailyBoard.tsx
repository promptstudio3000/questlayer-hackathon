import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Circle, MapPin, Target, X } from "@phosphor-icons/react";
import { api, remaining } from "./api";
import { Dialog } from "./Dialog";
import "./daily-board.css";
import { tr } from "./i18n";

// Today's board (docs/DAILY-BOARD.md): three small goals from today's world and
// a small XP bonus. No streak and nothing to lose by skipping a day.
type Goal = { kind: string; target: number; progress: number; done: boolean; label: string };
type Board = {
  enabled: boolean;
  dayId?: string;
  resetsAt?: number;
  goals?: Goal[];
  done?: number;
  total?: number;
  complete?: boolean;
  bonusXp?: number;
  claimed?: boolean;
  finishedToday?: number;
};

export function DailyBoard({
  worldId,
  refreshKey,
  onClaimed,
  onGoal,
}: {
  worldId?: string;
  refreshKey?: string | number;
  onClaimed?: () => void;
  /** "Show me": point the map at the nearest thing this goal needs. */
  onGoal?: (kind: string) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!worldId) return;
      try {
        setBoard(await api<Board>(`/daily-board?worldId=${encodeURIComponent(worldId)}`, undefined, { signal }));
      } catch {
        /* The chip just stays as it was; the board is optional. */
      }
    },
    [worldId],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [load, refreshKey]);
  if (!worldId || !board?.enabled || !board.goals?.length) return null;
  const claim = async () => {
    setBusy(true);
    setError("");
    try {
      setBoard(await api<Board>("/daily-board/claim", { worldId }));
      onClaimed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("Could not claim the bonus."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className={`daily-board-chip${board.complete ? " is-complete" : ""}${board.complete && !board.claimed ? " is-ready" : ""}`}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Target size={18} weight={board.complete ? "fill" : "regular"} aria-hidden="true" />
        {/* Visible text stays part of the accessible name (label-content-name-mismatch). */}
        <span className="daily-board-sr">{tr("Today's board:")}{" "}</span>
        <b>
          {board.done}/{board.total}
        </b>
        <span className="daily-board-sr"> {" "}{tr("goals done")}</span>
      </button>
      {open && (
        <Dialog label={tr("Today's board")} onClose={() => setOpen(false)}>
          <section className="daily-board-sheet">
            <button className="sheet-close" aria-label={tr("Close")} onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
            <h2>{tr("Today's board")}</h2>
            <p className="daily-board-lead">
              {tr("All 3 goals: +{0} XP · no streaks", { 0: board.bonusXp })}</p>
            <ul>
              {board.goals.map((g) => (
                <li key={g.kind} className={g.done ? "done" : ""}>
                  {g.done ? (
                    <CheckCircle size={22} weight="fill" aria-hidden="true" />
                  ) : (
                    <Circle size={22} aria-hidden="true" />
                  )}
                  <span>
                    <b>{g.label}</b>
                    <span className="daily-board-bar" aria-hidden="true">
                      <span style={{ width: `${(g.progress / g.target) * 100}%` }} />
                    </span>
                  </span>
                  <small>
                    {g.progress}/{g.target}
                  </small>
                  {!g.done && onGoal && (
                    <button
                      className="daily-board-go secondary-button"
                      aria-label={`${tr("Show me")} · ${g.label}`}
                      onClick={() => {
                        setOpen(false);
                        onGoal(g.kind);
                      }}
                    >
                      <MapPin size={18} aria-hidden="true" />
                      <span>{tr("Show me")}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {board.claimed ? (
              <p className="daily-board-done">{tr("Done for today. +")}{board.bonusXp} {" "}{tr("XP is yours.")}</p>
            ) : board.complete ? (
              <button className="primary-button" disabled={busy} onClick={() => void claim()}>
                {tr("Claim +{0} XP", { 0: board.bonusXp })}
              </button>
            ) : null}
            {error && <p className="daily-board-error">{error}</p>}
            <p className="fine-print">
              {board.finishedToday ? tr("{0} explorers finished today's board. ", { 0: board.finishedToday }) : ""}
              {board.resetsAt ? tr("New board in {0}.", { 0: remaining(board.resetsAt) }) : ""}
            </p>
          </section>
        </Dialog>
      )}
    </>
  );
}
