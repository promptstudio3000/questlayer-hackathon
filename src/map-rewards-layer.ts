// Map rewards overlay (docs/MAP-REWARDS.md): how many coins wait in each
// area today, as a heatmap of H3 cells with counts, plus the gold fog of
// pioneer cells nobody has explored for 30 days. Loaded on demand by
// GameMap; it fetches /api/map/rewards for the visible box after the map
// stops moving. At street zoom the real coins take over and the overlay fades.
import type * as maplibregl from "maplibre-gl";
import { api } from "./api";
import { tr } from "./i18n.ts";

type Cell = {
  cell: string;
  coins: number;
  valueU: number;
  zones: number;
  pioneer: boolean | number;
  opened: boolean | number;
  cells?: number;
  center: [number, number];
  boundary: [number, number][];
};
type RewardsResponse = {
  day: string;
  res: number;
  root: string | null;
  cells: Cell[];
};

export type MapRewardsLayer = {
  setVisible: (visible: boolean) => void;
  destroy: () => void;
};

const SOURCE = "map-rewards",
  LABELS = "map-rewards-labels";
// Coarser cells when zoomed out: res 4 below zoom 7, 5 below 10, 6 below 12.
export function rewardsResolution(zoom: number) {
  return zoom < 7 ? 4 : zoom < 9.5 ? 5 : zoom < 11.5 ? 6 : 7;
}
export function goldLabel(valueU: number) {
  const g = valueU / 1e6;
  return g >= 100 ? g.toFixed(0) : g >= 10 ? g.toFixed(1) : g.toFixed(2);
}

export function attachMapRewardsLayer(m: maplibregl.Map): MapRewardsLayer {
  let visible = true,
    timer: ReturnType<typeof setTimeout> | null = null,
    controller: AbortController | null = null,
    lastKey = "";
  const empty = { type: "FeatureCollection" as const, features: [] };
  m.addSource(SOURCE, { type: "geojson", data: empty });
  m.addSource(LABELS, { type: "geojson", data: empty });
  const before = m.getLayer("zones-fill") ? "zones-fill" : undefined;
  m.addLayer(
    {
      id: "map-rewards-heat",
      type: "fill",
      source: SOURCE,
      maxzoom: 16,
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "heat"],
          0,
          "#5b2bb5",
          0.5,
          "#a24cd9",
          1,
          "#f2b632",
        ],
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.38,
          13,
          0.24,
          15.5,
          0.04,
        ],
      },
    },
    before,
  );
  // Gold fog: unexplored for 30 days, x2 coins and a pioneer chest today.
  m.addLayer(
    {
      id: "map-rewards-fog",
      type: "fill",
      source: SOURCE,
      filter: ["==", ["get", "pioneer"], true],
      paint: {
        "fill-color": "#f5c542",
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.12,
          14,
          0.2,
          17,
          0.12,
        ],
      },
    },
    before,
  );
  m.addLayer(
    {
      id: "map-rewards-edge",
      type: "line",
      source: SOURCE,
      maxzoom: 16,
      paint: {
        "line-color": ["case", ["get", "pioneer"], "#f5c542", "#ffffff"],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 15, 0.4],
        "line-width": ["case", ["get", "pioneer"], 1.6, 0.8],
        "line-dasharray": [2, 2],
      },
    },
    before,
  );
  m.addLayer({
    id: "map-rewards-count",
    type: "symbol",
    source: LABELS,
    maxzoom: 14.5,
    layout: {
      "icon-image": "gold-coin",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 13, 0.42],
      "text-field": ["get", "label"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 13, 14, 14],
      "text-font": ["Noto Sans Bold"],
      "text-anchor": "left",
      "text-offset": [0.9, 0],
      "icon-anchor": "right",
      "text-allow-overlap": false,
      "icon-allow-overlap": false,
      "text-padding": 10,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#2a1356",
      "text-halo-width": 1.6,
    },
  });

  async function refresh() {
    if (!visible) return;
    const zoom = m.getZoom(),
      res = rewardsResolution(zoom),
      b = m.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(
      (n) => Number(n.toFixed(3)),
    );
    // Clamp to the server's limit around the centre.
    const c = m.getCenter();
    bbox[0] = Math.max(bbox[0], c.lng - 6);
    bbox[2] = Math.min(bbox[2], c.lng + 6);
    bbox[1] = Math.max(bbox[1], c.lat - 4);
    bbox[3] = Math.min(bbox[3], c.lat + 4);
    const key = `${res}:${bbox.join(",")}`;
    if (key === lastKey) return;
    lastKey = key;
    controller?.abort();
    controller = new AbortController();
    try {
      const data = await api<RewardsResponse>(
        `/map/rewards?res=${res}&bbox=${bbox.join(",")}`,
        undefined,
        {
          signal: controller.signal,
        },
      );
      const max = Math.max(1, ...data.cells.map((x) => x.valueU));
      (m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: data.cells.map((x) => ({
          type: "Feature",
          properties: {
            cell: x.cell,
            heat: Math.sqrt(x.valueU / max),
            pioneer:
              res === 7
                ? !!x.pioneer
                : Number(x.pioneer) > 0 &&
                  Number(x.pioneer) >= (x.cells || 1) / 2,
          },
          geometry: { type: "Polygon", coordinates: [x.boundary] },
        })),
      });
      (m.getSource(LABELS) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: data.cells
          .filter((x) => x.coins > 0)
          .map((x) => ({
            type: "Feature",
            properties: {
              label:
                res === 7
                  ? tr("{count} coins · {gold} G", {
                      count: x.coins,
                      gold: goldLabel(x.valueU),
                    })
                  : tr("{count} coins", { count: x.coins }),
            },
            geometry: { type: "Point", coordinates: x.center },
          })),
      });
    } catch {
      lastKey = "";
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 350);
  };
  m.on("moveend", schedule);
  schedule();
  const layers = [
    "map-rewards-heat",
    "map-rewards-fog",
    "map-rewards-edge",
    "map-rewards-count",
  ];
  return {
    setVisible(next) {
      visible = next;
      for (const id of layers)
        if (m.getLayer(id))
          m.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      if (next) {
        lastKey = "";
        schedule();
      }
    },
    destroy() {
      m.off("moveend", schedule);
      if (timer) clearTimeout(timer);
      controller?.abort();
      for (const id of layers) if (m.getLayer(id)) m.removeLayer(id);
      for (const id of [SOURCE, LABELS])
        if (m.getSource(id)) m.removeSource(id);
    },
  };
}
