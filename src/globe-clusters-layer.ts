// Globe clusters (docs/GLOBE-CLUSTERS.md): when the map turns into a globe,
// bubbles show where in the world there is something to play. Close in they
// cover a region, further out a country or a group of small countries. The
// number is player quests when a bubble holds any (gold), otherwise playable
// cities (violet). Loaded on demand by GameMap the first time the globe opens;
// it reads /api/globe once and again every few minutes while visible.
import type * as maplibregl from "maplibre-gl";
import { api } from "./api";
import { tr } from "./i18n.ts";

/** [lng, lat, player quests, cities], rounded to about 1 km by the server. */
export type GlobeSpot = [number, number, number, number];
type GlobeResponse = { spots: GlobeSpot[] };

export type GlobeClustersLayer = {
  setVisible: (visible: boolean) => void;
  destroy: () => void;
};

const SOURCE = "globe-clusters",
  CIRCLES = "globe-clusters-circle",
  LABELS = "globe-clusters-label",
  REFRESH_MS = 5 * 60_000;
// Bubbles stop merging from zoom 9 (one per city); the radius keeps one bubble
// per region at zoom 5-7 and per country at zoom 2-4 without crowding.
export const GLOBE_CLUSTER_RADIUS = 44,
  GLOBE_CLUSTER_MAX_ZOOM = 8;

export function globeFeatures(spots: GlobeSpot[]) {
  return {
    type: "FeatureCollection" as const,
    features: spots
      .filter(
        (s) =>
          Array.isArray(s) &&
          Number.isFinite(s[0]) &&
          Number.isFinite(s[1]) &&
          (s[2] > 0 || s[3] > 0),
      )
      .map(([lng, lat, pq, ci]) => ({
        type: "Feature" as const,
        properties: { pq: Math.max(0, pq | 0), ci: Math.max(0, ci | 0) },
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
      })),
  };
}

export function attachGlobeClustersLayer(
  m: maplibregl.Map,
): GlobeClustersLayer {
  let visible = false,
    loadedAt = 0,
    controller: AbortController | null = null,
    timer: ReturnType<typeof setInterval> | null = null;
  m.addSource(SOURCE, {
    type: "geojson",
    data: globeFeatures([]),
    cluster: true,
    clusterRadius: GLOBE_CLUSTER_RADIUS,
    clusterMaxZoom: GLOBE_CLUSTER_MAX_ZOOM,
    clusterProperties: {
      pq: ["+", ["get", "pq"]],
      ci: ["+", ["get", "ci"]],
    },
  });
  const community: maplibregl.ExpressionSpecification = [">", ["get", "pq"], 0],
    value: maplibregl.ExpressionSpecification = [
      "case",
      community,
      ["get", "pq"],
      ["get", "ci"],
    ];
  m.addLayer({
    id: CIRCLES,
    type: "circle",
    source: SOURCE,
    layout: { visibility: "none" },
    paint: {
      "circle-color": ["case", community, "#f2b632", "#6c3fd1"],
      "circle-opacity": ["case", community, 0.95, 0.82],
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["ln", ["+", 1, value]],
        0,
        13,
        2,
        17,
        5,
        26,
      ],
      "circle-stroke-color": ["case", community, "#fff3c4", "#c9b8ff"],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9,
      "circle-pitch-alignment": "viewport",
    },
  });
  m.addLayer({
    id: LABELS,
    type: "symbol",
    source: SOURCE,
    layout: {
      visibility: "none",
      "text-field": [
        "format",
        ["to-string", value],
        { "font-scale": 1 },
        "\n",
        {},
        [
          "case",
          community,
          ["case", ["==", ["get", "pq"], 1], tr("Player quest"), tr("Player quests")],
          ["case", ["==", ["get", "ci"], 1], tr("City"), tr("Cities")],
        ],
        { "font-scale": 0.62 },
      ],
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
      "text-line-height": 1.05,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-pitch-alignment": "viewport",
      "text-rotation-alignment": "viewport",
    },
    paint: {
      "text-color": ["case", community, "#2a1356", "#ffffff"],
      "text-halo-color": ["case", community, "#fff3c4", "#2a1356"],
      "text-halo-width": 0.6,
    },
  });

  async function load() {
    if (!visible) return;
    controller?.abort();
    controller = new AbortController();
    try {
      const data = await api<GlobeResponse>("/globe", undefined, {
        signal: controller.signal,
      });
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
        globeFeatures(Array.isArray(data?.spots) ? data.spots : []),
      );
      loadedAt = Date.now();
    } catch {
      // Offline or aborted: keep the last bubbles.
    }
  }
  // A bubble opens one step closer: a country splits into its regions.
  const open = async (e: maplibregl.MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f || f.geometry.type !== "Point") return;
    const center = f.geometry.coordinates as [number, number];
    let zoom = m.getZoom() + 2.5;
    const id = f.properties?.cluster_id;
    if (id !== undefined) {
      try {
        zoom = await (
          m.getSource(SOURCE) as maplibregl.GeoJSONSource
        ).getClusterExpansionZoom(Number(id));
      } catch {}
    }
    m.easeTo({ center, zoom: Math.min(zoom, 11), duration: 700 });
  };
  const pointer = () => (m.getCanvas().style.cursor = "pointer"),
    plain = () => (m.getCanvas().style.cursor = "");
  m.on("click", CIRCLES, open);
  m.on("mouseenter", CIRCLES, pointer);
  m.on("mouseleave", CIRCLES, plain);
  return {
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      for (const id of [CIRCLES, LABELS])
        if (m.getLayer(id))
          m.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      if (timer) clearInterval(timer);
      timer = null;
      if (!next) return;
      if (Date.now() - loadedAt > REFRESH_MS) void load();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, REFRESH_MS);
    },
    destroy() {
      if (timer) clearInterval(timer);
      controller?.abort();
      try {
        m.off("click", CIRCLES, open);
        m.off("mouseenter", CIRCLES, pointer);
        m.off("mouseleave", CIRCLES, plain);
        for (const id of [LABELS, CIRCLES])
          if (m.getLayer(id)) m.removeLayer(id);
        if (m.getSource(SOURCE)) m.removeSource(SOURCE);
      } catch {
        // The map is already gone.
      }
    },
  };
}
