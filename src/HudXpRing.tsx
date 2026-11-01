// Topbar avatar with an XP ring (share of the current level) and a compact
// "Lv 2 · 300/400 XP" readout in the same total-XP terms as the HUD XpBar.
// It only draws progress it is given; the level table and thresholds come
// from the caller (levelProgress in src/levels.ts), never from here.
import type { ReactNode } from "react";
import "./hud.css";

export type HudXpRingProps = {
  level: number;
  xp: number;
  levelStartXp: number;
  nextLevelXp: number;
  /** Ring unlock from the level table ("silver" from L5, "gold" from L10); purple otherwise. */
  ring?: string | null;
  children?: ReactNode;
};

const RADIUS = 21;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Share of the current level already earned, clamped to 0..1. */
export function levelFraction({ xp, levelStartXp, nextLevelXp }: Pick<HudXpRingProps, "xp" | "levelStartXp" | "nextLevelXp">) {
  const span = nextLevelXp - levelStartXp;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(1, Math.max(0, (xp - levelStartXp) / span));
}

export function HudXpRing({ level, xp, levelStartXp, nextLevelXp, ring = null, children }: HudXpRingProps) {
  const fraction = levelFraction({ xp, levelStartXp, nextLevelXp });
  return (
    <span className={`hud-xp${ring === "silver" || ring === "gold" ? ` ring-${ring}` : ""}`}>
      <span className="hud-xp-ring">
        <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <circle className="hud-xp-track" cx="24" cy="24" r={RADIUS} />
          <circle
            className="hud-xp-fill"
            cx="24"
            cy="24"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
        <span className="hud-xp-avatar">{children}</span>
        <span className="hud-xp-level" aria-hidden="true">
          {level}
        </span>
      </span>
      <span className="hud-xp-text">
        <b>Lv {level}</b>
        <small>
          {xp.toLocaleString("en-US")}/{nextLevelXp.toLocaleString("en-US")} XP
        </small>
      </span>
    </span>
  );
}

/** Spoken summary for the control that hosts the ring. */
export function levelSummary({ level, xp, nextLevelXp }: Pick<HudXpRingProps, "level" | "xp" | "nextLevelXp">) {
  return `Level ${level}, ${xp} of ${nextLevelXp} XP for level ${level + 1}`;
}
