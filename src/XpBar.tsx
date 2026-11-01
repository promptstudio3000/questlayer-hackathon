// XP bar and level path to L10 (docs/GAME-LOOPS.md P0-1). Layout-free: the
// caller places it (HUD bottom card today; the topbar avatar ring is separate).
import { useEffect, useState } from "react";
import { Check, Lock, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import {
  DEFAULT_LEVEL_TABLE,
  levelProgress,
  loadLevelTable,
  type LevelTable,
} from "./levels";
import "./xp-bar.css";

export function useLevelTable() {
  const [table, setTable] = useState<LevelTable>(DEFAULT_LEVEL_TABLE);
  useEffect(() => {
    let live = true;
    loadLevelTable().then((t) => live && setTable(t));
    return () => {
      live = false;
    };
  }, []);
  return table;
}

export function XpBar({
  xp,
  note,
  placeholder,
}: {
  xp: number | string | null;
  /** Extra text after the XP numbers, e.g. committed creator XP. */
  note?: string;
  /** Shown instead of numbers while XP is unknown. */
  placeholder: string;
}) {
  const table = useLevelTable();
  const [open, setOpen] = useState(false);
  if (xp === null)
    return (
      <>
        <div className="xp-bar">
          <i style={{ width: "0%" }} />
        </div>
        <small>{placeholder}</small>
      </>
    );
  const p = levelProgress(xp, table);
  return (
    <>
      <div
        className="xp-bar"
        role="progressbar"
        aria-label={`Level ${p.level} progress`}
        aria-valuemin={p.levelStartXp}
        aria-valuemax={p.nextLevelXp}
        aria-valuenow={p.xp}
      >
        <i style={{ width: `${p.percent}%` }} />
      </div>
      <button
        type="button"
        className="xp-bar-line"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <small>
          {p.title ? `${p.title} · ` : ""}Level {p.level} ·{" "}
          {p.xp.toLocaleString("en-US")} / {p.nextLevelXp.toLocaleString("en-US")} XP
          {note ? ` · ${note}` : ""}
        </small>
        <small className="xp-bar-next">
          {p.next
            ? `Next at L${p.next.level}: ${p.next.unlock.title}`
            : "Level path complete"}
        </small>
      </button>
      {open && (
        <LevelPath table={table} level={p.level} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export function LevelPath({
  table,
  level,
  onClose,
}: {
  table: LevelTable;
  level: number;
  onClose: () => void;
}) {
  return (
    <Dialog label="Level path" onClose={onClose}>
      <div className="level-path">
        <div className="panel-heading">
          <h2>Level path</h2>
          <button className="icon-button" aria-label="Close level path" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p>Every level opens something new to do or wear. Levels never change odds or payouts.</p>
        <ol>
          {table.levels.map((e) => {
            const reached = level >= e.level;
            return (
              <li
                key={e.level}
                className={reached ? "reached" : e.level === level + 1 ? "next" : ""}
              >
                <span className="level-path-badge">{e.level}</span>
                <span>
                  <b>{e.unlock.title}</b>
                  {e.item && <small>Level item: {e.item.name}</small>}
                  <small>
                    {e.requiredXp.toLocaleString("en-US")} XP
                    {e.unlock.status === "coming" ? " · coming soon" : ""}
                  </small>
                </span>
                {reached ? <Check size={18} aria-label="Unlocked" /> : <Lock size={18} aria-label="Locked" />}
              </li>
            );
          })}
        </ol>
      </div>
    </Dialog>
  );
}
