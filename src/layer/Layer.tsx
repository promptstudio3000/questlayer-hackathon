// MetaLayer's shared world and Quiet Beacon story. The mounted entry uses the authenticated Layer
// API, with server-confirmed world edits and resource receipts. Settlement stays
// explicitly unconfigured until the owner's dedicated contract integration.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowFatUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  Compass,
  Crosshair,
  Cube,
  Diamond,
  Hammer,
  House,
  NavigationArrow,
  Hammer as Pickaxe,
  Backpack,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { api, ApiError } from "../api";
import { Dialog } from "../Dialog";
import { DemoControls } from "../DemoControls";
import { Character } from "../Character";
import { WorldSwitcher, type GameLayerConfig } from "../WorldSwitcher";
import { MapActions } from "../MapActions";
import { ScreenTabs, Details } from "../ScreenTabs";
import { InfoTip } from "../InfoTip";
import { LayerSettings } from "./LayerSettings";
import type { DemoControl } from "../useDemoWalk";
import { STARTER_SPRITE } from "../character-art";
import { tr } from "../i18n";
import type { Item, Player } from "../types";
import { cssColor } from "./mesher";
import { BLOCK, BUILD_BLOCKS, outfitById } from "./world";
import { MINES, inPlaza } from "../../server/layer/expedition-world.mjs";
import { Minimap } from "./Minimap";
import { StoryBoard } from "./StoryBoard";
import { PlacePanel, PlaceDirectory } from "./PlacePanel";
import { objectivePlace, placeName, placeTarget } from "./place-ui";
import { LayerActivity } from "./LayerActivity";
import { storyObjective, siteName, playFailure, type ExpeditionProgress } from "./story-ui";
import { storySiteAt, type WorldPlaceId } from "../../server/layer/story-world.mjs";
import type { BlockEdit, EngineState, LayerEngine, Peer } from "./engine";
import "./layer.css";

export type PublicLayer = {
  id: string;
  name: string;
  community: string;
  seed: number;
  coin: string;
  economyActive: boolean;
  demoActors?: boolean;
};
type Progress = ExpeditionProgress;
type Snapshot = Progress & {
  changes: [number, number, number, number][];
  tiles: [number, number][];
};
type Entry = Snapshot & { spawn: { x: number; y: number; z: number } };
type Sheet = "help" | "inventory" | "community" | "atlas" | "parcel" | "activity" | "materials" | "place" | null;
const blockName = (b: number) =>
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
  })[b] || tr("Block");
const stateOrder = { available: 0, discover: 1, mine: 2, complete: 3 };
const storyOrder = { expedition: 0, quarry: 1, signals: 2, marker: 3, beacon: 4, complete: 5 };

export function Layer({
  player,
  items,
  layer,
  onNavigate,
  gameLayer,
}: {
  player: Player;
  items: Item[];
  layer: PublicLayer;
  onNavigate: (view: { tab: "explore" } | { tab: "settings"; profileView: "character" }) => void;
  gameLayer?: GameLayerConfig | null;
}) {
  const onExit = () => onNavigate({ tab: "explore" });
  const onProfile = () => onNavigate({ tab: "settings", profileView: "character" });
  const scope = useRef<HTMLElement>(null), objectiveCard = useRef<HTMLDivElement>(null);
  const [mapShown, setMapShown] = useState(false), [communityView, setCommunityView] = useState<"quests" | "journal">("quests");
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<LayerEngine | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null),
    [hud, setHud] = useState<EngineState | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null),
    [building, setBuilding] = useState(false);
  const [block, setBlock] = useState<number>(BLOCK.plank),
    [peers, setPeers] = useState(0);
  const [tiles, setTiles] = useState<[number, number][]>([]),
    [mapTiles, setMapTiles] = useState<[number, number][]>([]);
  const [mapCenter, setMapCenter] = useState({ x: 0, z: 0 }),
    [mapBusy, setMapBusy] = useState(false);
  const [held, setHeld] = useState<Set<DemoControl>>(() => new Set()),
    [run, setRun] = useState(true);
  const [saving, setSaving] = useState(false);
  const [place, setPlace] = useState<WorldPlaceId>("nera");
  const openPlace = (id: WorldPlaceId) => { setPlace(id); setNotice(""); setSheet("place"); };
  const heldRef = useRef(new Set<DemoControl>()),
    acting = useRef(false);
  const interactRef = useRef<(body: Record<string, unknown>) => void>(() => {});
  const refresh = useRef<() => Promise<void>>(async () => {});
  useLayoutEffect(() => {
    if (!objectiveCard.current || !scope.current) return;
    const card = objectiveCard.current, root = scope.current;
    const update = () => root.style.setProperty("--hud-card", `${Math.ceil(card.getBoundingClientRect().height) + 8}px`);
    const observer = new ResizeObserver(update); observer.observe(card); update();
    return () => observer.disconnect();
  }, [!!progress, sheet]);
  const avatarAura = items.find(
    (item) => item.equipped && item.slot === "above",
  )?.color;
  const live = useRef({ avatarAura });
  live.current = { avatarAura };
  const applyProgress = (next: Progress) =>
    setProgress((old) => {
      if (!old) return next;
      return {
        ...next,
        inventory: {
          diamonds: Math.max(old.inventory.diamonds, next.inventory.diamonds),
          stone: Math.max(old.inventory.stone, next.inventory.stone),
        },
        discoveries: [...new Set([...(old.discoveries || []), ...(next.discoveries || [])])],
        story: {
          ...(storyOrder[old.story.stage] > storyOrder[next.story.stage] ||
            (old.story.stage === next.story.stage && old.story.signals.length > next.story.signals.length)
              ? old.story : next.story),
          sharedBeaconLit: old.story.sharedBeaconLit || next.story.sharedBeaconLit,
        },
        quest:
          stateOrder[old.quest.state] > stateOrder[next.quest.state]
            ? old.quest
            : {
                ...next.quest,
                diamonds: Math.max(old.quest.diamonds, next.quest.diamonds),
              },
      };
    });
  const showError = (failure: unknown) =>
    setNotice(
      playFailure(failure),
    );

  useEffect(() => {
    let active = true,
      view: LayerEngine | null = null,
      syncing = false,
      publishing = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    let mutationEpoch = 0;
    const pending = new AbortController();
    setError("");
    setNotice("");
    setProgress(null);
    const sync = async () => {
      if (!active || !view || syncing || acting.current) return;
      syncing = true;
      const readEpoch = mutationEpoch;
      try {
        const p = view.getState();
        const data = await api<Snapshot>(
          `/layer/expedition/state?layer=${encodeURIComponent(layer.id)}&x=${p.x}&z=${p.z}`,
        );
        if (active && !acting.current && readEpoch === mutationEpoch) {
          view.setChanges(data.changes);
          setTiles(data.tiles);
          applyProgress(data);
        }
      } catch (failure) {
        if (active) showError(failure);
      } finally {
        syncing = false;
      }
    };
    refresh.current = sync;
    // A lost reply retries exactly the same receipt. Displayed inventory comes
    // from the authoritative snapshot; a failed request never predicts a grant.
    const perform = async (route: string, body: Record<string, unknown>) => {
      if (acting.current) return;
      mutationEpoch++;
      acting.current = true;
      setSaving(true);
      try {
        let response: (Progress & { changes: Snapshot["changes"] }) | undefined;
        for (let count = 0; count < 3; count++) {
          try {
            response = await api(`/layer/expedition/${route}`, {
              layer: layer.id,
              ...body,
            });
            break;
          } catch (failure) {
            if (
              (failure instanceof ApiError && failure.status < 500) ||
              count === 2
            )
              throw failure;
          }
        }
        if (active && response) {
          for (const [x, y, z, b] of response.changes || [])
            view?.applyLocal(x, y, z, b);
          applyProgress(response);
          setNotice("");
        }
      } catch (failure) {
        if (active) showError(failure);
      } finally {
        acting.current = false;
        if (active) {
          setSaving(false);
          void sync();
        }
      }
    };
    interactRef.current = (body) => void perform("interact", { ...body, requestId: crypto.randomUUID() });
    void (async () => {
      const entry = await api<Entry>("/layer/expedition/enter", {
        layer: layer.id,
      });
      const { createLayerEngine } = await import("./engine");
      if (!active || !host.current) return;
      view = createLayerEngine(host.current, {
        seed: layer.seed,
        spawn: entry.spawn,
        facing: storyObjective(entry).target || undefined,
        expedition: true,
        demoActors: layer.demoActors,
        onPlace: id => { setPlace(id); setNotice(""); setSheet("place"); },
        outfit: outfitById("nebula"),
        aura: live.current.avatarAura,
        phone: matchMedia("(max-width: 700px)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        onEdit: ({ x, y, z, block, previous }: BlockEdit) =>
          void perform("edit", {
            x,
            y,
            z,
            block,
            expected: previous,
            requestId: crypto.randomUUID(),
          }),
        onMineStart: async (target) => {
          try {
            return await api("/layer/expedition/mine-start", {
              layer: layer.id,
              x: target.x,
              y: target.y,
              z: target.z,
            });
          } catch (failure) {
            if (active) showError(failure);
            throw failure;
          }
        },
        onMineFinish: (token) =>
          perform("mine-finish", { token, requestId: crypto.randomUUID() }),
        onNotice: (reason) =>
          setNotice(
            reason === "own-plot"
              ? tr("Build on the green areas of the public square.")
              : reason === "too-far"
                ? tr("Move closer to that block.")
                : reason === "occupied"
                  ? tr("You are standing there.")
                  : tr("That block is outside the building height."),
          ),
      });
      engine.current = view;
      view.setChanges(entry.changes);
      setTiles(entry.tiles);
      applyProgress(entry);
      view.canvas.setAttribute(
        "aria-label",
        tr(
          "MetaLayer. Use arrows or WASD to walk and turn. Hold to mine, right-click to build.",
        ),
      );
      const publish = async () => {
        if (!active || !view || publishing) return;
        publishing = true;
        try {
          const p = view.getState();
          const data = await api<{
            peers: Peer[];
            corrected: Entry["spawn"] | null;
            expedition: Progress;
          }>("/layer/presence", {
            layer: layer.id,
            expedition: true,
            x: p.x,
            y: p.y,
            z: p.z,
            yaw: p.heading,
          });
          if (!active) return;
          view.setPeers(data.peers);
          setPeers(data.peers.length);
          if (data.corrected) view.teleport(data.corrected);
          if (data.expedition) applyProgress(data.expedition);
        } catch (failure) {
          if (active) showError(failure);
        } finally {
          publishing = false;
        }
      };
      await publish();
      timers.push(
        setInterval(() => {
          if (active && !document.hidden) void publish();
        }, 700),
      );
      timers.push(
        setInterval(() => {
          if (active && !document.hidden) void sync();
        }, 2000),
      );
      timers.push(
        setInterval(() => {
          if (active && view) {
            const state = view.getState();
            setHud(state);
            if (host.current) {
              host.current.dataset.position = JSON.stringify({
                x: state.x,
                y: state.y,
                z: state.z,
              });
              host.current.dataset.target = JSON.stringify(state.target);
              host.current.dataset.heading = String(state.heading);
              host.current.dataset.nearbyPlace = state.place || "";
            }
          }
        }, 100),
      );
      const blur = () => {
        if (document.hidden) view?.setMove(0, 0);
      };
      document.addEventListener("visibilitychange", blur, {
        signal: pending.signal,
      });
    })().catch((failure) => {
      if (active)
        setError(
          failure instanceof Error
            ? tr(failure.message)
            : tr("Could not open MetaLayer."),
        );
    });
    return () => {
      active = false;
      pending.abort();
      timers.forEach(clearInterval);
      view?.dispose();
      engine.current = null;
      acting.current = false;
      void api("/layer/leave", { layer: layer.id }).catch(() => {});
    };
  }, [layer.id, layer.seed, attempt]);

  useEffect(() => {
    engine.current?.setBuild(building);
  }, [building, !!progress]);
  useEffect(() => {
    engine.current?.setBlock(block);
  }, [block, !!progress]);
  useEffect(() => {
    engine.current?.setRunning(run);
  }, [run, !!progress]);
  useEffect(() => {
    if (!progress) return;
    engine.current?.setActiveBeacons([...(progress.story.sharedBeaconLit ? ["plaza"] : []), ...progress.story.signals]);
    engine.current?.setBlueprintVisible(progress.story.stage === "marker");
    engine.current?.setObjectivePlace(objectivePlace(progress));
  }, [progress?.story.sharedBeaconLit, progress?.story.stage, progress?.story.signals.join(","), progress?.quest.state]);
  useEffect(() => {
    engine.current?.setInputEnabled(!sheet);
    if (sheet) release();
  }, [sheet, !!progress]);
  useEffect(() => {
    engine.current?.setOutfit(outfitById("nebula"), avatarAura);
  }, [avatarAura, !!progress]);
  useEffect(() => {
    if (sheet !== "atlas") return;
    let active = true;
    setMapBusy(true);
    void api<Snapshot>(
      `/layer/expedition/state?layer=${encodeURIComponent(layer.id)}&x=${mapCenter.x}&z=${mapCenter.z}`,
    )
      .then((data) => {
        if (active) setMapTiles(data.tiles);
      })
      .catch(showError)
      .finally(() => {
        if (active) setMapBusy(false);
      });
    return () => {
      active = false;
    };
  }, [sheet, mapCenter, layer.id]);

  function release() {
    heldRef.current.clear();
    setHeld(new Set());
    engine.current?.setMove(0, 0);
  }
  const press = (control: DemoControl, down: boolean) => {
    if (down) heldRef.current.add(control);
    else heldRef.current.delete(control);
    setHeld(new Set(heldRef.current));
    engine.current?.setMove(
      Number(heldRef.current.has("right")) -
        Number(heldRef.current.has("left")),
      Number(heldRef.current.has("forward")) -
        Number(heldRef.current.has("back")),
    );
  };
  const startQuest = async () => {
    try {
      applyProgress(await api("/layer/expedition/start", { layer: layer.id }));
      engine.current?.facePoint(MINES[0].entranceX, MINES[0].entranceZ);
      setSheet(null);
    } catch (failure) {
      showError(failure);
    }
  };
  const returnToSquare = async () => {
    engine.current?.stopMining();
    release();
    try {
      const data = await api<Entry>("/layer/expedition/enter", {
        layer: layer.id,
        plaza: true,
      });
      engine.current?.teleport(data.spawn);
      engine.current?.recenter();
      setNotice("");
      void refresh.current();
    } catch (failure) {
      showError(failure);
    }
  };
  const currentObjective = storyObjective(progress);
  const position = hud || { x: 0, y: 15, z: 10, heading: 0 };
  const distance = currentObjective.target ? Math.ceil(Math.hypot(position.x - currentObjective.target.x, position.z - currentObjective.target.z)) : null;
  const direction = currentObjective.target ? (position.heading - Math.atan2(position.x - currentObjective.target.x, position.z - currentObjective.target.z)) * 180 / Math.PI : 0;
  const mineHere = MINES.find(m => Math.abs(position.x - m.x) <= m.radius && Math.abs(position.z - m.z) <= m.radius);
  const stationHere = storySiteAt(position.x, position.z);
  const here = mineHere ? (mineHere.id === "crystal-hollow" ? tr("Crystal Hollow") : tr("Basalt Quarry"))
    : stationHere ? siteName(stationHere.id) : inPlaza(position.x, position.z) ? tr("Central square") : tr("Wilderness");
  const faceObjective = () => {
    if (currentObjective.target) engine.current?.facePoint(currentObjective.target.x, currentObjective.target.z);
    setSheet(null);
  };
  const facePlace = (id: WorldPlaceId) => {
    const target = placeTarget(id);
    engine.current?.facePoint(target.x,target.z); setSheet(null);
  };
  const contextualPlace = !building ? hud?.place : null;
  const showQuests = () => { setCommunityView("quests"); setSheet("community"); };
  const buildFreely = () => {
    if (progress?.story.stage === "marker") {
      setBlock(BLOCK.wood);
      if (currentObjective.target) engine.current?.facePoint(currentObjective.target.x, currentObjective.target.z);
    }
    setBuilding(true); setSheet(null);
  };
  const close = () => setSheet(null);

  return createPortal(
    <section ref={scope} className="app-shell layer-screen" data-screen="explore" data-sheet-open={!!sheet} data-building={building} data-tool-ready={building || !!hud?.target?.mineable} aria-label={tr("MetaLayer")}>
      <div className="layer-stage" ref={host} data-testid="layer-stage" />
      <header className="topbar">
        <WorldSwitcher virtual enabled layerName={layer.name} gameLayer={gameLayer} onChoose={virtual => { if (!virtual) onExit(); }} />
        <div className="hud-left">
          <button className="daily-board-chip" onClick={() => { setCommunityView("quests"); setSheet("community"); }} aria-label={tr("Expedition board")}><Compass size={18} /><b>{Math.min(storyOrder[progress?.story.stage || "expedition"], 5)}/5</b></button>
        </div>
        <div className="topbar-right">
          <div className="hud-bubble">
            <button className="profile-pill ml-player" onClick={onProfile} aria-label={tr("Profile")}>
              <Character items={items} {...player.appearance} compact />
            </button>
            <button className="balance-pill ml-pocket" onClick={() => setSheet("inventory")} aria-label={tr("Open resource inventory")}><span className="gold-icon ml-resource-icon"><Diamond size={18} /></span><b>{progress?.inventory.diamonds ?? 0}</b></button>
          </div>
          <LayerSettings mapShown={mapShown} onMap={() => setMapShown(v => !v)} onLocate={() => engine.current?.recenter()} onSquare={() => void returnToSquare()} onGuide={() => setSheet("help")} onExit={onExit} />
        </div>
      </header>
      <div className="map-sky-chip ml-location"><strong>{tr("MetaLayer")}</strong><span>{here} · {tr("{0} nearby", { 0: peers })}</span></div>
      {mapShown && <aside className="ml-map-tools">
        <button className="ml-atlas-toggle" onClick={() => { setMapCenter({ x: position.x, z: position.z }); setSheet("atlas"); }} aria-label={tr("Open shared atlas")}>
          <Minimap tiles={tiles} x={position.x} z={position.z} heading={position.heading} />
        </button>
      </aside>}
      {error ? (
        <div className="ml-failure" role="alert">
          <p>{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            {tr("Try again")}
          </button>
        </div>
      ) : (
        !progress && (
          <div className="ml-loading" role="status">
            {tr("Opening MetaLayer…")}
          </div>
        )
      )}
      <div className="ml-reticle" aria-hidden="true">
        <i />
        <i />
      </div>
      {hud && hud.mining > 0 && (
        <div
          className="ml-mining"
          role="progressbar"
          aria-label={tr("Mining block")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hud.mining * 100)}
        >
          <span style={{ width: `${hud.mining * 100}%` }} />
        </div>
      )}
      {progress && (
        <>
          <DemoControls
            held={held}
            running={run}
            run={run}
            setRun={setRun}
            press={press}
            release={release}
            steer={(vector) =>
              engine.current?.setMove(vector?.x ?? 0, vector?.y ?? 0)
            }
          />
          <MapActions actions={[
            { id: "mine", label: tr("Mine blocks"), icon: Pickaxe, onSelect: () => setBuilding(false) },
            { id: "build", label: tr("Build"), icon: Cube, onSelect: () => { setBuilding(true); setSheet("materials"); } },
            { id: "jump", label: tr("Jump"), icon: ArrowFatUp, onSelect: () => engine.current?.jump() },
            { id: "parcel", label: tr("Land and building"), icon: House, onSelect: () => setSheet("parcel") },
          ]}>
            {(building || hud?.target?.mineable) && <div className="ml-action-buttons">
            {building ? (
              <button
                className="map-actions-toggle ml-tool-primary"
                aria-label={tr("Place selected block")}
                onClick={() => engine.current?.actAtCenter()}
              >
                <Cube size={24} />
              </button>
            ) : (
              <button
                className="map-actions-toggle ml-tool-primary"
                aria-label={tr("Hold to mine the aimed block")}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  engine.current?.startMiningAtCenter();
                }}
                onPointerUp={() => engine.current?.stopMining()}
                onPointerCancel={() => engine.current?.stopMining()}
                onLostPointerCapture={() => engine.current?.stopMining()}
                onKeyDown={(event) => {
                  if (
                    (event.key === " " || event.key === "Enter") &&
                    !event.repeat
                  ) {
                    event.preventDefault();
                    engine.current?.startMiningAtCenter();
                  }
                }}
                onKeyUp={() => engine.current?.stopMining()}
              >
                <Pickaxe size={25} />
              </button>
            )}
            </div>}
          </MapActions>
          <div ref={objectiveCard} className="main-panel explore-panel sheet-compact ml-objective-panel"><div className="sheet-peek sheet-peek-selection">
          <button
            className="compact-selection ml-objective"
            onClick={() => contextualPlace ? openPlace(contextualPlace) : progress.quest.state === "available" ? openPlace("nera") : showQuests()}
          >
            <span className="peek-art">
              {contextualPlace ? contextualPlace === "nera" ? <UsersThree size={22} /> : <Compass size={22} /> : progress.story.stage === "complete" ? <Check size={22} /> : <ArrowUp size={23} style={{ transform: `rotate(${direction}deg)` }} />}
            </span>
            <span className="peek-body">
              <strong>{contextualPlace ? placeName(contextualPlace) : currentObjective.title}</strong>
              <small>{contextualPlace ? contextualPlace === "nera" ? tr("Talk to Nera") : tr("Read this place") : progress.quest.state === "available" ? tr("Talk to Nera") : progress.story.stage === "expedition" && progress.quest.state === "mine"
                ? tr("{0} / {1} diamonds", { 0: Math.min(progress.quest.diamonds, progress.quest.goal), 1: progress.quest.goal })
                : distance !== null ? tr("{0} blocks away", { 0: distance }) : tr("Complete")}</small>
            </span>
            <ArrowRight size={20} />
          </button>
          </div></div>
        </>
      )}
      <p className="ml-notice" role="status" aria-live="polite">
        {!sheet && (notice || (saving ? tr("Saving your action…") : ""))}
      </p>
      <nav className="nav-rail ml-nav" aria-label={tr("MetaLayer navigation")}><div className="rail-links">
        <button className={!sheet ? "active" : ""} onClick={close} aria-current={!sheet ? "page" : undefined}><Compass size={25} /><span>{tr("Explore")}</span></button>
        <button className={sheet === "inventory" ? "active" : ""} onClick={() => setSheet("inventory")}><Backpack size={25} /><span>{tr("Inventory")}</span></button>
        <button className={sheet === "community" || sheet === "activity" ? "active" : ""} onClick={() => { setCommunityView("quests"); setSheet("community"); }}><UsersThree size={25} /><span>{tr("Community")}</span></button>
      </div></nav>
      {sheet && (
        <Dialog
          label={
            sheet === "atlas"
              ? tr("Shared atlas")
              : sheet === "inventory"
                ? tr("Resource inventory")
                : sheet === "community"
                  ? tr("Expedition board")
                  : sheet === "parcel"
                    ? tr("Parcel detail")
                    : sheet === "activity" ? tr("Actions and NEAR proofs") : sheet === "materials" ? tr("Blocks") : sheet === "place" ? placeName(place) : tr("MetaLayer field guide")
          }
          onClose={close}
          presentation="map"
          history={false}
        >
          <div className="main-panel explore-panel ml-sheet">
            <div className="panel-heading">
              <button className="panel-back" onClick={close} aria-label={tr("Back to map")}><ArrowLeft size={20} /></button>
              <div><h1>{sheet === "community" || sheet === "activity" ? tr("Community") : sheet === "inventory" ? tr("Inventory") : sheet === "atlas" ? tr("Shared atlas") : sheet === "materials" ? tr("Blocks") : sheet === "parcel" ? tr("Land and building") : sheet === "place" ? tr("MetaLayer") : tr("MetaLayer field guide")}</h1></div>
              <button className="panel-close" onClick={close} aria-label={tr("Close")}><X size={18} /></button>
            </div>
            {(sheet === "community" || sheet === "activity") && <ScreenTabs sticky={false} withPanel={false} label={tr("Community")} value={sheet === "activity" ? "proofs" : communityView}
              tabs={[{ id: "quests", label: tr("Quests"), icon: Compass }, { id: "journal", label: tr("Field journal"), icon: Backpack }, { id: "proofs", label: tr("On chain"), icon: Cube }]}
              onChange={view => { if (view === "proofs") setSheet("activity"); else { setCommunityView(view); setSheet("community"); } }} />}
            {notice && <p className="ml-sheet-error" role="alert">{notice}</p>}
            {sheet === "activity" && <LayerActivity layer={layer.id} />}
            {sheet === "place" && progress && <PlacePanel id={place} progress={progress} position={position} busy={saving} demoActors={!!layer.demoActors}
              onFace={facePlace} onPlace={openPlace} onStory={showQuests} onStart={() => void startQuest()} onInteract={body => interactRef.current(body)}
              onObjective={faceObjective} onBuild={buildFreely} onActivity={() => setSheet("activity")} />}
            {sheet === "materials" && <div className="ml-palette" role="radiogroup" aria-label={tr("Blocks")}>{BUILD_BLOCKS.map(b => <button className="secondary-button" key={b} role="radio" aria-checked={block === b} aria-label={blockName(b)} onClick={() => { setBlock(b); close(); }}><span style={{ background: cssColor(b) }} /><span>{blockName(b)}</span></button>)}</div>}
            {sheet === "help" && (
              <>
                <div className="ml-sheet-hero">
                  <img src={STARTER_SPRITE} alt="" />
                  <h2>{tr("Welcome to MetaLayer")}</h2>
                </div>
                <p>
                  {tr(
                    "Meet on the square, build together and follow the beam into Crystal Hollow.",
                  )}
                </p>
                <ul>
                  <li>
                    {tr(
                      "Walk with the stick or arrows. Left and right turn your explorer.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Hold on a natural block to mine it. Pick Build to place blocks on the square.",
                    )}
                  </li>
                  <li>
                    {tr(
                      "Everyone shares discoveries, tunnels and diamond veins.",
                    )}
                  </li>
                </ul>
                <button className="primary-button ml-wide" onClick={close}>
                  {tr("Let's explore")}
                </button>
              </>
            )}
            {sheet === "community" && progress && <StoryBoard view={communityView} progress={progress} position={position} busy={saving}
              onStart={() => void startQuest()} onInteract={body => interactRef.current(body)} onFace={faceObjective}
              onBuild={buildFreely} onActivity={() => setSheet("activity")} />}
            {sheet === "community" && communityView === "journal" && progress && <Details summary={tr("Places in this world")}><PlaceDirectory progress={progress} onPlace={openPlace} /></Details>}
            {sheet === "inventory" && (
              <>
                <h2>{tr("Your resources")}</h2>
                <div className="ml-inventory">
                  <div>
                    <Diamond size={32} weight="fill" />
                    <strong>{progress?.inventory.diamonds ?? 0}</strong>
                    <span>{tr("Diamonds")}</span>
                  </div>
                  <div>
                    <Cube size={32} weight="fill" />
                    <strong>{progress?.inventory.stone ?? 0}</strong>
                    <span>{tr("Basalt")}</span>
                  </div>
                </div>
                <p>
                  {tr("These resources belong to this MetaLayer play preview.")}
                </p>
                <button className="primary-button ml-wide" onClick={() => setSheet("community")}>{tr("Continue the story")}</button>
                <div className="ml-story-actions">
                  <button className="secondary-button ml-wide" onClick={() => setSheet("activity")}>{tr("Actions and NEAR proofs")}</button>
                  <button className="secondary-button ml-wide" onClick={() => setSheet("parcel")}>{tr("Land and building")}</button>
                  <button className="secondary-button ml-wide" onClick={() => openPlace("treasury")}>{tr("MetaGold treasury")}</button>
                </div>
              </>
            )}
            {sheet === "parcel" && (
              <>
                <h2>{tr("Parcel detail")}</h2>
                <p className="ml-coordinate">
                  {Math.floor(position.x / 16) * 16},{" "}
                  {Math.floor(position.z / 16) * 16} · 16 × 16
                </p>
                <p>
                  {inPlaza(position.x, position.z)
                    ? tr(
                        "Public square. Everyone can build on its green areas.",
                      )
                    : tr(
                        "Open land. Parcel purchases need the MetaLayer contract integration.",
                      )}
                </p>
                <button
                  className="secondary-button ml-wide"
                  onClick={() => {
                    close();
                    void returnToSquare();
                  }}
                >
                  {tr("Return to the central square")}
                </button>
              </>
            )}
            {sheet === "atlas" && (
              <>
                <h2>{tr("One world, shared discoveries")}</h2>
                <p>
                  {tr(
                    "Every explorer uncovers the same map. Distant journeys keep their own coordinates.",
                  )}
                </p>
                <div className="ml-atlas-large" aria-busy={mapBusy}>
                  <Minimap
                    tiles={mapTiles}
                    x={position.x}
                    z={position.z}
                    heading={position.heading}
                    centerX={mapCenter.x}
                    centerZ={mapCenter.z}
                  />
                </div>
                <div className="ml-atlas-controls">
                  <button
                    className="map-settings-toggle"
                    onClick={() => setMapCenter((c) => ({ ...c, x: c.x - 96 }))}
                    aria-label={tr("Look west")}
                  >
                    <ArrowLeft />
                  </button>
                  <button
                    className="map-settings-toggle"
                    onClick={() => setMapCenter((c) => ({ ...c, z: c.z - 96 }))}
                    aria-label={tr("Look north")}
                  >
                    <ArrowUp />
                  </button>
                  <button
                    className="map-settings-toggle"
                    onClick={() => setMapCenter((c) => ({ ...c, z: c.z + 96 }))}
                    aria-label={tr("Look south")}
                  >
                    <ArrowDown />
                  </button>
                  <button
                    className="map-settings-toggle"
                    onClick={() => setMapCenter((c) => ({ ...c, x: c.x + 96 }))}
                    aria-label={tr("Look east")}
                  >
                    <ArrowRight />
                  </button>
                </div>
                <div className="ml-atlas-controls">
                  <button
                    onClick={() =>
                      setMapCenter({ x: position.x, z: position.z })
                    }
                  >
                    {tr("My location")}
                  </button>
                  <button onClick={() => setMapCenter({ x: 0, z: 0 })}>
                    {tr("Central square")}
                  </button>
                </div>
                <p className="ml-coordinate">
                  {Math.round(mapCenter.x)}, {Math.round(mapCenter.z)}
                </p>
                {progress && <Details summary={tr("Places in this world")}><PlaceDirectory progress={progress} onPlace={openPlace} /></Details>}
              </>
            )}
            <div className="ml-preview-note"><span className="badge">{tr("Preview")}</span><InfoTip label={tr("MetaLayer")}>{tr("Play preview. MetaGold, XP rewards, parcel NFTs and onchain settlement await integration.")}</InfoTip></div>
          </div>
        </Dialog>
      )}
    </section>,
    document.body,
  );
}
