import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
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
 * City demo joystick: drag the inner knob up to walk the way the explorer
 * faces, sideways to turn, down to step back. Only the demo shows it; real
 * play moves with the device GPS.
 */
export function DemoControls({
  held,
  running,
  run,
  setRun,
  press,
  release,
  steer,
  target,
}: {
  held: Set<DemoControl>;
  running: boolean;
  run: boolean;
  setRun: (run: boolean) => void;
  press: (control: DemoControl, down: boolean, source?: string) => void;
  release: () => void;
  /** Joystick vector (x right, y forward, each -1..1); null releases it. */
  steer: (vector: { x: number; y: number } | null) => void;
  /** Distance to the place the explorer was last turned toward. */
  target?: { label: string; meters: number; relative: number } | null;
}) {
  const [open, setOpen] = useState(storedOpen);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const focusOnToggle = useRef(false);
  const toggle = (next: boolean) => { focusOnToggle.current = true; setOpen(next); };
  useEffect(() => {
    if (!focusOnToggle.current) return;
    focusOnToggle.current = false;
    (open ? panel.current?.querySelector<HTMLButtonElement>(".demo-forward") : opener.current)?.focus();
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, open ? "1" : "0");
    } catch {
      /* private mode: the pad just opens again next time */
    }
    if (!open) release();
  }, [open, release]);
  const hint = target
    ? `${target.label} · ${target.meters < 1000 ? `${Math.round(target.meters)} m` : `${(target.meters / 1000).toFixed(1)} km`} ${direction(target.relative)}`
    : tr("Drag the stick, or use arrows or WASD");
  if (!open)
    return (
      <>
      <button
        ref={opener}
        className="demo-pad-open"
        aria-label={tr("Demo controls")}
        title={tr("Demo controls (arrows or WASD)")}
        aria-expanded={false}
        onClick={() => toggle(true)}
      >
        <GameController size={22} weight="fill" />
      </button>
      <p className="demo-pad-hint sr-only">{hint}</p>
      </>
    );
  // Keyboard and switch users: the four arrows inside the ring are buttons;
  // Enter / Space takes one step or turn. Pointers drag the stick instead.
  const step = (control: DemoControl) => ({
    "aria-pressed": held.has(control) || stickHolds(knob, control),
    tabIndex: 0,
    onClick: (e: { detail: number }) => {
      if (e.detail !== 0) return;
      press(control, true);
      setTimeout(() => press(control, false), 120);
    },
  });
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = base.current?.getBoundingClientRect();
    if (!box) return;
    const radius = box.width / 2 - 20;
    let dx = e.clientX - (box.left + box.width / 2),
      dy = e.clientY - (box.top + box.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > radius) {
      dx = (dx / length) * radius;
      dy = (dy / length) * radius;
    }
    const x = dx / radius,
      y = -dy / radius;
    setKnob({ x, y });
    // Pushing sideways also walks a little, so the explorer heads that way
    // instead of turning on the spot; pulling down steps back.
    steer({ x, y: y >= 0 ? Math.min(1, y + Math.abs(x) * 0.6) : y });
  };
  const end = () => {
    pointer.current = null;
    setKnob(null);
    steer(null);
  };
  return (
    <section
      ref={panel}
      className="demo-pad"
      aria-label={tr("Demo controls")}
      data-running={running || undefined}
      data-target={target ? "" : undefined}
    >
      <div
        ref={base}
        className="demo-stick"
        data-active={knob ? "" : undefined}
        onPointerDown={(e) => {
          e.preventDefault();
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => { if (pointer.current === e.pointerId) move(e); }}
        onPointerUp={(e) => { if (pointer.current === e.pointerId) end(); }}
        onPointerCancel={(e) => { if (pointer.current === e.pointerId) end(); }}
        onLostPointerCapture={(e) => { if (pointer.current === e.pointerId) end(); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button className="demo-forward" aria-label={tr("Walk forward")} title={tr("Forward (↑ / W)")} {...step("forward")}>
          <CaretUp size={16} weight="bold" />
        </button>
        <button className="demo-right" aria-label={tr("Turn right")} title={tr("Turn right (→ / D)")} {...step("right")}>
          <CaretRight size={16} weight="bold" />
        </button>
        <button className="demo-back" aria-label={tr("Step back")} title={tr("Back (↓ / S)")} {...step("back")}>
          <CaretDown size={16} weight="bold" />
        </button>
        <button className="demo-left" aria-label={tr("Turn left")} title={tr("Turn left (← / A)")} {...step("left")}>
          <CaretLeft size={16} weight="bold" />
        </button>
        <span
          className="demo-knob"
          aria-hidden="true"
          style={knob ? { transform: `translate(${knob.x * 34}px, ${-knob.y * 34}px)` } : undefined}
        />
      </div>
      <button
        className="demo-run"
        aria-label={tr("Run")}
        aria-pressed={run}
        title={tr("Run on or off (Shift walks)")}
        onClick={() => setRun(!run)}
      >
        <PersonSimpleRun size={20} weight={running ? "fill" : "regular"} />
      </button>
      <button className="demo-pad-min" aria-label={tr("Hide demo controls")} title={tr("Hide demo controls")} onClick={() => toggle(false)}>
        <Minus size={16} weight="bold" />
      </button>
      <p className="demo-pad-hint sr-only">
        {hint}
      </p>
    </section>
  );
}

/** The stick shows as the matching arrow pressed, for screen readers too. */
function stickHolds(knob: { x: number; y: number } | null, control: DemoControl) {
  if (!knob || Math.hypot(knob.x, knob.y) <= 0.18) return false;
  if (control === "forward") return knob.y > 0.35;
  if (control === "back") return knob.y < -0.35;
  if (control === "right") return knob.x > 0.35;
  return knob.x < -0.35;
}
