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
  "input,textarea,select,[contenteditable]:not([contenteditable=false]),canvas,[role=textbox],[role=combobox],[role=tab],[role=tablist],[role=slider],[role=listbox],[role=option],[role=menu],[role=menuitem],[role=radio],[role=radiogroup],[role=grid],[role=gridcell],[role=spinbutton],[role=tree],[role=treeitem]";
function ownsKeys(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  // The game owns movement on its map canvas; other canvases keep their controls.
  return !target.matches("canvas.maplibregl-canvas") && !!target.closest(OWN_KEYS);
}

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
  /** Called when movement or turning starts, to resume the chase camera. */
  onWalk?: () => void;
}) {
  const [heading, setHeading] = useState(DEMO_START_HEADING),
    [held, setHeld] = useState<Set<DemoControl>>(() => new Set()),
    // Running is the default so the demo crosses a city quickly; Shift (or
    // the toggle) walks for the last few metres.
    [run, setRun] = useState(true),
    [shift, setShift] = useState(false),
    [engaged, setEngaged] = useState(false);
  const running = shift ? !run : run;
  const live = useRef({ enabled, heading, held, run: running, onWalk });
  live.current = { enabled, heading, held, run: running, onWalk };
  const sources = useRef(new Map<string, DemoControl>());
  const shiftKeys = useRef(new Set<string>());

  const press = useCallback((control: DemoControl, down: boolean, source = `pad:${control}`) => {
    if (down && (!live.current.enabled || document.querySelector("dialog[open],[role=dialog][aria-modal=true]"))) return;
    if (down ? sources.current.get(source) === control : !sources.current.has(source)) return;
    if (down) sources.current.set(source, control);
    else sources.current.delete(source);
    const next = new Set(sources.current.values());
    live.current.held = next;
    setHeld(next);
  }, []);
  const release = useCallback(() => {
    sources.current.clear();
    shiftKeys.current.clear();
    live.current.held = new Set();
    setHeld((current) => (current.size ? new Set() : current));
    setShift(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      release();
      return;
    }
    const key = (e: KeyboardEvent, down: boolean) => {
      const blocked = e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey ||
        document.querySelector("dialog[open],[role=dialog][aria-modal=true]") || ownsKeys(e.target);
      if (e.key === "Shift") {
        if (down && blocked) return;
        if (down) shiftKeys.current.add(e.code);
        else shiftKeys.current.delete(e.code);
        setShift(shiftKeys.current.size > 0);
        return;
      }
      const control = KEYS[e.code] || KEYS[e.key];
      if (!control) return;
      const source = `key:${e.code || e.key}`;
      if (!down) {
        press(control, false, source);
        return;
      }
      if (blocked || (e.repeat && !sources.current.has(source))) return;
      e.preventDefault();
      e.stopPropagation();
      setShift(e.shiftKey);
      press(control, true, source);
    };
    const down = (e: KeyboardEvent) => key(e, true),
      up = (e: KeyboardEvent) => key(e, false),
      hidden = () => {
        if (document.visibilityState !== "visible") release();
      };
    const focus = (e: FocusEvent) => { if (ownsKeys(e.target)) release(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", release);
    document.addEventListener("focusin", focus);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("focusin", focus);
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
      if (!live.current.enabled || document.querySelector("dialog[open],[role=dialog][aria-modal=true]")) {
        release();
        return;
      }
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
      if (!step.moved && step.heading === from) return;
      setEngaged(true);
      if (!walking) {
        walking = true;
        live.current.onWalk?.();
      }
      if (step.moved) setPosition((p) => demoTick(p, from, input, seconds).position);
    };
    tick();
    const timer = setInterval(tick, DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, [active, setPosition, release]);

  /** Turn to face a point, so Forward walks straight to it. */
  const face = useCallback((heading: number | null) => {
    if (heading !== null && Number.isFinite(heading)) {
      live.current.heading = heading;
      setHeading(heading);
      setEngaged(true);
    }
  }, []);

  return { heading, held, run, setRun, running, press, release, face, engaged };
}
