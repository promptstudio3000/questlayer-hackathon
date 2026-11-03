import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Circle, Target } from "@phosphor-icons/react";
import { api, remaining } from "./api";
import { Dialog } from "./Dialog";
import "./daily-board.css";

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
}: {
  worldId?: string;
  refreshKey?: string | number;
  onClaimed?: () => void;
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
      setError(e instanceof Error ? e.message : "Could not claim the bonus.");
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
        <span className="daily-board-sr">Today's board: </span>
        <b>
          {board.done}/{board.total}
        </b>
        <span className="daily-board-sr"> goals done</span>
      </button>
      {open && (
        <Dialog label="Today's board" onClose={() => setOpen(false)}>
          <section className="daily-board-sheet">
            <h2>Today's board</h2>
            <p className="daily-board-lead">
              Three small goals from today's map. Finish them all for +{board.bonusXp} XP. No streak: skip a day and
              you lose nothing.
            </p>
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
                </li>
              ))}
            </ul>
            {board.claimed ? (
              <p className="daily-board-done">Done for today. +{board.bonusXp} XP is yours.</p>
            ) : (
              <button className="primary-button" disabled={!board.complete || busy} onClick={() => void claim()}>
                {board.complete ? `Claim +${board.bonusXp} XP` : `${board.done} of ${board.total} done`}
              </button>
            )}
            {error && <p className="daily-board-error">{error}</p>}
            <p className="fine-print">
              {board.finishedToday ? `${board.finishedToday} explorers finished today's board. ` : ""}
              {board.resetsAt ? `New board in ${remaining(board.resetsAt)}.` : ""}
            </p>
            <button className="secondary-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </section>
        </Dialog>
      )}
    </>
  );
}
