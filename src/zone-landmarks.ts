// Zone landmarks: what makes a quest zone stand out on the map.
//
// Every zone gets a tall totem at its centre (its shape says the zone type,
// its height says the tier), a translucent wall rising from its edge, a glow
// on the ground and the items it holds scattered inside. A countdown says
// when it opens or closes, also for zones the player cannot play yet.
//
// Everything here is plain GeoJSON for MapLibre's own layers (fill-extrusion,
// line, symbol): no extra WebGL context, no per-frame work and no DOM node per
// item, so the phone budget stays at a handful of extra draw calls.
import { AURA_CATALOG, AURA_ENTITLEMENTS } from "./aura-catalog.ts";
import type { AuraCatalogEdition, AuraRarity } from "./aura-catalog.ts";
import { zoneObjectPresentation } from "./game-object-art-data.ts";
import type { Quest, Zone } from "./types.ts";

type Ring = [number, number][];
type Polygon = Ring[];
type Context = { now: number; playerTier?: number };

export type ZonePhase = "open" | "upcoming" | "closed" | "done" | "unknown";

/** The rarest Aura rarity a chest in a zone of this tier can hold. */
export function zoneRarity(tier: number): AuraRarity {
  const order: AuraRarity[] = ["legendary", "epic", "rare", "common"];
  return (
    order.find((r) => tier >= AURA_ENTITLEMENTS[r].minZoneTier) || "common"
  );
}

const RARITY_LABEL: Record<AuraRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

// Rarer zones are taller so they read from further away.
const TOTEM_HEIGHT = { 1: 42, 2: 56, 3: 72 } as Record<number, number>;
const WALL_HEIGHT = { 1: 16, 2: 22, 3: 30 } as Record<number, number>;
/** Totem height in metres; the map lifts the zone pin onto its top. */
export const totemHeight = (tier: number) =>
  TOTEM_HEIGHT[tier] || TOTEM_HEIGHT[1];

function linkedQuests(zone: Zone, quests: readonly Quest[]) {
  return quests.filter(
    (q) =>
      q.zone_id === zone.id ||
      (!q.zone_id &&
        zone.id.includes(":zone:") &&
        q.id === zone.id.replace(":zone:", ":quest:")),
  );
}

export function zonePhase(
  zone: Zone,
  quests: readonly Quest[],
  now: number,
): ZonePhase {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(zone.opensAt) ||
    !Number.isFinite(zone.closesAt)
  )
    return "unknown";
  const linked = linkedQuests(zone, quests);
  if (linked.length && linked.every((q) => q.completed)) return "done";
  if (zone.closesAt <= now || zone.placeStatus === "closed") return "closed";
  if (zone.opensAt > now) return "upcoming";
  return "open";
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000)),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function windowLength(ms: number) {
  const h = ms / 3600000;
  if (h >= 20) return "all day";
  if (h >= 1) return `${Math.round(h * 10) / 10} h`;
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}

/** The text on a zone's countdown chip. Shown whether or not the player can play it. */
export function zoneCountdown(
  zone: Zone,
  quests: readonly Quest[],
  now: number,
): { phase: ZonePhase; text: string; window: string } {
  const phase = zonePhase(zone, quests, now);
  const window = Number.isFinite(zone.closesAt - zone.opensAt)
    ? `${RARITY_LABEL[zoneRarity(zone.tier)]} · open ${windowLength(zone.closesAt - zone.opensAt)}`
    : RARITY_LABEL[zoneRarity(zone.tier)];
  if (phase === "upcoming")
    return { phase, text: `Opens in ${clock(zone.opensAt - now)}`, window };
  if (phase === "open")
    return zone.closesAt - zone.opensAt >= 20 * 3600000 &&
      zone.closesAt - now > 6 * 3600000
      ? { phase, text: "Open now", window }
      : { phase, text: `Closes in ${clock(zone.closesAt - now)}`, window };
  if (phase === "done") return { phase, text: "Cleared", window };
  if (phase === "closed") return { phase, text: "Closed", window };
  return { phase, text: "", window };
}

export type ZoneLoot = {
  id: string;
  kind: "aura" | "gold";
  name: string;
  /** MapLibre image id. */
  image: string;
  /** Public art URL for auras; gold uses the built-in coin image. */
  src?: string;
  rarity?: AuraRarity;
};

/**
 * What a player can find in this zone, from loaded data only: the chest Auras
 * its tier can hold (rarest first, while a chest there still has stock) and
 * gold when an activity pays it. Nothing is invented for zones without data.
 */
export function zoneLoot(
  zone: Zone,
  quests: readonly Quest[],
  limit = 3,
): ZoneLoot[] {
  const linked = linkedQuests(zone, quests).filter((q) => !q.completed);
  const loot: ZoneLoot[] = [];
  const chest = linked.some(
    (q) => q.kind === "chest" && q.itemAvailable !== false,
  );
  if (chest) {
    const order = ["legendary", "epic", "rare", "common"];
    const auras = AURA_CATALOG.filter(
      (e: AuraCatalogEdition) =>
        e.source === "chest" &&
        zone.tier >= AURA_ENTITLEMENTS[e.rarity].minZoneTier,
    ).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
    for (const e of auras.slice(0, limit - 1))
      loot.push({
        id: e.id,
        kind: "aura",
        name: e.name,
        image: `loot-aura-${e.id}`,
        src: `/aura-${e.id}.svg`,
        rarity: e.rarity,
      });
  }
  if (linked.some((q) => q.gold_u > 0))
    loot.push({ id: "gold", kind: "gold", name: "Gold", image: "gold-coin" });
  return loot.slice(0, limit);
}

const M_PER_DEG = 111320;
function offset(lng: number, lat: number, eastM: number, northM: number) {
  return [
    lng + eastM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)),
    lat + northM / M_PER_DEG,
  ] as [number, number];
}
function circle(lng: number, lat: number, r: number, sides: number): Ring {
  return Array.from({ length: sides + 1 }, (_, i) => {
    const a = ((i % sides) / sides) * Math.PI * 2 + Math.PI / sides;
    return offset(lng, lat, Math.cos(a) * r, Math.sin(a) * r);
  });
}

export function zonePolygons(zone: Zone): Polygon[] {
  if (zone.geometry?.type === "Polygon")
    return [zone.geometry.coordinates as Polygon];
  if (zone.geometry?.type === "MultiPolygon")
    return zone.geometry.coordinates as Polygon[];
  return [[circle(zone.lng, zone.lat, Math.max(zone.radius, 20), 48)]];
}

/** Rough zone radius in metres, from its outline. */
export function zoneRadius(zone: Zone) {
  let r = 0;
  const k = Math.cos((zone.lat * Math.PI) / 180);
  for (const poly of zonePolygons(zone))
    for (const [lng, lat] of poly[0] || [])
      r = Math.max(
        r,
        Math.hypot((lng - zone.lng) * k, lat - zone.lat) * M_PER_DEG,
      );
  return r || Math.max(zone.radius, 20);
}

/** A thin band along an outer ring: the footprint of the zone's wall. */
function band(ring: Ring, widthM: number): Polygon {
  const n = ring.length - 1 || 1;
  const cx = ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n,
    cy = ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n;
  const k = Math.cos((cy * Math.PI) / 180);
  const inner = ring
    .map(([x, y]) => {
      const d = Math.hypot((x - cx) * k, y - cy) * M_PER_DEG;
      const f = d > widthM * 2 ? 1 - widthM / d : 0.5;
      return [cx + (x - cx) * f, cy + (y - cy) * f] as [number, number];
    })
    .reverse();
  return [ring, inner];
}

type Feature = {
  type: "Feature";
  properties: Record<string, string | number | boolean>;
  geometry:
    | { type: "Polygon"; coordinates: Polygon }
    | { type: "Point"; coordinates: [number, number] };
};

/** Translucent walls along each zone edge. Upcoming zones get a low wall; spent ones none. */
export function zoneWallFeatures(
  zones: readonly Zone[],
  quests: readonly Quest[],
  now: number,
): Feature[] {
  const out: Feature[] = [];
  for (const z of zones) {
    const phase = zonePhase(z, quests, now);
    if (phase === "closed" || phase === "done" || phase === "unknown") continue;
    const height =
      (WALL_HEIGHT[z.tier] || WALL_HEIGHT[1]) * (phase === "open" ? 1 : 0.4);
    for (const poly of zonePolygons(z))
      if (poly[0]?.length > 3)
        out.push({
          type: "Feature",
          properties: { id: z.id, color: z.color, height },
          geometry: { type: "Polygon", coordinates: band(poly[0], 1.6) },
        });
  }
  return out;
}

/**
 * The totem: a plinth, a shaft and a crown stacked as extrusions at the zone
 * centre. The crown shape names the zone type (chest box, trail spire, place
 * orb); the height names the tier.
 */
export function zoneTotemFeatures(
  zones: readonly Zone[],
  quests: readonly Quest[],
  context: Context,
): Feature[] {
  const out: Feature[] = [];
  for (const z of zones) {
    const phase = zonePhase(z, quests, context.now);
    const h = totemHeight(z.tier),
      kind = zoneObjectPresentation(z, quests, context).kind;
    const spent = phase === "closed" || phase === "done" || phase === "unknown";
    const color = spent ? "#a59aa9" : z.color;
    const part = (
      r: number,
      sides: number,
      base: number,
      top: number,
      c = color,
    ) =>
      out.push({
        type: "Feature",
        properties: { id: z.id, color: c, base, height: top },
        geometry: {
          type: "Polygon",
          coordinates: [circle(z.lng, z.lat, r, sides)],
        },
      });
    // Stepped plinth, a banded shaft, a crown shaped by the zone type and a
    // gem floating above it (lit while the zone is open).
    part(8.5, 8, 0, 1.5, "#3b2a4a");
    part(6.5, 8, 1.5, 3.2, color);
    part(3.4, 6, 3.2, h * 0.62);
    for (const at of [0.3, 0.48])
      part(4.2, 6, h * at, h * at + 2, spent ? "#d8d0dc" : "#fcfaff");
    const sides = kind === "chest" ? 4 : kind === "route" ? 3 : 6;
    part(kind === "chest" ? 6.4 : 5.6, sides, h * 0.62, h * 0.66, "#3b2a4a");
    part(kind === "chest" ? 5.8 : 5, sides, h * 0.66, h * 0.78);
    part(
      3.4,
      kind === "place" || kind === "discovery" ? 8 : sides,
      h * 0.84,
      h,
      phase === "open" ? "#fef87d" : spent ? "#c9c0cc" : "#fcfaff",
    );
  }
  return out;
}

function inside([x, y]: [number, number], ring: Ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

/** Spots for item icons: around the totem, kept inside the zone outline. */
function lootSpots(zone: Zone, count: number): [number, number][] {
  const polys = zonePolygons(zone);
  const within = (p: [number, number]) =>
    polys.some((poly) => poly[0] && inside(p, poly[0]));
  const spots: [number, number][] = [];
  for (const r of [20, 14, 28, 9, 38, 50]) {
    for (let i = 0; i < 12 && spots.length < count; i++) {
      const a = Math.PI / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      const p = offset(zone.lng, zone.lat, Math.cos(a) * r, -Math.sin(a) * r);
      if (
        within(p) &&
        spots.every(
          (q) =>
            Math.hypot(q[0] - p[0], q[1] - p[1]) * M_PER_DEG > 6,
        )
      )
        spots.push(p);
    }
    if (spots.length >= count) break;
  }
  return spots;
}

/** Item icons scattered inside each zone, so a player sees what is there. */
export function zoneLootFeatures(
  zones: readonly Zone[],
  quests: readonly Quest[],
  now: number,
): Feature[] {
  const out: Feature[] = [];
  for (const z of zones) {
    const phase = zonePhase(z, quests, now);
    if (phase === "closed" || phase === "done" || phase === "unknown") continue;
    const loot = zoneLoot(z, quests),
      spots = lootSpots(z, loot.length);
    loot.forEach((item, i) => {
      if (!spots[i]) return;
      out.push({
        type: "Feature",
        properties: {
          id: `${z.id}:${item.id}`,
          image: item.image,
          dim: phase !== "open",
        },
        geometry: { type: "Point", coordinates: spots[i] },
      });
    });
  }
  return out;
}

/** One-line description for the zone pin's accessible name. */
export function zoneLandmarkLabel(
  zone: Zone,
  quests: readonly Quest[],
  now: number,
) {
  const loot = zoneLoot(zone, quests).map((l) => l.name);
  const { phase, window } = zoneCountdown(zone, quests, now);
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const when =
    phase === "upcoming"
      ? `opens at ${at(zone.opensAt)}`
      : phase === "open"
        ? `open until ${at(zone.closesAt)}`
        : phase === "done"
          ? "cleared"
          : phase === "closed"
            ? "closed"
            : "";
  return [window, when, loot.length ? `find: ${loot.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
}
