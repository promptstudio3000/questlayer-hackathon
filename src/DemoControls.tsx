import { useEffect, useState, type PointerEvent } from "react";
import {
  ArrowArcLeft,
  ArrowArcRight,
  ArrowFatDown,
  ArrowFatUp,
  GameController,
  Minus,
  PersonSimpleRun,
} from "@phosphor-icons/react";
import type { DemoControl } from "./useDemoWalk";
import "./demo-controls.css";

const STORE = "questlayer.demoPad.open";
function storedOpen() {
  try {
    return localStorage.getItem(STORE) !== "0";
  } catch {
    return true;
  }
}

function direction(relative: number) {
  const r = ((relative + 540) % 360) - 180;
  if (Math.abs(r) <= 20) return "ahead";
  if (Math.abs(r) >= 150) return "behind you";
  return r > 0 ? "to your right" : "to your left";
}

/**
 * City demo pad: hold to walk the way the explorer faces, turn with the side
 * arrows. Only the demo shows it; real play moves with the device GPS.
 */
export function DemoControls({
  held,
  running,
  run,
  setRun,
  press,
  release,
  target,
}: {
  held: Set<DemoControl>;
  running: boolean;
  run: boolean;
  setRun: (run: boolean) => void;
  press: (control: DemoControl, down: boolean) => void;
  release: () => void;
  /** Distance to the place the explorer was last turned toward. */
  target?: { label: string; meters: number; relative: number } | null;
}) {
  const [open, setOpen] = useState(storedOpen);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, open ? "1" : "0");
    } catch {
      /* private mode: the pad just opens again next time */
    }
    if (!open) release();
  }, [open, release]);
  if (!open)
    return (
      <button
        className="demo-pad-open"
        aria-label="Demo controls"
        title="Demo controls (arrows or WASD)"
        onClick={() => setOpen(true)}
      >
        <GameController size={22} weight="fill" />
      </button>
    );
  const hold = (control: DemoControl) => ({
    "aria-pressed": held.has(control),
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      press(control, true);
    },
    onPointerUp: () => press(control, false),
    onPointerCancel: () => press(control, false),
    onLostPointerCapture: () => press(control, false),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    // Keyboard and switch users: Enter / Space takes one step or turn.
    onClick: (e: { detail: number }) => {
      if (e.detail !== 0) return;
      press(control, true);
      setTimeout(() => press(control, false), 120);
    },
  });
  return (
    <section
      className="demo-pad"
      aria-label="Demo controls"
      data-running={running || undefined}
    >
      <header>
        <span>
          <GameController size={14} weight="fill" /> Demo walk
        </span>
        <button
          className="demo-pad-min"
          aria-label="Hide demo controls"
          title="Hide demo controls"
          onClick={() => setOpen(false)}
        >
          <Minus size={14} weight="bold" />
        </button>
      </header>
      <div className="demo-pad-grid">
        <button className="demo-forward" aria-label="Walk forward" title="Forward (↑ / W)" {...hold("forward")}>
          <ArrowFatUp size={22} weight="fill" />
        </button>
        <button className="demo-left" aria-label="Turn left" title="Turn left (← / A)" {...hold("left")}>
          <ArrowArcLeft size={22} weight="bold" />
        </button>
        <button
          className="demo-run"
          aria-label="Run"
          aria-pressed={run}
          title="Run (hold Shift)"
          onClick={() => setRun(!run)}
        >
          <PersonSimpleRun size={22} weight={running ? "fill" : "regular"} />
        </button>
        <button className="demo-right" aria-label="Turn right" title="Turn right (→ / D)" {...hold("right")}>
          <ArrowArcRight size={22} weight="bold" />
        </button>
        <button className="demo-back" aria-label="Step back" title="Back (↓ / S)" {...hold("back")}>
          <ArrowFatDown size={22} weight="fill" />
        </button>
      </div>
      <p className="demo-pad-hint">
        {target
          ? `${target.label} · ${target.meters < 1000 ? `${Math.round(target.meters)} m` : `${(target.meters / 1000).toFixed(1)} km`} ${direction(target.relative)}`
          : "Arrows or WASD · Shift runs"}
      </p>
    </section>
  );
}
