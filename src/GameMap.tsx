import type { NearbyActor } from "./nearby-action";
import { applyGoldLook } from "./gold-emotes";
import type { GoldMap } from "./gold-spend-client";
import {
  characterMarkerMarkup,
  STARTER_SPRITE,
  wearableArtUrl,
  starterMarkerMarkup,
} from "./character-art";
import { auraEdition } from "./aura-art-data.ts";
import { loadCharacterModel } from "./character-model-client";
import { DEMO_TICK_MS, moveMapMarker } from "./map-motion";
import {
  gameObjectMarkup,
  rasterizeGameObject,
  gameObjectArtUrl,
  questObjectPresentation,
  zoneObjectPresentation,
  type GameObjectOptions,
} from "./game-object-art";
import {
  zoneCountdown,
  zoneLandmarkLabel,
  zoneLoot,
  zoneLootFeatures,
  totemHeight,
  zoneTotemFeatures,
  zoneWallFeatures,
  zoneAuraColor,
  beamFeatures,
} from "./zone-landmarks";
import type { NearbyExplorer, WornWearable } from "./types";
import type { ActorView } from "./actor-types";
import type { ActorsLayer } from "./actors-layer";
import type { MapRewardsLayer } from "./map-rewards-layer";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { distanceLabel } from "./app-bits";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./art-world";
import type { Point, World, Zone, Item } from "./types";
import { prefersReducedMotion } from "./feedback";
import { paintMapSky, skyFor, skyLabel } from "./map-sky";
import { Coins, MoonStars, Sun, SunHorizon } from "@phosphor-icons/react";
import "./map-sky.css";
// Phone map-first layout; lazy with the map, so the welcome screen skips it.
import "./phone-map.css";
import "./mobile-adventure.css";
import "./profile-community.css";
import "./secondary-surfaces.css";
import "./wearables.css";
import { tr } from "./i18n";
import type { QuestRoute } from "./quest-route";
import { mapKitUrl, questPinKind, questPinMarkup, mapGuidePoints } from "./map-kit";
import { representativeZoneQuest } from "./game-object-art-data";
import type { ZoneAltarLayer } from "./zone-altar-layer";
import "./map-kit.css";
import { questStopMarkers } from "./quest-route";
type PawnScene = ReturnType<
  typeof import("./character-3d-scene").createCharacterScene
>;
export type GameMapProps = {
  active?: boolean;
  sheetExpanded: boolean;
  panelMode: string;
  onQuest: (questId: string) => void;
  onCoin?: (coinId: string) => void;
  overview: boolean;
  focusZone: Zone | null;
  /** The one place the player should head to next (coach / nearest quest). */
  nextZoneId?: string | null;
  selectedQuestId?: string | null;
  guideRequest?: { questId: string; revision: number } | null;
  insideZoneId?: string | null;
  nativeTarget?: (Point & { label: string }) | null;
  nativeTargetKind?: "coin" | "route" | "discovery";
  playerTier?: number;
  now?: number;
  world: World | null;
  position: Point;
  arena: boolean;
  globe: boolean;
  equipped: Item[];
  others: NearbyExplorer[];
  /** Tap another explorer: open their card (what they wear, waves). */
  onPlayer?: (playerId: string) => void;
  /** Aavegotchi wearable clones the player wears (drawn on the starter). */
  wearables?: WornWearable[];
  /** Tap a wearable find: head there. */
  onWearableFind?: (coinId: string) => void;
  skinUrl?: string;
  map3D?: boolean;
  /**
   * Compass heading the explorer faces. The city demo pad sets it; real play
   * passes a reliable GPS course. Unknown direction keeps the last facing.
   */
  facing?: number;
  /** Chase view after movement/turning; independent of the initial portrait pose. */
  followBearing?: number;
  onZone: (z: Zone) => void;
  follow: boolean;
  onPan: () => void;
  /** Map centre after a player pan or zoom ends (not after follow moves). */
  onMoveEnd?: (center: Point, zoom: number) => void;
  /** Places creators pinned (visit, trail start, chest); tap opens the quest. */
  creatorPlaces?: CreatorMapPlace[];
  onCreatorPlace?: (questId: string) => void;
  /** Today's demo world for roaming NPCs and monsters; null hides them. */
  actorsWorldId?: string | null;
  onActor?: (actor: ActorView) => void;
  onNearbyActors?: (worldId: string | null, actors: NearbyActor[]) => void;
  /** GOLD spending (QGOLD stream 4): own emote and frame, lures and place pins. */
  emote?: string | null;
  frame?: string | null;
  goldMap?: GoldMap | null;
  onPlacePin?: (id: string) => void;
  /** A multi-stop walk: drawn from the explorer to the next stop and on. */
  route?: QuestRoute | null;
  /** NPCs waiting for the player's report (every step of their line done). */
  actorReports?: readonly string[];
  /** "Show me": pan to the nearest matching character (any distance). */
  actorFocus?: { revision: number; match: ActorFocusMatch } | null;
  /** The "show me" result as player text; `found` false is a notice, not an error. */
  onActorFocus?: (text: string, found: boolean) => void;
  /** Draw player tasks and Secrets near the explorer (GPS play); tap opens them in Nearby. */
  marketPins?: boolean;
  onMarketPin?: (pin: MarketMapPin) => void;
};
export type ActorFocusMatch =
  | { actorId: string }
  | { kinds: readonly string[] };
export type MarketMapPin = {
  kind: "task" | "secret";
  id: string;
  title: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Share key of a private task or Secret, so the tap can open it. */
  k?: string | null;
};
export type CreatorMapPlace = {
  questId: string;
  title: string;
  template: "visit" | "trail" | "chest";
  lat: number;
  lng: number;
};
const CREATOR_PIN_NAME = {
  get visit() { return tr("Creator place"); },
  get trail() { return tr("Creator trail"); },
  get chest() { return tr("Creator chest"); },
};
function paintQuestPin(node: HTMLElement, kind: string, fallback: GameObjectOptions) {
  node.innerHTML = questPinMarkup(kind, fallback.state);
  const image = node.querySelector("img");
  image?.addEventListener("error", () => {
    const template = document.createElement("template");
    template.innerHTML = gameObjectMarkup(fallback);
    image.replaceWith(template.content);
  }, { once: true });
}
const COIN_TIER_SCALE = ["match", ["get", "tier"], "rare", 1.45, "medium", 1.2, 1];
function phoneLayout() {
  return (
    window.innerWidth < 760 ||
    (window.innerWidth <= 1000 && window.innerHeight <= 500)
  );
}
// Aura art is loaded once per edition and drawn as a loot token (a rarity
// ring around the item) so it reads as something to pick up, not an explorer.
const LOOT_RING = {
  common: "#7f9a86",
  rare: "#3f8cff",
  epic: "#9b4dff",
  legendary: "#f3bd54",
} as Record<string, string>;
/**
 * Adds a map icon for a game object: the dropped-in art/objects/<kind> image
 * when there is one (drawn at 32 CSS px), else the authored pixel raster.
 */
function addObjectImage(m: maplibregl.Map, name: string, kind: "coin" | "discovery") {
  const url = gameObjectArtUrl(kind);
  const fallback = () => !m.hasImage(name) && m.addImage(name, rasterizeGameObject({ kind }));
  if (!url) return void fallback();
  const img = new Image();
  img.onload = () => {
    try {
      const ratio = 4,
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32 * ratio;
      const g = canvas.getContext("2d")!;
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (!m.hasImage(name)) m.addImage(name, g.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    } catch {
      fallback();
    }
  };
  img.onerror = fallback;
  img.src = url;
}
const lootImageLoads = new WeakMap<maplibregl.Map, Map<string, Promise<void>>>();
function ensureLootImages(
  m: maplibregl.Map,
  loot: { image: string; src?: string; rarity?: string }[],
) {
  let loads = lootImageLoads.get(m);
  if (!loads) lootImageLoads.set(m, (loads = new Map()));
  const pending: Promise<void>[] = [];
  for (const item of loot) {
    if (!item.src || m.hasImage(item.image)) continue;
    let load = loads.get(item.image);
    if (!load) {
      load = new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const ratio = Math.min(2, window.devicePixelRatio || 1),
              size = 56,
              canvas = document.createElement("canvas");
            canvas.width = canvas.height = Math.round(size * ratio);
            const g = canvas.getContext("2d")!;
            g.scale(ratio, ratio);
            g.beginPath();
            g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
            g.fillStyle = "#fcfaffee";
            g.fill();
            g.lineWidth = 4;
            g.strokeStyle = LOOT_RING[item.rarity || ""] || LOOT_RING.common;
            g.stroke();
            g.drawImage(img, 12, 8, 32, 37);
            if (!m.hasImage(item.image))
              m.addImage(
                item.image,
                g.getImageData(0, 0, canvas.width, canvas.height),
                { pixelRatio: ratio },
              );
          } catch {}
          resolve();
        };
        img.onerror = () => resolve();
        img.src = item.src!;
      });
      loads.set(item.image, load);
    }
    pending.push(load);
  }
  return Promise.all(pending);
}
function skinFallback(node: HTMLElement, _color?: string) {
  const image = node.querySelector("img");
  image?.addEventListener(
    "error",
    () => {
      image.src = STARTER_SPRITE;
      image.className = "starter-player";
      image.alt = tr("Aavegotchi starter appearance");
      node.setAttribute(
        "aria-label",
        (node.getAttribute("aria-label") || "Explorer") +
          " · original appearance unavailable",
      );
    },
    { once: true },
  );
}
export function GameMap(props: GameMapProps) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    avatar = useRef<maplibregl.Marker | null>(null),
    labels = useRef<maplibregl.Marker[]>([]),
    lootRevision = useRef(0);
  const altars = useRef<ZoneAltarLayer | null>(null);
  const pawn = useRef<PawnScene | null>(null),
    heading = useRef(180);
  const wasOverview = useRef(props.overview);
  const latest = useRef(props);
  latest.current = props;
  const objectContext = {
    now: props.now ?? Date.now(),
    playerTier: props.playerTier,
  };
  const zoneArtKey = JSON.stringify(
    props.world?.zones.map((z) =>
      zoneObjectPresentation(z, props.world!.quests, objectContext),
    ),
  );
  const questArtKey = JSON.stringify(
    props.world?.quests.map((q) => questObjectPresentation(q, objectContext)),
  );
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  // Real day and night at the player's position; re-checked every minute.
  const [skyTick, setSkyTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setSkyTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const sky = skyFor(props.position, props.now ?? skyTick);
  const skyRef = useRef(sky);
  skyRef.current = sky;
  useEffect(() => {
    if (ready && map.current) paintMapSky(map.current, sky.phase);
  }, [ready, sky.phase]);
  const skyText = skyLabel(sky, props.now ?? skyTick);
  // Map rewards: the next coin wave in this world, in its local time.
  const nextWaveAt = props.world?.mapRewards?.nextWaveAt;
  const nextWaveText =
    nextWaveAt && nextWaveAt > (props.now ?? skyTick)
      ? new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: props.world?.timezone || undefined,
        }).format(nextWaveAt)
      : null;
  const [viewportRevision, setViewportRevision] = useState(0);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportRevision((v) => v + 1));
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    };
  }, []);
  const equipmentKey =
    props.equipped.map((i) => `${i.id}:${i.color}:${i.slot}`).join("|") +
    "#" +
    (props.wearables || []).map((w) => w.id).join(",");
  useEffect(() => {
    const m = map.current,
      target = props.nativeTarget;
    if (!m || !ready || !target || props.globe) return;
    const node = document.createElement("div");
    node.className = "native-target-pin";
    if (props.nativeTargetKind === "coin") node.innerHTML = gameObjectMarkup({ kind: "coin", selected: true });
    else paintQuestPin(node, props.nativeTargetKind === "route" ? "trail" : "visit", { kind: props.nativeTargetKind || "discovery", selected: true });
    const targetText = document.createElement("span");
    targetText.textContent = target.label;
    node.append(targetText);
    const marker = new maplibregl.Marker({ element: node, anchor: "bottom" })
      .setLngLat([target.lng, target.lat])
      .addTo(m);
    if (!props.follow && props.active !== false)
      m.easeTo({
        center: [target.lng, target.lat],
        zoom: 17,
        pitch: 43,
        offset: cameraOffset(),
        duration: prefersReducedMotion()
          ? 0
          : 400,
      });
    return () => {
      marker.remove();
    };
    // Layout changes keep a deliberately selected stop outside the sheet. Manual
    // pan changes follow but must not itself trigger another camera movement.
  }, [
    ready,
    props.nativeTarget?.lat,
    props.nativeTarget?.lng,
    props.nativeTargetKind,
    props.globe,
  ]);
  useEffect(() => {
    if (!el.current) return;
    let gone = false;
    const m = new maplibregl.Map({
      container: el.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [props.position.lng, props.position.lat],
      zoom: 16.9,
      pitch: 43,
      bearing: -14,
      maxPitch: 60,
      attributionControl: false,
    });
    map.current = m;
    // Network completion precedes vector-tile worker rendering. Expose the
    // actual map idle state for local visual review and integration journeys.
    const renderState = (state: string) => { m.getContainer().dataset.mapRenderState = state; };
    m.on("movestart", () => renderState("moving"));
    m.on("sourcedataloading", () => renderState("loading"));
    m.on("idle", () => renderState("idle"));
    m.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        // Quest places come from the POI database (docs/POI-PIPELINE.md);
        // ODbL asks for this notice wherever produced content is shown.
        customAttribution:
          "Places © OpenStreetMap contributors (ODbL), Overture Maps, Wikidata, GeoNames",
      }),
      "bottom-right",
    );
    // Start the notice collapsed to its (i) button so it never covers the
    // map or the sheet; one tap opens it.
    m.once("load", () =>
      m
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show"),
    );
    const marker = document.createElement("div");
    marker.className = "player-marker";
    marker.innerHTML = starterMarkerMarkup();
    avatar.current = new maplibregl.Marker({
      element: marker,
      anchor: "bottom",
    })
      .setLngLat([props.position.lng, props.position.lat])
      .addTo(m);
    m.on("dragstart", () => latest.current.onPan());
    // Only moves the player made (drag, pinch, wheel), not camera follow.
    // Read the centre once a drag's inertia has settled.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const ended = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (map.current !== m) return;
        const c = m.getCenter();
        latest.current.onMoveEnd?.({ lat: c.lat, lng: c.lng }, m.getZoom());
      }, 700);
    };
    m.on("dragend", ended);
    m.on("zoomend", ended);
    // Screen pixels per metre of height, so zone pins sit on their totems.
    const totemScale = () => {
      const metresPerPixel =
        (40075016.686 * Math.cos((m.getCenter().lat * Math.PI) / 180)) /
        (512 * 2 ** m.getZoom());
      el.current?.style.setProperty(
        "--zone-px-per-m",
        ((Math.sin((m.getPitch() * Math.PI) / 180) / metresPerPixel) * 1.08).toFixed(3) + "px",
      );
    };
    totemScale();
    m.on("move", totemScale);
    m.on("click", (e) => {
      if (
        latest.current.onCoin &&
        !latest.current.globe &&
        m.getLayer("coin-icons")
      ) {
        const coins = m.queryRenderedFeatures(
          [
            [e.point.x - 24, e.point.y - 24],
            [e.point.x + 24, e.point.y + 24],
          ],
          { layers: ["coin-icons"] },
        );
        const closest = coins
          .filter((c) => c.geometry.type === "Point")
          .sort((a, b) => {
            const pa = m.project(
                (a.geometry as { type: "Point"; coordinates: [number, number] })
                  .coordinates as [number, number],
              ),
              pb = m.project(
                (b.geometry as { type: "Point"; coordinates: [number, number] })
                  .coordinates as [number, number],
              );
            return (
              Math.hypot(pa.x - e.point.x, pa.y - e.point.y) -
              Math.hypot(pb.x - e.point.x, pb.y - e.point.y)
            );
          })[0];
        if (closest?.properties?.id) {
          latest.current.onCoin(String(closest.properties.id));
          return;
        }
      }
      // No tap-to-walk: real play moves with GPS, the demo with its pad.
    });
    m.on("error", () => {
      if (!gone) setError(true);
    });
    m.once("load", () => {
      if (gone) return;
      const style = m.getStyle();
      for (const layer of style.layers as any[]) {
        try {
          if (
            layer.type === "symbol" &&
            !["transportation_name", "water_name", "place"].includes(
              layer["source-layer"],
            )
          )
            m.setLayoutProperty(layer.id, "visibility", "none");
        } catch {}
      }
      const building = style.layers.find(
        (l) => (l as any)["source-layer"] === "building",
      );
      if (building && "source" in building)
        m.addLayer({
          id: "aura-buildings",
          type: "fill-extrusion",
          source: building.source as string,
          "source-layer": "building",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": "#d3c9d7",
            "fill-extrusion-height": [
              "min",
              16,
              ["coalesce", ["get", "render_height"], 6],
            ],
            "fill-extrusion-opacity": 0.68,
          },
        });
      // Day, dusk or night from the real sun at the player (src/map-sky.ts).
      paintMapSky(m, skyRef.current.phase);
      addObjectImage(m, "gold-coin", "coin");
      addObjectImage(m, "street-find", "discovery");
      m.addSource("zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": ["case", ["get", "inside"], 0.08, ["get", "lit"], 0.055, 0.025],
        },
      });
      // Ground aura: a soft glow along the edge, under the dashed outline.
      m.addLayer({
        id: "zones-glow",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 6, 18, 22],
          "line-blur": ["interpolate", ["linear"], ["zoom"], 14, 5, 18, 18],
          "line-opacity": ["case", ["get", "inside"], 0.95, ["get", "lit"], 0.55, 0.18],
        },
      });
      m.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "inside"], 4, 2],
          "line-opacity": 0.7,
        },
      });
      // Ordered objective guidance, explicitly dashed and labelled as non-routed.
      // Geometry is not pedestrian connectivity (src/quest-route.ts).
      m.addSource("quest-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "quest-route-glow",
        type: "line",
        source: "quest-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#441c6c",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 6, 18, 12],
          "line-opacity": 0.32,
          "line-dasharray": [1.2, 1.6],
        },
      });
      m.addLayer({
        id: "quest-route-line",
        type: "line",
        source: "quest-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["get", "next"], "#bda4ff", "#e1d5ff"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 3.5, 18, 8],
          "line-dasharray": [1.2, 1.6],
          "line-opacity": ["case", ["get", "next"], 1, 0.7],
        },
      });
      const chevron = new Image();
      chevron.onload = () => {
        if (gone || m.hasImage("map-kit-chevron")) return;
        m.addImage("map-kit-chevron", chevron, { pixelRatio: 4 });
        m.addLayer({
          id: "quest-route-arrows", type: "symbol", source: "quest-route", minzoom: 14,
          layout: {
            "symbol-placement": "line", "symbol-spacing": 90,
            "icon-image": "map-kit-chevron", "icon-size": 0.8,
            "icon-rotation-alignment": "map", "icon-rotate": 90, "icon-keep-upright": false,
            "icon-allow-overlap": true, "icon-ignore-placement": true,
          },
        }, m.getLayer("coin-icons") ? "coin-icons" : undefined);
      };
      chevron.src = mapKitUrl("navigation/chevron.png");
      // Zone landmarks (src/zone-landmarks.ts): wall, totem and the items inside.
      for (const id of ["zone-walls", "zone-totems", "zone-loot", "find-beams"])
        m.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      // Roofless fallback: the same authoritative boundary as a ground line.
      // The shared WebGL layer supplies the open sky curtains above it.
      m.addLayer({ id: "zone-walls", type: "line", source: "zone-walls", minzoom: 11.5,
        layout: {"line-cap":"round","line-join":"round"},
        paint: {"line-color":["get","color"],"line-width":1.5,"line-opacity":.55},
      });
      m.addLayer({
        id: "zone-totems",
        type: "fill-extrusion",
        source: "zone-totems",
        minzoom: 13,
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-opacity": 0.92,
        },
      });
      // Street finds keep a short glint. High open boundary curtains, rather
      // than central columns, are the long-distance zone signal.
      for (const [source, minzoom] of [
        ["find-beams", 13],
      ] as const)
        for (const part of ["halo", "core"] as const)
          m.addLayer({
            id: `${source}-${part}`,
            type: "fill-extrusion",
            source,
            minzoom,
            filter: ["==", ["get", "part"], part],
            paint: {
              "fill-extrusion-color": ["get", "color"],
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["get", "base"],
              "fill-extrusion-opacity": part === "core" ? 0.4 : 0.1,
              "fill-extrusion-vertical-gradient": false,
            },
          });
      m.addLayer({
        id: "zone-loot",
        type: "symbol",
        source: "zone-loot",
        minzoom: 14,
        layout: {
          "icon-image": ["get", "image"],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0.55,
            16,
            0.9,
            18,
            1.2,
            19,
            1.35,
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": ["case", ["get", "dim"], 0.5, 1] },
      });
      m.addSource("coins", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "coin-icons",
        type: "symbol",
        source: "coins",
        minzoom: 14,
        layout: {
          "icon-image": [
            "case",
            ["==", ["get", "find"], true],
            "street-find",
            "gold-coin",
          ],
          // Medium and rare coins (map rewards) are drawn bigger. Zoom must
          // stay the top-level interpolate input.
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            ["*", 0.45, COIN_TIER_SCALE],
            17,
            ["*", 0.8, COIN_TIER_SCALE],
            19,
            ["*", 1.05, COIN_TIER_SCALE],
          ] as any,
          "icon-allow-overlap": true,
        },
      });
      setError(false);
      setReady(true);
    });
    return () => {
      gone = true;
      labels.current.forEach((x) => x.remove());
      avatar.current?.remove();
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, []);
  // Coins get their own effect: re-sending them on every zone or overview
  // change was the map's heaviest upload on a phone.
  const coins = props.world?.coins;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !coins) return;
    (m.getSource("coins") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: coins.map((c) => ({
        type: "Feature",
        properties: { id: c.id, find: !!c.find, tier: c.tier || "small" },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
    });
    (m.getSource("find-beams") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: beamFeatures(
        coins
          .filter((c) => c.find && !c.claimant)
          .map((c) => ({ id: c.id, lat: c.lat, lng: c.lng, color: "#ff1dff", kind: "find" as const })),
      ),
    } as Parameters<GeoJSONSource["setData"]>[0]);
  }, [coins, ready]);
  // Wearable finds: the actual Aavegotchi wearable, floating in a rarity ring.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !coins) return;
    const finds = coins.filter((c) => c.wearable && !c.claimant).slice(0, 24);
    if (!finds.length) return;
    const markers = finds.map((c) => {
      const w = c.wearable!;
      const node = document.createElement("button");
      node.type = "button";
      node.className = `wearable-find-marker rarity-${w.rarity}`;
      node.setAttribute(
        "aria-label",
        tr("Wearable find: {0}", { 0: w.name }),
      );
      node.title = w.name;
      const img = document.createElement("img");
      img.src = wearableArtUrl(w.id);
      img.alt = "";
      img.draggable = false;
      img.loading = "lazy";
      node.append(img);
      node.addEventListener("click", (event) => {
        event.stopPropagation();
        latest.current.onWearableFind?.(c.id);
      });
      return new maplibregl.Marker({ element: node, anchor: "bottom", offset: [0, -14] })
        .setLngLat([c.lng, c.lat])
        .addTo(m);
    });
    // Far out the map shows cities, not single items.
    const zoomed = () => {
      const hide = m.getZoom() < 13.5;
      for (const marker of markers)
        marker.getElement().classList.toggle("is-far", hide);
    };
    zoomed();
    m.on("zoomend", zoomed);
    return () => {
      m.off("zoomend", zoomed);
      markers.forEach((marker) => marker.remove());
    };
  }, [coins, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.world) return;
    const zoneNow = objectContext.now,
      zoneQuests = props.world.quests;
    (m.getSource("zones") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: props.world.zones.map((z) => ({
        type: "Feature",
        properties: {
          color: zoneAuraColor(z.tier),
          inside: z.id === props.insideZoneId,
          lit: zoneCountdown(z, zoneQuests, zoneNow).phase === "open",
        },
        geometry: z.geometry || {
          type: "Polygon",
          coordinates: [
            Array.from({ length: 49 }, (_, i) => {
              const a = (i / 48) * Math.PI * 2;
              return [
                z.lng +
                  (Math.cos(a) * z.radius) /
                    (111320 * Math.cos((z.lat * Math.PI) / 180)),
                z.lat + (Math.sin(a) * z.radius) / 111320,
              ];
            }),
          ],
        },
      })),
    });
    const collection = (features: unknown[]) =>
      ({ type: "FeatureCollection", features }) as Parameters<GeoJSONSource["setData"]>[0];
    (m.getSource("zone-walls") as GeoJSONSource)?.setData(
      collection(zoneWallFeatures(props.world.zones, zoneQuests, zoneNow)),
    );
    (m.getSource("zone-totems") as GeoJSONSource)?.setData(
      collection(zoneTotemFeatures(props.world.zones, zoneQuests, objectContext)),
    );
    const lootFeatures = zoneLootFeatures(
      props.world.zones,
      zoneQuests,
      zoneNow,
    );
    const lootRun = ++lootRevision.current;
    void ensureLootImages(
      m,
      props.world.zones.flatMap((z) => zoneLoot(z, zoneQuests)),
    ).then(() => {
      if (lootRun !== lootRevision.current || map.current !== m) return;
      (m.getSource("zone-loot") as GeoJSONSource | undefined)?.setData(
        collection(lootFeatures),
      );
    });
    labels.current.forEach((x) => x.remove());
    labels.current = [];
    for (const z of props.world.zones) {
      const wrap = document.createElement("div");
      const node = document.createElement("button");
      const art = zoneObjectPresentation(z, props.world.quests, objectContext);
      const selected = props.focusZone?.id === z.id;
      const next = !selected && props.nextZoneId === z.id;
      const countdown = zoneCountdown(z, zoneQuests, zoneNow);
      wrap.className = `zone-totem-marker tier-${z.tier} phase-${countdown.phase}${props.overview ? " map-overview" : ""}${props.globe ? " hidden" : ""}`;
      node.className = `zone-map-pin game-object-map-pin tier-${z.tier}${next ? " zone-map-pin-next" : ""}${props.overview ? " map-overview-pin" : ""}`;
      node.dataset.zoneId = z.id;
      node.style.setProperty("--zone-aura", zoneAuraColor(z.tier));
      node.style.borderColor = zoneAuraColor(z.tier);
      node.title = `${z.name} · ${art.label}${next ? " · next quest" : ""}`;
      const detail = zoneLandmarkLabel(z, zoneQuests, zoneNow);
      node.setAttribute("aria-label", `${node.title}${detail ? ` · ${detail}` : ""}`);
      node.setAttribute("aria-pressed", String(selected));
      const zoneQuest = props.world.quests.find(q => q.id === props.selectedQuestId && q.zone_id === z.id) || representativeZoneQuest(z, props.world.quests, objectContext);
      paintQuestPin(node, questPinKind(zoneQuest), { ...art, selected });
      if (next) {
        node.dataset.next = "true";
        const tag = document.createElement("i");
        tag.className = "zone-map-pin-next-label";
        tag.setAttribute("aria-hidden", "true");
        tag.textContent = tr("Next quest");
        node.append(tag);
      }
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onZone(z);
      });
      const chip = document.createElement("span");
      chip.className = "zone-countdown";
      chip.setAttribute("aria-hidden", "true");
      chip.dataset.zoneId = z.id;
      chip.textContent = countdown.text;
      chip.hidden = !countdown.text;
      const stem = document.createElement("span");
      stem.className = "zone-totem-stem";
      stem.setAttribute("aria-hidden", "true");
      wrap.style.setProperty("--totem-h", String(totemHeight(z.tier)));
      wrap.append(node, stem, chip);
      labels.current.push(
        new maplibregl.Marker({ element: wrap, anchor: "bottom" })
          .setLngLat([z.lng, z.lat])
          .addTo(m),
      );
    }
  }, [props.insideZoneId,
    props.world,
    ready,
    props.overview,
    props.globe,
    props.focusZone?.id,
    props.nextZoneId,
    props.selectedQuestId,
    zoneArtKey,
  ]);
  // Lazy shared-context GLBs. Mount once; individual failures keep the extrusion.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let gone = false;
    const sync = () => {
      const p = latest.current;
      altars.current?.update({ zones: p.world?.zones || [], quests: p.world?.quests || [], now: p.now ?? Date.now(), playerTier: p.playerTier, visible: !p.globe, selectedQuestId: p.selectedQuestId });
    };
    import("./zone-altar-layer").then(({ attachZoneAltars }) => {
      if (gone) return;
      altars.current = attachZoneAltars(m); sync();
    }).catch(() => {});
    return () => { gone = true; altars.current?.destroy(); altars.current = null; };
  }, [ready]);
  useEffect(() => {
    altars.current?.update({ zones: props.world?.zones || [], quests: props.world?.quests || [], now: objectContext.now, playerTier: props.playerTier, visible: !props.globe, selectedQuestId: props.selectedQuestId });
  }, [ready, props.world, zoneArtKey, props.globe, props.playerTier, props.selectedQuestId]);
  // Countdown chips tick with the app clock; only their text changes.
  useEffect(() => {
    const world = props.world;
    if (!world || !ready) return;
    const now = props.now ?? Date.now();
    for (const marker of labels.current) {
      const chip = marker
        .getElement()
        .querySelector<HTMLElement>(".zone-countdown");
      const zone = chip && world.zones.find((z) => z.id === chip.dataset.zoneId);
      if (!chip || !zone) continue;
      const text = zoneCountdown(zone, world.quests, now).text;
      if (chip.textContent !== text) chip.textContent = text;
      chip.hidden = !text;
    }
  }, [props.now, props.world, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const markers = props.others.map((p) => {
      const node = document.createElement("div");
      node.className = "other-player-marker";
      const look = p.appearance;
      node.innerHTML = characterMarkerMarkup({
        color: look?.color || p.color,
        above: look?.above,
        below: look?.below,
        skinUrl: look?.skinTokenId
          ? `/api/presence/skin?playerId=${encodeURIComponent(p.id)}`
          : undefined,
        wearables: look?.wearables,
      });
      if (look?.wearables?.some((w) => w.verified)) {
        const check = document.createElement("i");
        check.className = "verified-check";
        check.title = tr("Verified original");
        node.append(check);
      }
      // A button: tapping an explorer opens their card.
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      const open = (event: Event) => {
        event.stopPropagation();
        latest.current.onPlayer?.(p.id);
      };
      node.addEventListener("click", open);
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(event);
        }
      });
      node.setAttribute(
        "aria-label",
        p.name +
          (look?.source === "unavailable"
            ? " · appearance temporarily unavailable"
            : " · nearby explorer") +
          " · " +
          tr("Open explorer card"),
      );
      const label = document.createElement("span");
      label.textContent = p.name;
      node.append(label);
      skinFallback(node, look?.color || p.color);
      applyGoldLook(node, look?.gold && (look.gold.emoteUntil ?? 0) > Date.now() ? look.gold : { frame: look?.gold?.frame });
      return new maplibregl.Marker({ element: node, anchor: "bottom" })
        .setLngLat([p.lng, p.lat])
        .addTo(m);
    });
    return () => markers.forEach((m) => m.remove());
  }, [props.others, ready]);
  // Today's coins per area (heatmap, counts, pioneer gold fog): own chunk.
  const rewardsLayer = useRef<MapRewardsLayer | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let gone = false;
    import("./map-rewards-layer")
      .then(({ attachMapRewardsLayer }) => {
        if (gone || rewardsLayer.current) return;
        rewardsLayer.current = attachMapRewardsLayer(m);
        rewardsLayer.current.setVisible(!latest.current.overview && !latest.current.globe);
      })
      .catch(() => {});
    return () => {
      gone = true;
      rewardsLayer.current?.destroy();
      rewardsLayer.current = null;
    };
  }, [ready]);
  // City overview is about actual zones; the coin-cell fog returns when
  // leaving it. This prevents its gold tint being mistaken for a gold zone.
  useEffect(() => {
    rewardsLayer.current?.setVisible(!props.overview && !props.globe);
  }, [ready, props.overview, props.globe]);
  useEffect(() => {
    if (props.active === false) map.current?.stop();
  }, [props.active, ready]);
  // Roaming NPCs and monsters: a separate chunk, loaded once the map is up.
  const actorsLayer = useRef<ActorsLayer | null>(null);
  const actorsEnabled = !!props.onActor && !!props.actorsWorldId && props.active !== false;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !actorsEnabled) return;
    let gone = false;
    import("./actors-layer")
      .then(({ attachActorsLayer }) => {
        if (gone) return;
        actorsLayer.current = attachActorsLayer(m, {
          onSelect: (a) => latest.current.onActor?.(a),
          onNearby: actors => { if (!gone) latest.current.onNearbyActors?.(latest.current.actorsWorldId || null, actors); },
        });
        const p = latest.current;
        actorsLayer.current.update({
          worldId: p.actorsWorldId || null,
          position: p.position,
          visible: !p.globe,
          reports: p.actorReports,
        });
      })
      .catch(() => {});
    return () => {
      gone = true;
      actorsLayer.current?.destroy();
      actorsLayer.current = null;
    };
  }, [ready, actorsEnabled]);
  const reportsKey = (props.actorReports || []).join(",");
  useEffect(() => {
    actorsLayer.current?.update({
      worldId: props.actorsWorldId || null,
      position: props.position,
      visible: !props.globe,
      reports: props.actorReports,
    });
  }, [props.actorsWorldId, props.position.lat, props.position.lng, props.globe, reportsKey]);
  useEffect(() => {
    const request = props.actorFocus;
    if (!ready || !request) return;
    const { match } = request;
    // The layer may still be attaching or loading the cast (e.g. right after a
    // sheet closed): retry for a few seconds before saying nobody is out.
    let tries = 0, timer = 0;
    const attempt = () => {
      const m = map.current;
      if (!m) return;
      const found = actorsLayer.current?.find((a) =>
        "actorId" in match ? a.id === match.actorId : match.kinds.includes(a.archetype),
      );
      if (!found && ++tries < 12) {
        timer = window.setTimeout(attempt, 500);
        return;
      }
      latest.current.onActorFocus?.(
        found
          ? tr("{0}: {1}. Marked on the map.", { 0: found.actor.name, 1: distanceLabel(found.distanceM) })
          : "actorId" in match
            ? tr("They are not out right now. Characters walk between 07:00 and 22:00.")
            : tr("Nobody like that is out near you right now. Characters walk between 07:00 and 22:00."),
        !!found,
      );
      if (!found) return;
      latest.current.onPan();
      m.easeTo({
        center: [found.lng, found.lat],
        zoom: Math.max(m.getZoom(), 16),
        duration: prefersReducedMotion() ? 0 : 900,
      });
    };
    attempt();
    return () => window.clearTimeout(timer);
    // Only the revision triggers a new "show me".
  }, [props.actorFocus?.revision, ready]);
  // Player tasks and Secrets around the explorer (~55 m steps, like Nearby).
  const [marketPins, setMarketPins] = useState<MarketMapPin[]>([]);
  const marketLat = Math.round(props.position.lat * 2000) / 2000,
    marketLng = Math.round(props.position.lng * 2000) / 2000,
    marketOn = !!props.marketPins && !props.globe;
  useEffect(() => {
    if (!marketOn) { setMarketPins([]); return; }
    const controller = new AbortController();
    type Near = { lat: number; lng: number; id: string; title: string; state: string; radiusM: number; linkKey?: string | null };
    api<{ tasks: Near[]; forMe: Near[]; taking: Near[]; secrets: (Omit<Near, "lat" | "lng" | "radiusM"> & { fog: Point & { radiusM: number } })[] }>(
      `/market/nearby?lat=${marketLat}&lng=${marketLng}`, undefined, { signal: controller.signal },
    )
      .then((r) => {
        const tasks = new Map<string, MarketMapPin>();
        for (const t of [...r.taking, ...r.forMe, ...r.tasks])
          if (t.state === "open" && !tasks.has(t.id))
            tasks.set(t.id, { kind: "task", id: t.id, title: t.title, lat: t.lat, lng: t.lng, radiusM: t.radiusM, k: t.linkKey });
        setMarketPins([
          ...tasks.values(),
          ...r.secrets.filter((x) => x.state === "open").map((x) => ({ kind: "secret" as const, id: x.id, title: x.title, lat: x.fog.lat, lng: x.fog.lng, radiusM: x.fog.radiusM, k: x.linkKey })),
        ].slice(0, 40));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [marketOn, marketLat, marketLng]);
  const marketKey = JSON.stringify(marketPins);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || props.globe || !marketPins.length) return;
    const markers = marketPins.map((pin) => {
      const node = document.createElement("button");
      const kindLabel = pin.kind === "task" ? tr("Player task") : tr("Secret");
      node.className = `quest-map-pin game-object-map-pin market-map-pin market-map-pin-${pin.kind}`;
      node.setAttribute("aria-label", `${pin.title} · ${kindLabel}`);
      node.title = `${pin.title} · ${kindLabel}`;
      paintQuestPin(node, pin.kind === "task" ? "task" : "clue", { kind: "place" });
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const hash = `${pin.kind}=${encodeURIComponent(pin.id)}${pin.k ? `&k=${encodeURIComponent(pin.k)}` : ""}`;
        // The same pin twice: the hash does not change, so announce it again.
        if (location.hash === `#${hash}`) dispatchEvent(new HashChangeEvent("hashchange"));
        else location.hash = hash;
        latest.current.onMarketPin?.(pin);
      });
      return new maplibregl.Marker({ element: node, anchor: "bottom" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(m);
    });
    return () => markers.forEach((x) => x.remove());
  }, [ready, props.globe, marketKey]);
  function cameraOffset(): [number, number] {
    // Leave room ahead; overlay height never changes this framing.
    return props.follow && Number.isFinite(props.followBearing) ? [0, Math.min(72, (el.current?.clientHeight || 0) * 0.1)] : [0, 0];
  }
  useEffect(() => {
    if (!avatar.current) return;
    if (props.facing !== undefined && Number.isFinite(props.facing)) heading.current = props.facing;
    const m = map.current;
    if (m && !props.globe)
      pawn.current?.setMapView(m.getBearing(), m.getPitch(), heading.current);
    return moveMapMarker(avatar.current, props.position, {
      reducedMotion: props.active === false || prefersReducedMotion(),
      // Demo pad steps arrive every tick; glide one tick so they join up.
      duration: props.arena && props.facing !== undefined ? DEMO_TICK_MS + 30 : 450,
    });
  }, [props.position.lat, props.position.lng, props.active, ready]);
  useEffect(() => {
    if (props.facing === undefined || !Number.isFinite(props.facing)) return;
    heading.current = props.facing;
    const m = map.current;
    if (m && !props.globe)
      pawn.current?.setMapView(m.getBearing(), m.getPitch(), heading.current);
  }, [props.facing, ready]);
  useEffect(() => {
    if (!map.current) return;
    const leavingOverview = wasOverview.current && !props.overview;
    wasOverview.current = props.overview;
    const demoGlide = props.arena && props.facing !== undefined;
    if (props.active !== false && props.follow && !props.globe && !props.overview)
      map.current.easeTo({
        center: [props.position.lng, props.position.lat],
        ...(Number.isFinite(props.followBearing) ? { bearing: props.followBearing } : {}),
        ...(leavingOverview ? { zoom: 16.9, pitch: 43 } : {}),
        offset: cameraOffset(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: leavingOverview || prefersReducedMotion()
          ? 0
          : demoGlide
            ? DEMO_TICK_MS + 30
            : 450,
        ...(demoGlide ? { easing: (t: number) => t } : {}),
      });
  }, [
    props.position.lat,
    props.position.lng,
    props.arena ? props.position : null,
    props.follow,
    props.followBearing,
    props.active,
    props.globe,
    props.overview,
    props.sheetExpanded,
    props.panelMode,
    viewportRevision,
    ready,
  ]);
  useEffect(() => {
    if (!avatar.current) return;
    const color = props.equipped.find((i) => i.slot === "avatar")?.color;
    const top = props.equipped.find((i) => i.slot === "above"),
      bottom = props.equipped.find((i) => i.slot === "below");
    const element = avatar.current.getElement(),
      modelHost = element.querySelector(".map-character-model");
    element.setAttribute("role", "img");
    element.setAttribute(
      "aria-label",
      `${props.skinUrl ? tr("Your linked Aavegotchi") : tr("Your Aavegotchi starter")}${top ? `; ${top.name} above` : ""}${bottom ? `; ${bottom.name} below` : ""}`,
    );
    element.innerHTML =
      characterMarkerMarkup({
        color,
        above: top?.color,
        below: bottom?.color,
        aboveEdition: top && auraEdition(top),
        belowEdition: bottom && auraEdition(bottom),
        scale: 2,
        skinUrl: props.skinUrl,
        wearables: props.wearables,
      }) + `<span class="you-label">${tr("YOU")}</span>`;
    if (modelHost) element.append(modelHost);
    skinFallback(element, color);
  }, [equipmentKey, props.skinUrl, ready]);
  useEffect(() => {
    const element = avatar.current?.getElement();
    if (element) applyGoldLook(element, { emote: props.emote, frame: props.frame });
  }, [props.emote, props.frame, equipmentKey, props.skinUrl, ready]);
  // Lures (with countdowns) and place messages near the player: own chunk.
  const goldLayer = useRef<{ update: (data: GoldMap) => void; remove: () => void } | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.goldMap) return;
    let gone = false;
    const data = props.goldMap;
    if (goldLayer.current) goldLayer.current.update(data);
    else
      import("./gold-map-layer").then(({ attachGoldLayer }) => {
        if (gone || goldLayer.current) return;
        goldLayer.current = attachGoldLayer(m, (id) => latest.current.onPlacePin?.(id));
        goldLayer.current.update(data);
      });
    return () => {
      gone = true;
    };
  }, [props.goldMap, ready]);
  useEffect(
    () => () => {
      goldLayer.current?.remove();
      goldLayer.current = null;
    },
    [],
  );
  const wearing2D = !props.skinUrl && !!props.wearables?.length;
  useEffect(() => {
    const m = map.current,
      element = avatar.current?.getElement();
    // Aavegotchi wearable clones are drawn on the 2D starter only.
    if (!m || !element || !ready || props.active === false || props.map3D === false || wearing2D) return;
    const controller = new AbortController(),
      host = document.createElement("div");
    host.className = "map-character-model";
    host.setAttribute("aria-hidden", "true");
    element.append(host);
    element.dataset.characterRenderer = props.skinUrl
      ? "original-2d"
      : "official-2d";
    let active = true,
      view: PawnScene | null = null,
      paintFrame = 0;
    const show2D = () => {
      element.classList.remove("character-model-ready");
      element.dataset.characterRenderer = props.skinUrl
        ? "original-2d"
        : "official-2d";
      view?.dispose();
      if (pawn.current === view) pawn.current = null;
      view = null;
    };
    const orient = () => {
      if (!latest.current.globe)
        view?.setMapView(m.getBearing(), m.getPitch(), heading.current);
    };
    const reveal = () => {
      if (document.visibilityState === "visible") orient();
    };
    m.on("move", orient);
    m.on("resize", orient);
    window.addEventListener("focus", reveal);
    document.addEventListener("visibilitychange", reveal);
    void (async () => {
      const original = props.skinUrl?.match(/tokenId=(\d+)$/)?.[1];
      const [{ descriptor, bytes }, module] = await Promise.all([
        loadCharacterModel(original, controller.signal, { forMap: true }),
        import("./character-3d-scene"),
      ]);
      // Omit only the portrait background; unsupported character slots keep their SVG.
      if (!active || (!descriptor.complete && !descriptor.mapCompatible))
        return;
      view = module.createCharacterScene(host, bytes, {
        starter: descriptor.source === "starter",
        presentation: "map",
        onError: show2D,
      });
      pawn.current = view;
      const currentView = view;
      await currentView.ready;
      if (!active || view !== currentView) return;
      element.classList.add("character-model-ready");
      element.dataset.characterRenderer = "sdk-3d";
      orient();
      paintFrame = requestAnimationFrame(() => {
        if (active) orient();
      });
    })().catch(() => {
      if (active) show2D();
    });
    return () => {
      active = false;
      controller.abort();
      cancelAnimationFrame(paintFrame);
      m.off("move", orient);
      m.off("resize", orient);
      window.removeEventListener("focus", reveal);
      document.removeEventListener("visibilitychange", reveal);
      show2D();
      host.remove();
    };
  }, [props.skinUrl, props.map3D, props.active, wearing2D, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.resize();
    try {
      m.setProjection({ type: props.globe ? "globe" : "mercator" });
    } catch {}
    const globeBand = Math.min(
      el.current?.clientWidth || 320,
      el.current?.clientHeight || 320,
    );
    (props.globe ? m.flyTo.bind(m) : m.easeTo.bind(m))(
      props.globe
        ? {
            center: [props.position.lng, props.position.lat],
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            zoom: Math.max(
              0,
              Math.min(0.6, Math.log2(Math.max(220, globeBand) / 238)),
            ),
            pitch: 0,
            bearing: 0,
            duration: prefersReducedMotion()
              ? 0
              : 1400,
          }
        : {
            center: [props.position.lng, props.position.lat],
            offset: cameraOffset(),
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            zoom: 16.9,
            pitch: 43,
            bearing: props.follow && Number.isFinite(props.followBearing) ? props.followBearing : -14,
            duration: prefersReducedMotion()
              ? 0
              : 1400,
          },
    );
    avatar.current?.getElement().classList.toggle("hidden", props.globe);
    labels.current.forEach((l) =>
      l.getElement().classList.toggle("hidden", props.globe),
    );
  }, [props.globe, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.world) return;
    avatar.current
      ?.getElement()
      .classList.toggle("map-overview-player", props.overview);
    if (props.overview) {
      const b = new maplibregl.LngLatBounds();
      for (const z of props.world.zones)
        for (const p of z.geometry?.type === "MultiPolygon"
          ? z.geometry.coordinates.flatMap((poly) => poly[0])
          : z.geometry?.coordinates[0] || [[z.lng, z.lat]])
          b.extend(p as [number, number]);
      if (!b.isEmpty()) {
        const dx = (b.getEast() - b.getWest()) * 0.08,
          dy = (b.getNorth() - b.getSouth()) * 0.08;
        b.extend([b.getWest() - dx, b.getSouth() - dy]);
        b.extend([b.getEast() + dx, b.getNorth() + dy]);
        m.fitBounds(b, {
          padding: phoneLayout()
            ? (() => {
                const box = el.current!.getBoundingClientRect(),
                  panel = document
                    .querySelector(".main-panel")
                    ?.getBoundingClientRect();
                return window.innerWidth >= 760
                  ? {
                      top: 180,
                      bottom: 84,
                      left: 130,
                      right: panel ? box.right - panel.left + 30 : 35,
                    }
                  : {
                      top: 180,
                      bottom: panel ? box.bottom - panel.top + 35 : 100,
                      left: 30,
                      right: 30,
                    };
              })()
            : { top: 180, bottom: 100, left: 450, right: 55 },
          pitch: 35,
          bearing: 0,
          duration: prefersReducedMotion()
            ? 0
            : 650,
        });
      }
    } else if (props.focusZone && !props.follow && !props.guideRequest)
      m.easeTo({
        center: [props.focusZone.lng, props.focusZone.lat],
        offset: cameraOffset(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        zoom: 16.8,
        pitch: 43,
        duration: prefersReducedMotion()
          ? 0
          : 450,
      });
  }, [
    props.overview,
    props.focusZone?.id,
    props.guideRequest?.questId,
    ready,
    props.world?.id,
    props.sheetExpanded,
    props.panelMode,
    viewportRevision,
  ]);
  const guidePoints = props.globe ? [] : mapGuidePoints({
    position: props.position, route: props.route, target: props.nativeTarget, selectedQuestId: props.selectedQuestId,
    zone: props.focusZone || props.world?.zones.find((z) => z.id === props.nextZoneId),
    quests: props.world?.quests || [], now: objectContext.now, playerTier: props.playerTier,
  });
  const routeKey = JSON.stringify(guidePoints);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("quest-route") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: guidePoints.slice(1).map((p, i) => ({
        type: "Feature", properties: { next: i === 0 },
        geometry: { type: "LineString", coordinates: [[guidePoints[props.route?.unordered ? 0 : i].lng, guidePoints[props.route?.unordered ? 0 : i].lat], [p.lng, p.lat]] },
      })),
    });
  }, [ready, routeKey]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.guideRequest || props.active === false || props.follow || guidePoints.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of guidePoints) bounds.extend([p.lng, p.lat]);
    const box = el.current!.getBoundingClientRect();
    const panel = document.querySelector(".main-panel")?.getBoundingClientRect();
    const phone = window.innerWidth <= 900;
    const landscape = phone && window.innerWidth > window.innerHeight;
    const pad = document.querySelector(".demo-pad")?.getBoundingClientRect();
    const rail = document.querySelector(".nav-rail")?.getBoundingClientRect();
    const header = document.querySelector(".topbar")?.getBoundingClientRect();
    const legend = document.querySelector(".map-guide-key")?.getBoundingClientRect();
    // The compact objective is centered at the bottom. Reserve actual occupied
    // space rather than treating its right edge as a left sidebar.
    const lower = [panel, pad, rail].filter((r): r is DOMRect => !!r && r.height > 0 && r.top > box.top + box.height * .35);
    const occupiedTop = Math.min(box.bottom, ...lower.map(r => r.top));
    const top = Math.min(box.height * (landscape ? .46 : phone ? .36 : .34), Math.max((header?.bottom || box.top + 70) - box.top + 100, (legend?.bottom || box.top + 100) - box.top + 100));
    const bottom = Math.min(landscape ? 90 : Math.max(90, box.bottom - occupiedTop + 32), box.height * .48, Math.max(40, box.height - top - 120));
    const left = 38;
    const right = landscape && panel ? Math.min(box.width * .6, box.right - panel.left + 30, box.width - left - 140) : 38;
    m.fitBounds(bounds, {
      padding: { top, bottom, left, right },
      maxZoom: 17, pitch: 35, bearing: 0,
      duration: prefersReducedMotion() ? 0 : 550,
    });
    // Reframe only for an explicit request or a changed visible layout.
    // Position updates and manual panning keep control of the camera.
  }, [ready, props.guideRequest?.revision, props.active, viewportRevision]);
  const stopsKey = JSON.stringify([props.route?.stops, guidePoints.slice(1)]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || props.globe) return;
    if (!props.route) {
      const markers = guidePoints.slice(1).map((p, i, stops) => {
        const node = document.createElement("div");
        node.className = `map-kit-checkpoint${i === 0 ? " next" : ""}`;
        const img = document.createElement("img");
        img.src = mapKitUrl(`navigation/${i === stops.length - 1 ? "route-end" : "checkpoint"}.png`); img.alt = "";
        const number = document.createElement("b"); number.textContent = String(i + 1);
        node.append(img, number); node.setAttribute("aria-hidden", "true");
        return new maplibregl.Marker({ element: node, anchor: "bottom", offset: [-36, 0] }).setLngLat([p.lng, p.lat]).addTo(m);
      });
      return () => markers.forEach(marker => marker.remove());
    }
    const route = props.route;
    const markers = questStopMarkers(route).map(({ point: p, numbers, next }) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `quest-route-stop${next ? " next" : ""}`;
      node.dataset.stops = numbers.join(",");
      node.dataset.questId = route.questId;
      const ordinal = numbers.join(" · ");
      const label = tr("Stop {0} of {1}", {0: ordinal, 1: route.total});
      node.setAttribute("aria-label", ordinal + (next ? " " + tr("Next stop") : "") + " · " + label);
      node.title = next ? tr("Next stop") + " · " + label : label;
      const badge = document.createElement("span");
      badge.textContent = ordinal;
      node.append(badge);
      if (next) {
        node.append(document.createTextNode(" "));
        const caption = document.createElement("small");
        caption.textContent = tr("Next stop");
        node.append(caption);
      }
      node.addEventListener("click", event => { event.stopPropagation(); latest.current.onQuest(route.questId); });
      return new maplibregl.Marker({ element: node, anchor: "center" })
        .setLngLat([p.lng, p.lat])
        .addTo(m);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [ready, stopsKey]);
  const creatorPlaceKey = JSON.stringify(props.creatorPlaces || []);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || props.globe || !props.creatorPlaces?.length) return;
    const markers = props.creatorPlaces.map((place) => {
      const node = document.createElement("button");
      const label = `${place.title} · ${CREATOR_PIN_NAME[place.template]}`;
      node.className = "quest-map-pin game-object-map-pin creator-map-pin";
      node.setAttribute("aria-label", label);
      node.title = label;
      paintQuestPin(node, place.template === "trail" ? "trail" : place.template === "chest" ? "chest" : "community", { kind: place.template === "trail" ? "route" : place.template === "chest" ? "chest" : "place" });
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onCreatorPlace?.(place.questId);
      });
      return new maplibregl.Marker({ element: node, anchor: "bottom" })
        .setLngLat([place.lng, place.lat])
        .addTo(m);
    });
    return () => markers.forEach((x) => x.remove());
  }, [ready, props.globe, creatorPlaceKey]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.world || !props.focusZone) return;
    const markers = props.world.quests
      .filter((q) => q.zone_id === props.focusZone?.id && !q.completed)
      .map((q) => {
        const p = q.nextPoint || q;
        const node = document.createElement("button");
        const art = questObjectPresentation(q, objectContext);
        node.className = "quest-map-pin game-object-map-pin";
        node.setAttribute("aria-label", `${q.title} · ${art.label}`);
        node.title = `${q.title} · ${art.label}`;
        paintQuestPin(node, questPinKind(q), art);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          latest.current.onQuest(q.id);
          requestAnimationFrame(() =>
            document
              .getElementById("quest-" + q.id)
              ?.scrollIntoView({ block: "start", behavior: "auto" }),
          );
        });
        return new maplibregl.Marker({ element: node, anchor: "bottom", offset: [64, 0] })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
      });
    return () => markers.forEach((x) => x.remove());
  }, [props.focusZone, props.world, ready, questArtKey]);
  return (
    <>
      <div
        ref={el}
        className={`game-map maplibregl-map sky-${sky.phase}${props.globe ? " globe-view" : ""}`}
        aria-label={tr("Real OpenStreetMap world")}
      />
      {!props.globe && (
        <div
          className={`map-sky-chip sky-${sky.phase}`}
          role="status"
          aria-label={skyText.long}
          title={skyText.long}
        >
          {sky.phase === "day" ? (
            <Sun size={14} weight="fill" aria-hidden />
          ) : sky.phase === "night" ? (
            <MoonStars size={14} weight="fill" aria-hidden />
          ) : (
            <SunHorizon size={14} weight="fill" aria-hidden />
          )}
          <span aria-hidden>{skyText.short}</span>
          {nextWaveText && (
            <span className="map-wave-hint" title={tr("More coins appear in this area at {time}.", { time: nextWaveText })}>
              <Coins size={14} weight="fill" aria-hidden />
              {nextWaveText}
            </span>
          )}
        </div>
      )}
      {!props.globe && guidePoints.length > 1 && (
        <div className="map-guide-key" role="note">
          <img src={mapKitUrl("navigation/arrow-forward.png")} width="24" height="24" alt="" aria-hidden />
          <span>{tr("Direction guide · not a walking route")}</span>
        </div>
      )}
      {!ready && (
        <div className="map-loading" role="status">
          {error
            ? tr("Map loading is taking longer. Your game panels are still available.")
            : tr("Preparing your corner of the world…")}
        </div>
      )}
    </>
  );
}
