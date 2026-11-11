// The Layer screen (docs/LAYER.md): a shared, nonfinancial 3D voxel world.
// Lazy: three.js, the world generator and this screen load only on entry.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowFatUp,
  ArrowLeft,
  Crosshair,
  Cube,
  Eraser,
  Hammer,
  House,
  NavigationArrow,
  Question,
  TShirt,
  X,
} from "@phosphor-icons/react";
import { api, ApiError } from "../api";
import { tr } from "../i18n";
import type { Item, Player } from "../types";
import { cssColor } from "./mesher";
import { BLOCK, BUILD_BLOCKS, OUTFITS, outfitById, type Biome } from "./world";
import type { BlockEdit, EngineState, LayerEngine, LayerPlot, Peer } from "./engine";
import "./layer.css";

export type PublicLayer = {
  id: string;
  name: string;
  community: string;
  seed: number;
  coin: string;
  economyActive: boolean;
};
type Progress = { day: string; beacons: string[]; beaconGoal: number; built: number; buildGoal: number };
type Home = { plot: LayerPlot; spawn: { x: number; y: number; z: number }; progress: Progress };
type Notice = "own-plot" | "too-far" | "occupied" | "depth" | "saved-failed" | "save-retry" | "activated";
/** A batch of block edits with its request id, kept for a retry with the same id. */
type EditBatch = { requestId: string; edits: BlockEdit[] };

const OUTFIT_KEY = "questlayer.layer.outfit";
/** Server limit per /api/layer/edit request (server/layer/store.mjs). */
const LAYER_EDITS_PER_REQUEST = 32;
const editBody = (plotId: string, b: EditBatch) => ({
  plotId,
  requestId: b.requestId,
  edits: b.edits.map(({ x, y, z, block }) => ({ x, y, z, block })),
});
const HELP_KEY = "questlayer.layer.help-seen";
const readLocal = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: a convenience only */
  }
};
const blockLabel = (b: number) =>
  ({
    [BLOCK.plank]: tr("Plank"),
    [BLOCK.brick]: tr("Hull plate"),
    [BLOCK.stone]: tr("Basalt"),
    [BLOCK.glass]: tr("Glass"),
    [BLOCK.lantern]: tr("Lamp"),
    [BLOCK.grass]: tr("Star moss"),
    [BLOCK.sand]: tr("Stardust"),
    [BLOCK.wood]: tr("Spore stalk"),
    [BLOCK.leaves]: tr("Spore cap"),
    [BLOCK.crystal]: tr("Crystal"),
  })[b] ?? tr("Block");
const biomeLabel = (b: Biome) =>
  ({
    meadow: tr("Lumen plains"),
    forest: tr("Spore forest"),
    desert: tr("Dust dunes"),
    wetland: tr("Aether shallows"),
    crag: tr("Basalt peaks"),
    crystal: tr("Crystal fields"),
    settlement: tr("Settlement"),
  })[b];
const outfitLabel = (id: string) =>
  ({
    nebula: tr("Nebula"),
    solar: tr("Solar"),
    comet: tr("Comet"),
    moss: tr("Moss"),
    void: tr("Void"),
    ember: tr("Ember"),
  })[id] ?? id;
const noticeText = (n: Notice) =>
  ({
    "own-plot": tr("You can build only on your own plot (gold border)."),
    "too-far": tr("Move closer to build there."),
    occupied: tr("You are standing there."),
    depth: tr("That is too deep or too high for your plot."),
    "saved-failed": tr("Your last blocks were not saved and were undone. Try again."),
    "save-retry": tr("Connection problem. Your blocks are kept and will be saved when it is back."),
    activated: tr("Beacon activated!"),
  })[n];

function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null),
    [knob, setKnob] = useState({ x: 0, y: 0 }),
    active = useRef<number | null>(null);
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2),
      y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    setKnob({ x, y });
    onMove(x, -y);
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  return (
    <div
      ref={base}
      className="layer-joystick"
      aria-hidden="true"
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <i style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}

export function Layer({
  player,
  items,
  layer,
  onExit,
}: {
  player: Player;
  items: Item[];
  layer: PublicLayer;
  onExit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<LayerEngine | null>(null),
    pending = useRef<BlockEdit[]>([]),
    retry = useRef<EditBatch | null>(null),
    retryAt = useRef(0),
    retries = useRef(0),
    inFlight = useRef(false),
    homeRef = useRef<Home | null>(null);
  const [home, setHome] = useState<Home | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [hud, setHud] = useState<EngineState | null>(null),
    [building, setBuilding] = useState(false),
    [breaking, setBreaking] = useState(false),
    [block, setBlock] = useState<number>(BLOCK.plank),
    [outfit, setOutfit] = useState(() => outfitById(readLocal(OUTFIT_KEY) || "nebula").id),
    [sheet, setSheet] = useState<"help" | "outfit" | null>(() => (readLocal(HELP_KEY) ? null : "help")),
    [notice, setNotice] = useState<Notice | null>(null),
    [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle"),
    [progress, setProgress] = useState<Progress | null>(null),
    [peerCount, setPeerCount] = useState(0);
  const outfitRef = useRef(outfit),
    homeTrip = useRef<() => void>(() => {});
  const aura = items.find((i) => i.equipped && i.slot === "above")?.color;
  const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const flash = useCallback((n: Notice) => {
    setNotice(n);
    window.setTimeout(() => setNotice((v) => (v === n ? null : v)), 2600);
  }, []);

  // Send queued edits in small batches. A refusal (4xx) undoes the batch; a
  // lost connection or a server error keeps the blocks and retries the same
  // request id, which the server applies at most once.
  const flush = useCallback(async () => {
    const h = homeRef.current;
    if (inFlight.current || !h) return;
    if (retry.current && Date.now() < retryAt.current) return;
    const batch: EditBatch | null =
      retry.current ??
      (pending.current.length
        ? { requestId: crypto.randomUUID(), edits: pending.current.splice(0, LAYER_EDITS_PER_REQUEST) }
        : null);
    if (!batch) return;
    retry.current = null;
    inFlight.current = true;
    setSaving("saving");
    try {
      const result = await api<{ plot: LayerPlot }>("/layer/edit", editBody(h.plot.id, batch));
      h.plot = result.plot;
      retries.current = 0;
      setProgress((p) => (p ? { ...p, built: result.plot.blocks ?? p.built } : p));
      setSaving(pending.current.length ? "saving" : "saved");
    } catch (e) {
      const refused = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
      if (refused) {
        for (const edit of [...batch.edits].reverse()) engine.current?.applyLocal(edit.x, edit.y, edit.z, edit.previous);
        flash("saved-failed");
        setSaving(pending.current.length ? "saving" : "idle");
      } else {
        retry.current = batch;
        retries.current += 1;
        retryAt.current = Date.now() + Math.min(10_000, 500 * 2 ** Math.min(retries.current, 5));
        if (retries.current === 1 || retries.current % 5 === 0) flash("save-retry");
      }
    } finally {
      inFlight.current = false;
    }
  }, [flash]);

  /** Hands every unsaved block to the browser so it is sent even while the page closes. */
  const flushOnLeave = useCallback(() => {
    const h = homeRef.current;
    if (!h) return;
    const batches: EditBatch[] = [];
    if (retry.current) batches.push(retry.current);
    retry.current = null;
    while (pending.current.length)
      batches.push({ requestId: crypto.randomUUID(), edits: pending.current.splice(0, LAYER_EDITS_PER_REQUEST) });
    for (const b of batches)
      void fetch("/api/layer/edit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editBody(h.plot.id, b)),
        keepalive: true,
      }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const timers: number[] = [];
    setError("");
    (async () => {
      const data = await api<Home>("/layer/home", { layer: layer.id });
      if (!active || !host.current) return;
      homeRef.current = data;
      setHome(data);
      setProgress(data.progress);
      const { createLayerEngine } = await import("./engine");
      if (!active || !host.current) return;
      const view = createLayerEngine(host.current, {
        seed: layer.seed,
        spawn: data.spawn,
        home: data.plot,
        outfit: outfitById(outfit),
        aura,
        phone,
        reducedMotion,
        onEdit: (e) => {
          pending.current.push(e);
          setSaving("saving");
        },
        onNotice: flash,
      });
      engine.current = view;
      view.canvas.setAttribute("aria-label", tr("3D world. Move with W A S D, jump with Space, drag to look around."));
      const syncPlots = async () => {
        const s = view.getState();
        const { plots } = await api<{ plots: LayerPlot[] }>(
          `/layer/plots?layer=${encodeURIComponent(layer.id)}&x=${Math.round(s.x)}&z=${Math.round(s.z)}`,
        );
        const known = new Map(view.knownPlots().map((p) => [p.id, p.revision]));
        for (const p of plots) {
          const mine = p.id === data.plot.id;
          if (known.get(p.id) === p.revision) continue;
          if (mine && known.has(p.id) && (pending.current.length || inFlight.current || retry.current)) continue;
          // One failed plot must not keep every other plot stale.
          const full = await api<{ plot: LayerPlot; blocks: [number, number, number, number][] }>(
            `/layer/plot?id=${encodeURIComponent(p.id)}`,
          ).catch(() => null);
          if (active && full) view.setPlot(full.plot, full.blocks);
        }
      };
      await syncPlots();
      const presence = async (extra: Record<string, unknown> = {}) => {
        const s = view.getState();
        const r = await api<{
          peers: Peer[];
          corrected: { x: number; y: number; z: number } | null;
          activated: string | null;
          progress: Progress;
        }>("/layer/presence", {
          layer: layer.id,
          x: s.x,
          y: s.y,
          z: s.z,
          yaw: s.heading,
          outfit: outfitRef.current,
          ...extra,
        });
        if (!active) return;
        view.setPeers(r.peers);
        setPeerCount(r.peers.length);
        if (r.corrected) view.teleport(r.corrected);
        if (r.activated) flash("activated");
        view.setActiveBeacons(r.progress.beacons);
        setProgress(r.progress);
      };
      homeTrip.current = () => void presence({ home: true }).catch(() => {});
      await presence().catch(() => {});
      timers.push(
        window.setInterval(() => void presence().catch(() => {}), 1000),
        window.setInterval(() => void syncPlots().catch(() => {}), 5000),
        window.setInterval(() => void flush(), 300),
        window.setInterval(() => active && setHud(view.getState()), 250),
      );
    })().catch((e) => {
      if (active) setError(e instanceof ApiError || e instanceof Error ? e.message : tr("The layer could not open."));
    });
    const hidden = () => document.visibilityState === "hidden" && flushOnLeave();
    window.addEventListener("pagehide", flushOnLeave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active = false;
      timers.forEach((t) => clearInterval(t));
      window.removeEventListener("pagehide", flushOnLeave);
      document.removeEventListener("visibilitychange", hidden);
      flushOnLeave();
      void fetch("/api/layer/leave", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layer: layer.id }),
        keepalive: true,
      }).catch(() => {});
      engine.current?.dispose();
      engine.current = null;
    };
    // The engine is created once per player, layer and retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.id, layer.id, attempt]);

  useEffect(() => {
    outfitRef.current = outfit;
    writeLocal(OUTFIT_KEY, outfit);
    engine.current?.setOutfit(outfitById(outfit), aura);
  }, [outfit, aura]);
  useEffect(() => engine.current?.setBuild(building), [building, home]);
  useEffect(() => engine.current?.setBreaking(breaking), [breaking, home]);
  useEffect(() => engine.current?.setBlock(block), [block, home]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "b" || e.key === "B") setBuilding((v) => !v);
      else if (e.key === "x" || e.key === "X") setBreaking((v) => !v);
      else if (/^[1-9]$/.test(e.key)) setBlock(BUILD_BLOCKS[Number(e.key) - 1] ?? BLOCK.plank);
      else if (e.key === "Enter" && building) engine.current?.actAtCenter();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [building]);

  const closeSheet = () => {
    if (sheet === "help") writeLocal(HELP_KEY, "1");
    setSheet(null);
  };
  const where = hud?.plot
    ? hud.plot.mine
      ? tr("Your plot")
      : tr("Plot of {0}", { 0: hud.plot.ownerName })
    : hud
      ? biomeLabel(hud.biome)
      : "";

  // Full-screen: portalled so desktop panel layout cannot clip the world.
  return createPortal(
    <section className="layer-screen" aria-label={layer.name}>
      <div className="layer-stage" ref={host} data-testid="layer-stage" />
      <header className="layer-top">
        <button className="layer-icon" onClick={onExit} aria-label={tr("Back to QuestLayer")}>
          <ArrowLeft size={24} />
        </button>
        <div className="layer-title">
          <strong>{layer.name}</strong>
          <small>
            {where}
            {peerCount ? ` · ${tr("Explorers nearby: {0}", { 0: peerCount })}` : ""}
          </small>
        </div>
        <button className="layer-icon" onClick={() => setSheet("outfit")} aria-label={tr("Outfit")}>
          <TShirt size={24} />
        </button>
        <button className="layer-icon" onClick={() => setSheet("help")} aria-label={tr("How the layer works")}>
          <Question size={24} />
        </button>
      </header>

      {progress && (
        <aside className="layer-goals" aria-label={tr("Today's goals")}>
          <p>
            <Cube size={18} aria-hidden="true" />
            {tr("Build on your plot: {0} of {1}", { 0: Math.min(progress.built, progress.buildGoal), 1: progress.buildGoal })}
          </p>
          <p>
            <NavigationArrow
              size={18}
              aria-hidden="true"
              style={hud?.beacon ? { transform: `rotate(${(-hud.beacon.bearing * 180) / Math.PI + 45}deg)` } : undefined}
            />
            {tr("Activate beacons: {0} of {1}", { 0: progress.beacons.length, 1: progress.beaconGoal })}
            {hud?.beacon && !hud.beacon.active && progress.beacons.length < progress.beaconGoal && (
              <em>{tr("{0} m", { 0: Math.round(hud.beacon.distance) })}</em>
            )}
          </p>
        </aside>
      )}

      <p className="layer-notice" role="status" aria-live="polite">
        {notice ? noticeText(notice) : saving === "saving" ? tr("Saving…") : ""}
      </p>

      {error && (
        <div className="layer-error" role="alert">
          <p>{error}</p>
          <button className="primary-button" onClick={() => setAttempt((v) => v + 1)}>
            {tr("Try again")}
          </button>
        </div>
      )}
      {!home && !error && <p className="layer-loading" role="status">{tr("Opening the layer…")}</p>}

      {home && (
        <footer className="layer-controls">
          <Joystick onMove={(x, y) => engine.current?.setMove(x, y)} />
          {building && (
            <div className="layer-palette" role="radiogroup" aria-label={tr("Blocks")}>
              <button
                role="radio"
                aria-checked={breaking}
                className="layer-swatch erase"
                onClick={() => setBreaking(true)}
                aria-label={tr("Remove blocks")}
              >
                <Eraser size={22} />
              </button>
              {BUILD_BLOCKS.map((b, i) => (
                <button
                  key={b}
                  role="radio"
                  aria-checked={!breaking && block === b}
                  className="layer-swatch"
                  style={{ "--swatch": cssColor(b) } as React.CSSProperties}
                  onClick={() => {
                    setBlock(b);
                    setBreaking(false);
                  }}
                  aria-label={blockLabel(b)}
                  title={`${blockLabel(b)} (${i + 1})`}
                />
              ))}
            </div>
          )}
          <div className="layer-actions">
            <button className="layer-icon" onClick={() => homeTrip.current()} aria-label={tr("Go to your plot")}>
              <House size={24} />
            </button>
            {building && (
              <button className="layer-icon" onClick={() => engine.current?.actAtCenter()} aria-label={tr("Build at the centre")}>
                <Crosshair size={24} />
              </button>
            )}
            <button
              className="layer-icon"
              aria-pressed={building}
              onClick={() => setBuilding((v) => !v)}
              aria-label={building ? tr("Stop building") : tr("Build")}
            >
              <Hammer size={24} />
            </button>
            <button className="layer-icon jump" onPointerDown={() => engine.current?.jump()} onClick={() => engine.current?.jump()} aria-label={tr("Jump")}>
              <ArrowFatUp size={28} />
            </button>
          </div>
        </footer>
      )}

      {sheet && (
        <div className="layer-sheet" role="dialog" aria-modal="true" aria-label={sheet === "help" ? tr("How the layer works") : tr("Outfit")}>
          <div className="layer-sheet-card">
            <header>
              <h2>{sheet === "help" ? tr("Welcome to {0}", { 0: layer.name }) : tr("Outfit")}</h2>
              <button className="layer-icon" onClick={closeSheet} aria-label={tr("Close")} autoFocus>
                <X size={22} />
              </button>
            </header>
            {sheet === "help" ? (
              <>
                <ul>
                  <li>{tr("Walk with the stick or W A S D, jump with the arrow button or Space, drag to look around.")}</li>
                  <li>{tr("Your free home plot has a gold border. Tap Build, pick a block and tap where it goes.")}</li>
                  <li>{tr("Follow the light pillars to beacons. Stand on one to activate it.")}</li>
                  <li>{tr("Other explorers walk the same world. You see their plots; only owners can change them.")}</li>
                </ul>
                <p className="layer-disclosure">
                  {tr(
                    "Each community gets its own layer. This layer's coin is {0}: it will run on QGOLD for tasks you create and complete here. Coins, staking and its treasury are not active yet; nothing here pays or costs anything.",
                    { 0: layer.coin },
                  )}
                </p>
                <p className="layer-disclosure">{tr("Moving here never counts as GPS movement in QuestLayer.")}</p>
              </>
            ) : (
              <div className="layer-outfits" role="radiogroup" aria-label={tr("Outfit")}>
                {OUTFITS.map((o) => (
                  <button
                    key={o.id}
                    role="radio"
                    aria-checked={outfit === o.id}
                    onClick={() => setOutfit(o.id)}
                    style={{ "--suit": o.suit, "--trim": o.trim, "--visor": o.visor } as React.CSSProperties}
                  >
                    <i aria-hidden="true" />
                    {outfitLabel(o.id)}
                  </button>
                ))}
                <p className="layer-disclosure">{tr("Outfits are colours only. Your equipped Aura shows as a halo.")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>,
    document.body,
  );
}
