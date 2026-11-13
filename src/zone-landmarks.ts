// Zone landmarks: what makes a quest zone stand out on the map.
//
// Every zone gets a small altar at its centre (its shape says the activity,
// its height says the tier), a high open aura rising from its edge, a glow
// on the ground and the items it holds scattered inside. A countdown says
// when it opens or closes, also for zones the player cannot play yet.
//
// GeoJSON keeps the authoritative footprints intact. The shared WebGL layer
// turns boundary paths into open, translucent curtains; other map layers draw
// ground outlines, fallback totems and loot. No additional canvas is needed.
import { AURA_CATALOG, AURA_ENTITLEMENTS } from "./aura-catalog.ts";
import type { AuraCatalogEdition, AuraRarity } from "./aura-catalog.ts";
import { zoneObjectPresentation } from "./game-object-art-data.ts";
import type { Quest, Zone } from "./types.ts";
import { tr } from "./i18n.ts";

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
  get common() { return tr("Common"); },
  get rare() { return tr("Rare"); },
  get epic() { return tr("Epic"); },
  get legendary() { return tr("Legendary"); },
};

export const rarityLabel = (r: AuraRarity) => RARITY_LABEL[r] || r;

// Rarer zones are taller so they read from further away.
const TOTEM_HEIGHT = { 1: 14, 2: 18, 3: 22 } as Record<number, number>;
// Presentation heights: the boundary aura is the long-distance signal.
// Its upper halo fades smoothly into the sky; it has no horizontal cap.
const WALL_HEIGHT = { 1: 120, 2: 155, 3: 190 } as Record<number, number>;
const WALL_HALO = 1.55;
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
  if (h >= 20) return tr("all day");
  if (h >= 1) return tr("{0} h", { 0: Math.round(h * 10) / 10 });
  return tr("{0} min", { 0: Math.max(1, Math.round(ms / 60000)) });
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
    return { phase, text: tr("Opens in {0}", { 0: clock(zone.opensAt - now) }), window };
  if (phase === "open")
    return zone.closesAt - zone.opensAt >= 20 * 3600000 &&
      zone.closesAt - now > 6 * 3600000
      ? { phase, text: tr("Open now"), window }
      : { phase, text: tr("Closes in {0}", { 0: clock(zone.closesAt - now) }), window };
  if (phase === "done") return { phase, text: tr("Cleared"), window };
  if (phase === "closed") return { phase, text: tr("Closed · new zones tomorrow"), window };
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
    loot.push({ id: "gold", kind: "gold", name: tr("Gold"), image: "gold-coin" });
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

type Feature = {
  type: "Feature";
  properties: Record<string, string | number | boolean>;
  geometry:
    | { type: "Polygon"; coordinates: Polygon }
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: Ring };
};

/** Presentation-only tier tint: Tier 1 green, Tier 2 yellow, Tier 3 red (not a reward promise). */
export function zoneAuraColor(tier: number) {
  return tier >= 3 ? "#ff5d6c" : tier === 2 ? "#ffd25a" : "#45d6a0";
}

/** Boundary paths for open sky curtains. No filled polygon, roof or offset footprint. */
export function zoneWallFeatures(zones: readonly Zone[], quests: readonly Quest[], now: number): Feature[] {
  const out: Feature[] = [];
  for (const z of zones) {
    const phase = zonePhase(z, quests, now);
    // Every zone stays visible all day (owner, 11 Nov 2026): closed and
    // cleared zones keep a low, dimmed wall instead of disappearing.
    if (phase === "unknown") continue;
    const spent = phase === "closed" || phase === "done";
    // Tier 2 and 3 open for a short window only: outside it they keep the
    // full wall and colour, so the rarer zones can be seen all day. A zone
    // the player cleared still steps back.
    const lit = phase === "open" || (z.tier >= 2 && phase !== "done");
    const height = (WALL_HEIGHT[z.tier] || WALL_HEIGHT[1]) * (lit ? 1 : spent ? .5 : .82);
    for (const poly of zonePolygons(z)) for (const ring of poly) {
      if (ring.length < 4) continue;
      out.push({type:"Feature",properties:{id:z.id,color:zoneAuraColor(z.tier),height,halo:height*WALL_HALO,dim:!lit,rarity:zoneRarity(z.tier)},geometry:{type:"LineString",coordinates:ring}});
    }
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
    const h = ({1:42,2:56,3:72} as Record<number,number>)[z.tier] || 42,
      visualScale = totemHeight(z.tier) / h,
      kind = zoneObjectPresentation(z, quests, context).kind;
    const spent = phase === "done" || phase === "unknown" || (phase === "closed" && z.tier < 2);
    const color = spent ? "#a59aa9" : zoneAuraColor(z.tier);
    const part = (
      r: number,
      sides: number,
      base: number,
      top: number,
      c = color,
    ) =>
      out.push({
        type: "Feature",
        properties: { id: z.id, color: c, base: base * visualScale, height: top * visualScale },
        geometry: {
          type: "Polygon",
          coordinates: [circle(z.lng, z.lat, r * visualScale, sides)],
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

/** Height of a sky beam in metres: visible over the city from far away. */
export const BEAM_HEIGHT = { zone: 420, event: 300, find: 48, actor: 260 };
export type BeamKind = keyof typeof BEAM_HEIGHT;
export type BeamSpot = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  kind: BeamKind;
  /** Lit beams are full strength; a dim beam marks something opening later. */
  dim?: boolean;
};

/**
 * Sky beams: a thin bright core and a wide faint halo rising from a spot, so
 * a player sees where the zones, events and important NPCs are from far away.
 * Open zones get a full beam, rare zones that open later a dim one.
 */
export function zoneBeamSpots(
  zones: readonly Zone[],
  quests: readonly Quest[],
  now: number,
): BeamSpot[] {
  const out: BeamSpot[] = [];
  for (const z of zones) {
    const phase = zonePhase(z, quests, now);
    if (phase === "open")
      out.push({ id: z.id, lat: z.lat, lng: z.lng, color: z.color, kind: "zone" });
    else if (phase === "upcoming" && z.tier >= 3)
      out.push({ id: z.id, lat: z.lat, lng: z.lng, color: z.color, kind: "event", dim: true });
  }
  return out;
}

export function beamFeatures(spots: readonly BeamSpot[]): Feature[] {
  const out: Feature[] = [];
  for (const b of spots) {
    const height = BEAM_HEIGHT[b.kind] * (b.dim ? 0.6 : 1);
    // A totem stands at a zone centre: the beam rises out of its crown.
    const base = b.kind === "zone" || b.kind === "event" ? 6 : 2;
    for (const [part, r] of [["core", b.kind === "find" ? 1.4 : 2.2], ["halo", b.kind === "find" ? 4 : 6.5]] as const)
      out.push({
        type: "Feature",
        properties: {
          id: `${b.id}:${part}`,
          part,
          color: b.color,
          base,
          height,
          dim: !!b.dim,
        },
        geometry: { type: "Polygon", coordinates: [circle(b.lng, b.lat, r, 10)] },
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

/** Milliseconds `timeZone` is ahead of UTC at instant `t`. */
function tzOffset(t: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(t);
  const v = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * The next local midnight in the world's time zone: when the daily world
 * swaps and a zone gets fresh activities and rewards (docs/WORLD-GENERATION.md,
 * GEO08). DST-safe; an unknown zone name falls back to Europe/Prague.
 */
export function nextLocalMidnight(now: number, timeZone = "Europe/Prague") {
  let zoneName = timeZone;
  try {
    tzOffset(now, zoneName);
  } catch {
    zoneName = "Europe/Prague";
  }
  const local = new Date(now + tzOffset(now, zoneName));
  const wallMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
  );
  // Two passes settle the offset on a DST change day.
  let at = wallMidnight - tzOffset(wallMidnight, zoneName);
  at = wallMidnight - tzOffset(at, zoneName);
  return at;
}

export type ZoneSchedule = {
  phase: ZonePhase;
  opensAt: number;
  closesAt: number;
  /** Activities finished today / all of today's activities in the zone. */
  done: number;
  total: number;
  /** When the daily world swaps and the zone's rewards are fresh again. */
  resetAt: number;
  xp: number;
  gold_u: number;
  loot: ZoneLoot[];
};

/** Everything the zone detail says about today's rewards and their reset. */
export function zoneSchedule(
  zone: Zone,
  quests: readonly Quest[],
  now: number,
  timeZone?: string,
): ZoneSchedule {
  const linked = linkedQuests(zone, quests);
  const open = linked.filter((q) => !q.completed);
  return {
    phase: zonePhase(zone, quests, now),
    opensAt: zone.opensAt,
    closesAt: zone.closesAt,
    done: linked.length - open.length,
    total: linked.length,
    resetAt: nextLocalMidnight(now, timeZone),
    xp: open.reduce((sum, q) => sum + (q.xp || 0), 0),
    gold_u: open.reduce((sum, q) => sum + (q.gold_u || 0), 0),
    loot: zoneLoot(zone, quests).filter((l) => l.kind === "aura"),
  };
}
