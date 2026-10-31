import {
  characterMarkerMarkup,
  STARTER_SPRITE,
  starterMarkerMarkup,
} from "./character-art";
import { auraEdition } from "./aura-art-data.ts";
import { loadCharacterModel } from "./character-model-client";
import { moveMapMarker } from "./map-motion";
import {
  gameObjectMarkup,
  rasterizeGameObject,
  questObjectPresentation,
  zoneObjectPresentation,
} from "./game-object-art";
import type { NearbyExplorer } from "./types";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Point, World, Zone, Item } from "./types";
type PawnScene = ReturnType<
  typeof import("./character-3d-scene").createCharacterScene
>;
export type GameMapProps = {
  sheetExpanded: boolean;
  panelMode: string;
  onQuest: (questId: string) => void;
  onCoin?: (coinId: string) => void;
  overview: boolean;
  focusZone: Zone | null;
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
  skinUrl?: string;
  map3D?: boolean;
  onMove: (p: Point) => void;
  onZone: (z: Zone) => void;
  follow: boolean;
  onPan: () => void;
};
function phoneLayout() {
  return (
    window.innerWidth < 760 ||
    (window.innerWidth <= 1000 && window.innerHeight <= 500)
  );
}
function skinFallback(node: HTMLElement, _color?: string) {
  const image = node.querySelector("img");
  image?.addEventListener(
    "error",
    () => {
      image.src = STARTER_SPRITE;
      image.className = "starter-player";
      image.alt = "Aavegotchi starter appearance";
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
    labels = useRef<maplibregl.Marker[]>([]);
  const pawn = useRef<PawnScene | null>(null),
    heading = useRef(180);
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
  const equipmentKey = props.equipped
    .map((i) => `${i.id}:${i.color}:${i.slot}`)
    .join("|");
  useEffect(() => {
    const m = map.current,
      target = props.nativeTarget;
    if (!m || !ready || !target || props.globe) return;
    const node = document.createElement("div");
    node.className = "native-target-pin";
    node.innerHTML = gameObjectMarkup({
      kind: props.nativeTargetKind || "discovery",
      selected: true,
    });
    const targetText = document.createElement("span");
    targetText.textContent = target.label;
    node.append(targetText);
    const marker = new maplibregl.Marker({ element: node, anchor: "bottom" })
      .setLngLat([target.lng, target.lat])
      .addTo(m);
    if (!props.follow)
      m.easeTo({
        center: [target.lng, target.lat],
        zoom: 17,
        pitch: 43,
        offset: cameraOffset(),
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
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
    props.nativeTarget,
    props.nativeTargetKind,
    props.globe,
    props.sheetExpanded,
    props.panelMode,
    viewportRevision,
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
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
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
      if (latest.current.arena && !latest.current.globe)
        latest.current.onMove({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });
    m.on("error", () => {
      if (!gone) setError(true);
    });
    m.once("load", () => {
      if (gone) return;
      const style = m.getStyle();
      for (const layer of style.layers as any[]) {
        try {
          if (layer.type === "background")
            m.setPaintProperty(layer.id, "background-color", "#e9eadb");
          if (layer.type === "fill") {
            if (layer["source-layer"] === "water")
              m.setPaintProperty(layer.id, "fill-color", "#b5d6d8");
            else if (
              layer["source-layer"] === "park" ||
              layer.id.includes("wood")
            )
              m.setPaintProperty(layer.id, "fill-color", "#bdcea6");
            else if (layer["source-layer"] === "building")
              m.setPaintProperty(layer.id, "fill-color", "#dad2da");
            else if (layer["source-layer"] === "landcover")
              m.setPaintProperty(layer.id, "fill-color", "#d4ddbd");
          }
          if (
            layer.type === "line" &&
            layer["source-layer"] === "transportation"
          ) {
            m.setPaintProperty(
              layer.id,
              "line-color",
              layer.id.includes("casing")
                ? "#cec5c0"
                : layer.id.includes("path")
                  ? "#e4d4ae"
                  : "#fffaf0",
            );
          }
          if (layer.type === "symbol") {
            if (
              !["transportation_name", "water_name", "place"].includes(
                layer["source-layer"],
              )
            )
              m.setLayoutProperty(layer.id, "visibility", "none");
            m.setPaintProperty(layer.id, "text-color", "#8d827f");
          }
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
      m.addImage("gold-coin", rasterizeGameObject({ kind: "coin" }));
      m.addSource("zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.15 },
      });
      m.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
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
          "icon-image": "gold-coin",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0.45,
            17,
            0.8,
            19,
            1.05,
          ],
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
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.world) return;
    (m.getSource("coins") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: props.world.coins.map((c) => ({
        type: "Feature",
        properties: { id: c.id },
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      })),
    });
    (m.getSource("zones") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: props.world.zones.map((z) => ({
        type: "Feature",
        properties: { color: z.color },
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
    labels.current.forEach((x) => x.remove());
    labels.current = [];
    for (const z of props.world.zones) {
      const node = document.createElement("button");
      const art = zoneObjectPresentation(z, props.world.quests, objectContext);
      const selected = props.focusZone?.id === z.id;
      node.className = `zone-map-pin game-object-map-pin tier-${z.tier}${props.overview ? " map-overview-pin" : ""}${props.globe ? " hidden" : ""}`;
      node.title = `${z.name} · ${art.label}`;
      node.setAttribute("aria-label", node.title);
      node.setAttribute("aria-pressed", String(selected));
      node.innerHTML = gameObjectMarkup({ ...art, selected });
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onZone(z);
      });
      labels.current.push(
        new maplibregl.Marker({ element: node, anchor: "bottom" })
          .setLngLat([z.lng, z.lat])
          .addTo(m),
      );
    }
  }, [
    props.world,
    ready,
    props.overview,
    props.globe,
    props.focusZone?.id,
    zoneArtKey,
  ]);
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
      });
      node.setAttribute("role", "img");
      node.setAttribute(
        "aria-label",
        p.name +
          (look?.source === "unavailable"
            ? " · appearance temporarily unavailable"
            : " · nearby explorer"),
      );
      const label = document.createElement("span");
      label.textContent = p.name;
      node.append(label);
      skinFallback(node, look?.color || p.color);
      return new maplibregl.Marker({ element: node, anchor: "bottom" })
        .setLngLat([p.lng, p.lat])
        .addTo(m);
    });
    return () => markers.forEach((m) => m.remove());
  }, [props.others, ready]);
  function cameraOffset(): [number, number] {
    if (!phoneLayout()) return [155, 35];
    const box = el.current?.getBoundingClientRect(),
      panel = document.querySelector(".main-panel")?.getBoundingClientRect(),
      header = document.querySelector(".topbar")?.getBoundingClientRect();
    if (!box) return [0, -90];
    const top = Math.max(box.top, header?.bottom || box.top),
      bottom = Math.max(
        top + 80,
        Math.min(box.bottom, panel?.top || box.bottom),
      );
    if (window.innerWidth >= 760 && panel)
      return [
        (116 + panel.left - box.left) / 2 - box.width / 2,
        (top + box.bottom - 84) / 2 - box.top - box.height / 2 + 35,
      ];
    return [0, (top + bottom) / 2 - box.top - box.height / 2 + 35];
  }
  useEffect(() => {
    if (!avatar.current) return;
    const previous = avatar.current.getLngLat(),
      north = props.position.lat - previous.lat,
      east =
        (props.position.lng - previous.lng) *
        Math.cos((props.position.lat * Math.PI) / 180),
      travelled = Math.hypot(north, east) * 111320;
    if (travelled >= 2 && travelled <= 80)
      heading.current = (Math.atan2(east, north) * 180) / Math.PI;
    const m = map.current;
    if (m && !props.globe)
      pawn.current?.setMapView(m.getBearing(), m.getPitch(), heading.current);
    return moveMapMarker(avatar.current, props.position, {
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  }, [props.position, ready]);
  useEffect(() => {
    if (!map.current) return;
    if (props.follow && !props.globe && !props.overview)
      map.current.easeTo({
        center: [props.position.lng, props.position.lat],
        offset: cameraOffset(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 450,
      });
  }, [
    props.position,
    props.follow,
    props.globe,
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
      `${props.skinUrl ? "Your linked Aavegotchi" : "Your Aavegotchi starter"}${top ? `; ${top.name} above` : ""}${bottom ? `; ${bottom.name} below` : ""}`,
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
      }) + '<span class="you-label">YOU</span>';
    if (modelHost) element.append(modelHost);
    skinFallback(element, color);
  }, [equipmentKey, props.skinUrl, ready]);
  useEffect(() => {
    const m = map.current,
      element = avatar.current?.getElement();
    if (!m || !element || !ready || props.map3D === false) return;
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
  }, [props.skinUrl, props.map3D, ready]);
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
            duration: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 0
              : 1400,
          }
        : {
            center: [props.position.lng, props.position.lat],
            offset: cameraOffset(),
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            zoom: 16.9,
            pitch: 43,
            bearing: -14,
            duration: matchMedia("(prefers-reduced-motion: reduce)").matches
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
        for (const p of z.geometry?.coordinates[0] || [[z.lng, z.lat]])
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
          pitch: 0,
          bearing: 0,
          duration: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 0
            : 650,
        });
      }
    } else if (props.focusZone && !props.follow)
      m.easeTo({
        center: [props.focusZone.lng, props.focusZone.lat],
        offset: cameraOffset(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        zoom: 16.8,
        pitch: 43,
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 450,
      });
  }, [
    props.overview,
    props.focusZone,
    ready,
    props.world?.id,
    props.sheetExpanded,
    props.panelMode,
    viewportRevision,
  ]);
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
        node.innerHTML = gameObjectMarkup(art);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          latest.current.onQuest(q.id);
          requestAnimationFrame(() =>
            document
              .getElementById("quest-" + q.id)
              ?.scrollIntoView({ block: "start", behavior: "auto" }),
          );
        });
        return new maplibregl.Marker({ element: node, anchor: "bottom" })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
      });
    return () => markers.forEach((x) => x.remove());
  }, [props.focusZone, props.world, ready, questArtKey]);
  return (
    <>
      <div
        ref={el}
        className={
          props.globe
            ? "game-map maplibregl-map globe-view"
            : "game-map maplibregl-map"
        }
        aria-label="Real OpenStreetMap world"
      />
      {!ready && (
        <div className="map-loading" role="status">
          {error
            ? "Map loading is taking longer. Your game panels are still available."
            : "Preparing your corner of the world…"}
        </div>
      )}
    </>
  );
}
