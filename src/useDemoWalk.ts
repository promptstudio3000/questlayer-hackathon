import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "./types";
import {
  DEMO_START_HEADING,
  DEMO_TICK_MS,
  demoTick,
  type DemoInput,
} from "./map-motion";

export type DemoControl = "forward" | "back" | "left" | "right";
const KEYS: Record<string, DemoControl> = {
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowDown: "back",
  KeyS: "back",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};
// Places where arrow keys already mean something (tabs, sliders, lists, the
// 3D viewer) or where people type keep their keys.
const OWN_KEYS =
  "input,textarea,select,[contenteditable=true],canvas,[role=tab],[role=tablist],[role=slider],[role=listbox],[role=option],[role=menu],[role=menuitem],[role=radio],[role=radiogroup],[role=grid],[role=gridcell],[role=spinbutton]";

/**
 * City demo movement. Arrows / WASD (or the on-screen pad) turn the explorer
 * and run it the way it faces; Shift or the Run toggle walks instead. Real play never
 * uses this: there the position comes only from the device GPS.
 */
export function useDemoWalk({
  enabled,
  setPosition,
  onWalk,
}: {
  enabled: boolean;
  setPosition: (update: (p: Point) => Point) => void;
  /** Called when a step starts, e.g. to make the camera follow again. */
  onWalk?: () => void;
}) {
  const [heading, setHeading] = useState(DEMO_START_HEADING),
    [held, setHeld] = useState<Set<DemoControl>>(() => new Set()),
    // Running is the default so the demo crosses a city quickly; Shift (or
    // the toggle) walks for the last few metres.
    [run, setRun] = useState(true),
    [shift, setShift] = useState(false);
  const running = shift ? !run : run;
  const live = useRef({ heading, held, run: running, onWalk });
  live.current = { heading, held, run: running, onWalk };

  const press = useCallback((control: DemoControl, down: boolean) => {
    setHeld((current) => {
      if (current.has(control) === down) return current;
      const next = new Set(current);
      if (down) next.add(control);
      else next.delete(control);
      return next;
    });
  }, []);
  const release = useCallback(() => {
    setHeld((current) => (current.size ? new Set() : current));
    setShift(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }
    const key = (e: KeyboardEvent, down: boolean) => {
      if (e.key === "Shift") {
        setShift(down);
        return;
      }
      const control = KEYS[e.code] || KEYS[e.key];
      if (!control) return;
      if (!down) {
        press(control, false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector("dialog[open],[role=dialog][aria-modal=true]") ||
        target?.closest?.(OWN_KEYS)
      )
        return;
      e.preventDefault();
      setShift(e.shiftKey);
      press(control, true);
    };
    const down = (e: KeyboardEvent) => key(e, true),
      up = (e: KeyboardEvent) => key(e, false),
      hidden = () => {
        if (document.visibilityState !== "visible") release();
      };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [enabled, press, release]);

  const active = enabled && held.size > 0;
  useEffect(() => {
    if (!active) return;
    // The first tick counts as a full one, so a quick tap still takes a step.
    let last = performance.now() - DEMO_TICK_MS,
      walking = false;
    const tick = () => {
      const now = performance.now(),
        seconds = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { heading: from, held: keys, run: running } = live.current;
      const input: DemoInput = {
        forward: keys.has("forward"),
        back: keys.has("back"),
        left: keys.has("left"),
        right: keys.has("right"),
        run: running,
      };
      const step = demoTick({ lat: 0, lng: 0 }, from, input, seconds);
      if (step.heading !== from) {
        live.current.heading = step.heading;
        setHeading(step.heading);
      }
      if (!step.moved) return;
      if (!walking) {
        walking = true;
        live.current.onWalk?.();
      }
      setPosition((p) => demoTick(p, from, input, seconds).position);
    };
    tick();
    const timer = setInterval(tick, DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, [active, setPosition]);

  /** Turn to face a point, so Forward walks straight to it. */
  const face = useCallback((heading: number | null) => {
    if (heading !== null) setHeading(heading);
  }, []);

  return { heading, held, run, setRun, running, press, release, face };
}
