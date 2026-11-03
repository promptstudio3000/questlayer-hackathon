// Day and night on the map: the base map is repainted from the real sun at the
// player's position (src/sun.ts), so evening play looks like evening. The
// server picks the day or night cast of NPCs and monsters the same way
// (server/actors/schedule.mjs). Pure palette data plus one painter.
import type * as maplibregl from "maplibre-gl";
import { skyAt, type Sky, type SkyPhase } from "./sun.ts";

export type MapPalette = {
  background: string;
  water: string;
  park: string;
  building: string;
  landcover: string;
  casing: string;
  path: string;
  road: string;
  text: string;
  textHalo: string;
  extrusion: string;
  extrusionOpacity: number;
};

// "day" is the palette the map always had; dusk/dawn warm it, night is the
// game's deep purple with lit roads so paths stay readable.
export const MAP_PALETTES: Record<SkyPhase, MapPalette> = {
  day: {
    background: "#e9eadb",
    water: "#b5d6d8",
    park: "#bdcea6",
    building: "#dad2da",
    landcover: "#d4ddbd",
    casing: "#cec5c0",
    path: "#e4d4ae",
    road: "#fffaf0",
    text: "#8d827f",
    textHalo: "#ffffff",
    extrusion: "#d3c9d7",
    extrusionOpacity: 0.68,
  },
  dawn: {
    background: "#e3d3cf",
    water: "#9fb9cf",
    park: "#aab89a",
    building: "#cdbccb",
    landcover: "#c3c8ab",
    casing: "#bfa9aa",
    path: "#dcbc98",
    road: "#fbe9dc",
    text: "#76626c",
    textHalo: "#fbefe9",
    extrusion: "#c4b0c9",
    extrusionOpacity: 0.72,
  },
  dusk: {
    background: "#cdb5c4",
    water: "#7f93bd",
    park: "#8e9a88",
    building: "#b49fbb",
    landcover: "#a5a596",
    casing: "#9e839a",
    path: "#d3a77f",
    road: "#f1d6c4",
    text: "#5d4a63",
    textHalo: "#f0e2e6",
    extrusion: "#a58db8",
    extrusionOpacity: 0.76,
  },
  night: {
    background: "#1d1a3a",
    water: "#122a4d",
    park: "#1c3433",
    building: "#2b2752",
    landcover: "#1f2838",
    casing: "#12102b",
    path: "#7d6596",
    road: "#4a3f7a",
    text: "#c9c0f0",
    textHalo: "#1d1a3a",
    extrusion: "#3b3275",
    extrusionOpacity: 0.86,
  },
};

/** Sky at the player's position, or day when the position is unknown. */
export function skyFor(position: { lat: number; lng: number } | null | undefined, now = Date.now()): Sky {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return { phase: "day" };
  return skyAt(now, position);
}

type StyleLayer = { id: string; type: string; "source-layer"?: string };

/** Repaint the base map. Safe to call again on every phase change. */
export function paintMapSky(m: maplibregl.Map, phase: SkyPhase) {
  const p = MAP_PALETTES[phase] || MAP_PALETTES.day;
  const set = (id: string, key: string, value: string | number) => {
    try {
      m.setPaintProperty(id, key as Parameters<maplibregl.Map["setPaintProperty"]>[1], value);
    } catch {}
  };
  for (const layer of (m.getStyle()?.layers || []) as StyleLayer[]) {
    const source = layer["source-layer"];
    if (layer.type === "background") set(layer.id, "background-color", p.background);
    if (layer.type === "fill") {
      if (source === "water") set(layer.id, "fill-color", p.water);
      else if (source === "park" || layer.id.includes("wood")) set(layer.id, "fill-color", p.park);
      else if (source === "building") set(layer.id, "fill-color", p.building);
      else if (source === "landcover") set(layer.id, "fill-color", p.landcover);
    }
    if (layer.type === "line" && source === "transportation")
      set(layer.id, "line-color", layer.id.includes("casing") ? p.casing : layer.id.includes("path") ? p.path : p.road);
    if (layer.type === "line" && source === "water") set(layer.id, "line-color", p.water);
    if (layer.type === "symbol") {
      set(layer.id, "text-color", p.text);
      set(layer.id, "text-halo-color", p.textHalo);
    }
  }
  if (m.getLayer("aura-buildings")) {
    set("aura-buildings", "fill-extrusion-color", p.extrusion);
    set("aura-buildings", "fill-extrusion-opacity", p.extrusionOpacity);
  }
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Short chip text and a full label for screen readers. */
export function skyLabel(sky: Sky, now = Date.now()): { short: string; long: string } {
  if (sky.polar === "day") return { short: "Midnight sun", long: "Day all day here, the sun does not set today." };
  if (sky.polar === "night") return { short: "Polar night", long: "Night all day here, the sun does not rise today." };
  const { sunrise, sunset } = sky;
  if (sunrise === undefined || sunset === undefined) return { short: "Day", long: "Day" };
  // The next event after now (sunTimes covers the solar day around now).
  const DAY = 86_400_000;
  const nextRise = sunrise > now ? sunrise : sunrise + DAY,
    nextSet = sunset > now ? sunset : sunset + DAY;
  switch (sky.phase) {
    case "day":
      return { short: `Sunset ${clock(nextSet)}`, long: `Day here. Sunset at ${clock(nextSet)}; night creatures come out after it.` };
    case "dusk":
      return { short: "Dusk", long: `Dusk here. Night creatures are out until sunrise at ${clock(nextRise)}.` };
    case "dawn":
      return { short: `Sunrise ${clock(nextRise)}`, long: `Dawn here. Sunrise at ${clock(nextRise)}; day creatures come out with it.` };
    default:
      return { short: `Sunrise ${clock(nextRise)}`, long: `Night here. Night creatures are out until sunrise at ${clock(nextRise)}.` };
  }
}
