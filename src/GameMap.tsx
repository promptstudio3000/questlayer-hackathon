import { characterMarkerMarkup } from "./character-art";
import type { NearbyExplorer } from "./types";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(mapWorkerUrl);
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Point, World, Zone, Item } from "./types";
import { ghostSvg } from "./Ghost";
type Props = {
  sheetExpanded: boolean;
  panelMode: string;
  onQuest: () => void;
  overview: boolean;
  focusZone: Zone | null;
  world: World | null;
  position: Point;
  arena: boolean;
  globe: boolean;
  equipped: Item[];
  others: NearbyExplorer[];
  skinUrl?: string;
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
function skinFallback(node: HTMLElement, color?: string) {
  const image = node.querySelector("img");
  image?.addEventListener(
    "error",
    () => {
      image.outerHTML = ghostSvg(color);
      node.setAttribute(
        "aria-label",
        (node.getAttribute("aria-label") || "Explorer") +
          " · original appearance unavailable",
      );
    },
    { once: true },
  );
}
export function GameMap(props: Props) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    avatar = useRef<maplibregl.Marker | null>(null),
    labels = useRef<maplibregl.Marker[]>([]);
  const latest = useRef(props);
  latest.current = props;
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
    marker.innerHTML = ghostSvg();
    avatar.current = new maplibregl.Marker({
      element: marker,
      anchor: "bottom",
    })
      .setLngLat([props.position.lng, props.position.lat])
      .addTo(m);
    m.on("dragstart", () => latest.current.onPan());
    m.on("click", (e) => {
      if (latest.current.arena)
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
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 28;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#a37429";
      ctx.fillRect(6, 2, 12, 24);
      ctx.fillRect(3, 6, 18, 16);
      ctx.fillStyle = "#f4c957";
      ctx.fillRect(6, 5, 12, 18);
      ctx.fillRect(5, 8, 14, 12);
      ctx.fillStyle = "#fff1b2";
      ctx.fillRect(7, 6, 4, 13);
      ctx.fillRect(11, 5, 5, 3);
      ctx.fillStyle = "#d69c36";
      ctx.fillRect(13, 11, 3, 8);
      m.addImage("gold-coin", ctx.getImageData(0, 0, 24, 28));
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
      node.className = `zone-map-pin tier-${z.tier}${props.overview ? " map-overview-pin" : ""}${props.globe ? " hidden" : ""}`;
      node.title = z.name;
      node.setAttribute("aria-label", z.name);
      node.innerHTML = ghostSvg(z.color);
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
  }, [props.world, ready, props.overview, props.globe]);
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
    if (!map.current) return;
    avatar.current?.setLngLat([props.position.lng, props.position.lat]);
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
    avatar.current.getElement().innerHTML =
      characterMarkerMarkup({
        color,
        above: top?.color,
        below: bottom?.color,
        skinUrl: props.skinUrl,
      }) + '<span class="you-label">YOU</span>';
    skinFallback(avatar.current.getElement(), color);
  }, [equipmentKey, props.skinUrl]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    try {
      m.setProjection({ type: props.globe ? "globe" : "mercator" });
    } catch {}
    (props.globe ? m.flyTo.bind(m) : m.easeTo.bind(m))(
      props.globe
        ? {
            zoom: 2,
            pitch: 0,
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
        node.className = "quest-map-pin";
        node.setAttribute("aria-label", q.title);
        node.title = q.title;
        node.innerHTML =
          q.kind === "chest"
            ? '<svg viewBox="0 0 32 32"shape-rendering="crispEdges"><path fill="#441c6c"d="M4 9h24v19H4z"/><path fill="#fef87d"d="M6 7h20v11H6z"/><path fill="#d4963b"d="M6 19h20v7H6z"/><path fill="#fff"d="M14 14h4v8h-4z"/></svg>'
            : '<svg viewBox="0 0 32 32"shape-rendering="crispEdges"><path fill="#441c6c"d="M7 3h3v26H7z"/><path fill="#672eeb"d="M10 4h16v12H10z"/><path fill="#ff1dff"d="M10 5h6v5h-6zm6 5h9v5h-9z"/></svg>';
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          latest.current.onQuest();
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
  }, [props.focusZone, props.world, ready]);
  return (
    <>
      <div
        ref={el}
        className="game-map"
        aria-label="Real OpenStreetMap world"
      />
      {!ready && (
        <div className="map-loading">
          {error
            ? "Map loading is taking longer. Your game panels are still available."
            : "Preparing your corner of the world…"}
        </div>
      )}
    </>
  );
}
