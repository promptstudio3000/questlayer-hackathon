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
import { tr } from "./i18n";

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
  if (Math.abs(r) <= 20) return tr("ahead");
  if (Math.abs(r) >= 150) return tr("behind you");
  return r > 0 ? tr("to your right") : tr("to your left");
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
        aria-label={tr("Demo controls")}
        title={tr("Demo controls (arrows or WASD)")}
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
      aria-label={tr("Demo controls")}
      data-running={running || undefined}
      data-target={target ? "" : undefined}
    >
      <div className="demo-pad-grid">
        <button className="demo-left" aria-label={tr("Turn left")} title={tr("Turn left (← / A)")} {...hold("left")}>
          <ArrowArcLeft size={22} weight="bold" />
        </button>
        <button className="demo-forward" aria-label={tr("Walk forward")} title={tr("Forward (↑ / W)")} {...hold("forward")}>
          <ArrowFatUp size={22} weight="fill" />
        </button>
        <button className="demo-back" aria-label={tr("Step back")} title={tr("Back (↓ / S)")} {...hold("back")}>
          <ArrowFatDown size={22} weight="fill" />
        </button>
        <button className="demo-right" aria-label={tr("Turn right")} title={tr("Turn right (→ / D)")} {...hold("right")}>
          <ArrowArcRight size={22} weight="bold" />
        </button>
        <button
          className="demo-run"
          aria-label={tr("Run")}
          aria-pressed={run}
          title={tr("Run on or off (Shift walks)")}
          onClick={() => setRun(!run)}
        >
          <PersonSimpleRun size={22} weight={running ? "fill" : "regular"} />
        </button>
      </div>
      <button className="demo-pad-min" aria-label={tr("Hide demo controls")} title={tr("Hide demo controls")} onClick={() => setOpen(false)}>
        <Minus size={18} weight="bold" />
      </button>
      <p className="demo-pad-hint sr-only">
        {target
          ? `${target.label} · ${target.meters < 1000 ? `${Math.round(target.meters)} m` : `${(target.meters / 1000).toFixed(1)} km`} ${direction(target.relative)}`
          : tr("Arrows or WASD · Shift walks")}
      </p>
    </section>
  );
}
