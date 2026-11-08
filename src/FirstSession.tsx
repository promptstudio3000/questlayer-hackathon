import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "@phosphor-icons/react";
import { ArrowRight } from "./dir-icons";
import { cue } from "./feedback";
import {
  firstSessionProgress,
  newlyCompleted,
  readMarks,
  writeMarks,
  type FirstSessionMarks,
  type FirstSessionPlayer,
  type FirstSessionProgress,
  type FirstStepId,
} from "./first-session";
import "./first-session.css";
import { tr } from "./i18n";

/** Tracks first-session progress and local marks for one player. */
export function useFirstSession(player: FirstSessionPlayer | null) {
  const playerId = player?.id || "";
  const [marks, setMarks] = useState<FirstSessionMarks>(() =>
    playerId ? readMarks(playerId) : {},
  );
  const [celebration, setCelebration] = useState("");
  useEffect(() => {
    setMarks(playerId ? readMarks(playerId) : {});
    previous.current = null;
  }, [playerId]);
  const progress = firstSessionProgress(player, marks);
  const previous = useRef<FirstSessionProgress | null>(null);
  const signature = progress.steps.map((s) => (s.done ? 1 : 0)).join("");
  useEffect(() => {
    if (!playerId) return;
    const fresh = newlyCompleted(previous.current, progress);
    previous.current = progress;
    // Remember proven steps so a long coin history cannot un-tick them.
    const proven = progress.steps.filter((s) => s.done && !marks[s.step.id]);
    if (proven.length) {
      const next = { ...marks };
      for (const s of proven) next[s.step.id] = true;
      writeMarks(playerId, next);
      setMarks(next);
    }
    if (!fresh.length) return;
    const last = fresh[fresh.length - 1];
    setCelebration(last.done);
    cue(progress.current ? "step" : "reward");
    const t = setTimeout(() => setCelebration(""), 4000);
    return () => clearTimeout(t);
    // signature captures every change that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, signature]);
  function update(next: FirstSessionMarks) {
    if (!playerId) return;
    const merged = { ...marks, ...next };
    writeMarks(playerId, merged);
    setMarks(merged);
  }
  return {
    progress,
    marks,
    celebration,
    mark: (step: FirstStepId) => update({ [step]: true }),
    hide: () => update({ hidden: true }),
    show: () => {
      const { hidden: _hidden, finished: _finished, ...rest } = marks;
      if (!playerId) return;
      writeMarks(playerId, rest);
      setMarks(rest);
    },
    finish: () => update({ finished: true }),
    visible: !!player && !marks.hidden && !marks.finished,
  };
}

export function FirstSessionCoach({
  session,
  hint,
  busy,
  onAction,
  actionLabel,
  actionDisabled,
  aside,
}: {
  session: ReturnType<typeof useFirstSession>;
  hint?: string;
  busy: boolean;
  onAction: (step: FirstStepId) => void;
  /** Override for the current step's button, e.g. when nothing is open. */
  actionLabel?: string | null;
  actionDisabled?: boolean;
  /** Extra line under the action, e.g. the nearest POI quest outside Plzeň. */
  aside?: ReactNode;
}) {
  const { progress, celebration } = session;
  const current = progress.current;
  if (!session.visible) return null;
  const index = current
    ? progress.steps.findIndex((s) => s.step.id === current.id)
    : progress.total;
  return (
    <section
      className={`first-session${current ? "" : " first-session-done"}`}
      aria-labelledby="first-session-title"
    >
      <div className="first-session-head">
        <span className="first-session-count">
          {tr("First steps · {0} of {1}", { 0: progress.completed, 1: progress.total })}
        </span>
        <ol className="first-session-dots" aria-hidden="true">
          {progress.steps.map((s, i) => (
            <li
              key={s.step.id}
              className={
                s.done ? "done" : i === index ? "current" : undefined
              }
            />
          ))}
        </ol>
        {current && (
          <button
            className="first-session-hide"
            onClick={session.hide}
            aria-label={tr("Hide first steps")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {current ? (
        <>
          <h2 id="first-session-title">{current.title}</h2>
          {hint && <p className="first-session-hint learning-hint">{hint}</p>}
          <button
            className="primary-button first-session-action"
            disabled={busy || actionDisabled}
            onClick={() => onAction(current.id)}
          >
            {actionLabel || current.action}
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          {aside}
        </>
      ) : (
        <>
          <h2 id="first-session-title">
            <Check size={20} weight="bold" aria-hidden="true" /> {" "}{tr("You know the loop")}</h2>
          <p className="first-session-hint">
            <span>
              {tr("Walk, pick up coins, open chests, wear what you find. New discoveries open every day.")}</span>
          </p>
          <button
            className="secondary-button first-session-action"
            onClick={session.finish}
          >
            {tr("Keep exploring")}</button>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {celebration}
      </p>
      {celebration && (
        <p className="first-session-celebration" aria-hidden="true">
          <Check size={16} weight="bold" /> {celebration}
        </p>
      )}
    </section>
  );
}
