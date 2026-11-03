import type { Quest, Zone } from "./types.ts";
import { tr } from "./i18n.ts";

// Authored for QuestLayer on a 32x32 grid. Light falls from the upper left.
// This object family is independent of the verified Aavegotchi character art.
export const GAME_OBJECT_GRID = 32;
export const GAME_OBJECT_KINDS = [
  "coin",
  "chest",
  "discovery",
  "route",
  "place",
] as const;
export const GAME_OBJECT_STATES = [
  "ready",
  "open",
  "completed",
  "locked",
] as const;
export type GameObjectKind = (typeof GAME_OBJECT_KINDS)[number];
export type GameObjectState = (typeof GAME_OBJECT_STATES)[number];
export type GameObjectOptions = {
  kind: GameObjectKind;
  state?: GameObjectState;
  selected?: boolean;
};
export const GAME_OBJECT_PALETTE = Object.freeze({
  ink: "#1A0335",
  edge: "#441C6C",
  shadow: "#2D1251",
  purple: "#672EEB",
  violet: "#BD98FF",
  pink: "#FF1DFF",
  blush: "#FFE8FF",
  gold: "#FEF87D",
  amber: "#F3BD54",
  bronze: "#B4713E",
  paper: "#FCFAFF",
  green: "#176553",
  mint: "#C9F4DE",
});
export type ObjectPixelRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}>;
const cache = new Map<string, readonly ObjectPixelRect[]>();
export function gameObjectRects({
  kind,
  state = "ready",
  selected = false,
}: GameObjectOptions): readonly ObjectPixelRect[] {
  if (!GAME_OBJECT_KINDS.includes(kind) || !GAME_OBJECT_STATES.includes(state))
    throw Error("Unknown game object art state");
  const key = `${kind}:${state}:${selected}`;
  if (cache.has(key)) return cache.get(key)!;
  const rects: ObjectPixelRect[] = [];
  const r = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: keyof typeof GAME_OBJECT_PALETTE,
  ) =>
    rects.push(
      Object.freeze({ x, y, width, height, color: GAME_OBJECT_PALETTE[color] }),
    );
  r(8, 28, 16, 2, "shadow");
  if (kind === "coin") {
    r(11, 2, 10, 2, "ink");
    r(7, 4, 18, 3, "ink");
    r(5, 7, 22, 17, "ink");
    r(7, 24, 18, 3, "ink");
    r(11, 27, 10, 2, "ink");
    r(22, 7, 3, 17, "bronze");
    r(10, 4, 10, 2, "gold");
    r(7, 7, 15, 16, "amber");
    r(10, 6, 10, 19, "gold");
    r(9, 23, 11, 3, "amber");
    r(8, 8, 2, 13, "paper");
    r(10, 6, 8, 2, "paper");
    r(20, 10, 2, 12, "bronze");
    r(14, 10, 4, 3, "edge");
    r(11, 13, 3, 5, "edge");
    r(18, 13, 3, 5, "edge");
    r(14, 18, 4, 3, "edge");
    r(14, 13, 4, 5, "amber");
    r(14, 13, 2, 2, "paper");
  } else if (kind === "chest") {
    const opened = state === "open" || state === "completed";
    r(3, 15, 26, 13, "ink");
    r(5, 18, 22, 8, "purple");
    r(5, 18, 3, 7, "violet");
    r(24, 18, 3, 8, "edge");
    r(9, 19, 2, 7, "edge");
    r(20, 19, 2, 7, "edge");
    r(7, 18, 2, 8, "amber");
    r(23, 18, 2, 8, "bronze");
    r(5, 25, 22, 1, "edge");
    if (opened) {
      r(9, 2, 14, 2, "ink");
      r(6, 4, 20, 3, "ink");
      r(4, 7, 24, 4, "ink");
      r(8, 4, 15, 2, "gold");
      r(6, 7, 20, 2, "purple");
      r(8, 7, 2, 2, "gold");
      r(22, 7, 2, 2, "amber");
      r(5, 11, 22, 7, "edge");
      r(7, 12, 18, 4, "shadow");
      r(5, 11, 22, 1, "violet");
      r(5, 17, 22, 2, "amber");
    } else {
      r(7, 6, 18, 2, "ink");
      r(4, 8, 24, 3, "ink");
      r(3, 11, 26, 7, "ink");
      r(7, 8, 17, 2, "gold");
      r(5, 11, 22, 5, "purple");
      r(5, 11, 3, 4, "violet");
      r(8, 10, 2, 6, "gold");
      r(23, 10, 2, 6, "amber");
      r(5, 16, 22, 2, "gold");
    }
    r(13, 16, 6, 7, "ink");
    r(14, 17, 4, 5, "gold");
    r(15, 18, 2, 2, "edge");
    r(15, 20, 1, 1, "edge");
    r(6, 20, 1, 3, "blush");
  } else if (kind === "route") {
    r(8, 3, 18, 2, "ink");
    r(5, 5, 24, 22, "ink");
    r(3, 8, 4, 17, "ink");
    r(7, 5, 17, 21, "gold");
    r(7, 7, 15, 17, "paper");
    r(24, 7, 3, 19, "violet");
    r(25, 9, 2, 16, "purple");
    r(5, 9, 2, 14, "amber");
    r(10, 9, 3, 9, "edge");
    r(10, 16, 10, 3, "edge");
    r(17, 17, 3, 7, "edge");
    r(9, 8, 5, 5, "ink");
    r(10, 9, 3, 3, "pink");
    r(10, 9, 1, 1, "blush");
    r(16, 22, 5, 5, "ink");
    r(17, 23, 3, 3, "amber");
    r(18, 23, 1, 1, "paper");
  } else if (kind === "discovery") {
    r(15, 2, 2, 4, "ink");
    r(12, 5, 8, 3, "ink");
    r(8, 8, 16, 4, "ink");
    r(5, 12, 22, 8, "ink");
    r(8, 20, 16, 4, "ink");
    r(12, 24, 8, 3, "ink");
    r(15, 27, 2, 3, "ink");
    r(13, 7, 6, 3, "violet");
    r(9, 10, 14, 3, "purple");
    r(7, 13, 18, 6, "purple");
    r(10, 19, 12, 3, "edge");
    r(14, 22, 4, 3, "edge");
    r(9, 12, 3, 6, "pink");
    r(12, 10, 3, 10, "blush");
    r(15, 13, 7, 4, "gold");
    r(15, 17, 4, 4, "amber");
    r(16, 13, 2, 2, "paper");
  } else {
    r(10, 3, 12, 2, "ink");
    r(7, 5, 18, 3, "ink");
    r(5, 8, 22, 12, "ink");
    r(8, 20, 16, 3, "ink");
    r(11, 23, 10, 3, "ink");
    r(14, 26, 4, 4, "ink");
    r(10, 5, 12, 2, "blush");
    r(8, 8, 16, 11, "violet");
    r(8, 8, 3, 9, "paper");
    r(22, 8, 3, 11, "purple");
    r(11, 20, 10, 3, "purple");
    r(14, 23, 4, 3, "edge");
    r(12, 10, 8, 7, "edge");
    r(14, 12, 4, 3, "gold");
    r(14, 12, 1, 1, "paper");
  }
  if (state === "completed") {
    r(22, 21, 8, 2, "ink");
    r(20, 23, 12, 7, "ink");
    r(22, 30, 8, 2, "ink");
    r(22, 23, 8, 7, "green");
    r(22, 25, 2, 2, "mint");
    r(24, 27, 2, 2, "mint");
    r(26, 25, 2, 2, "mint");
    r(28, 23, 2, 2, "mint");
  } else if (state === "locked") {
    r(23, 18, 6, 2, "ink");
    r(21, 20, 3, 5, "ink");
    r(28, 20, 3, 5, "ink");
    r(20, 24, 12, 8, "ink");
    r(22, 25, 8, 5, "amber");
    r(22, 25, 2, 4, "gold");
    r(25, 26, 2, 3, "edge");
  }
  if (selected) {
    for (const [x, y, sx, sy] of [
      [0, 0, 1, 1],
      [31, 0, -1, 1],
      [0, 31, 1, -1],
      [31, 31, -1, -1],
    ]) {
      r(sx === 1 ? x : x - 6, sy === 1 ? y : y - 2, 7, 3, "ink");
      r(sx === 1 ? x : x - 2, sy === 1 ? y : y - 6, 3, 7, "ink");
      r(sx === 1 ? x + 1 : x - 5, sy === 1 ? y + 1 : y - 1, 5, 1, "pink");
      r(sx === 1 ? x + 1 : x - 1, sy === 1 ? y + 1 : y - 5, 1, 5, "pink");
    }
  }
  const result = Object.freeze(rects);
  cache.set(key, result);
  return result;
}
function pixelScale(scale: number) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 8)
    throw Error("Pixel scale must be an integer from 1 to 8");
  return scale;
}
export function rasterizeGameObject(options: GameObjectOptions, scale = 1) {
  const width = GAME_OBJECT_GRID * pixelScale(scale),
    height = width,
    data = new Uint8Array(width * height * 4);
  for (const r of gameObjectRects(options)) {
    const color = [
      parseInt(r.color.slice(1, 3), 16),
      parseInt(r.color.slice(3, 5), 16),
      parseInt(r.color.slice(5, 7), 16),
      255,
    ];
    for (let y = r.y * scale; y < (r.y + r.height) * scale; y++)
      for (let x = r.x * scale; x < (r.x + r.width) * scale; x++)
        data.set(color, 4 * (y * width + x));
  }
  return { width, height, data };
}
export function drawGameObject(
  context: Pick<
    CanvasRenderingContext2D,
    "fillRect" | "clearRect" | "fillStyle" | "imageSmoothingEnabled"
  >,
  options: GameObjectOptions,
  scale = 1,
) {
  pixelScale(scale);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, GAME_OBJECT_GRID * scale, GAME_OBJECT_GRID * scale);
  for (const r of gameObjectRects(options)) {
    context.fillStyle = r.color;
    context.fillRect(
      r.x * scale,
      r.y * scale,
      r.width * scale,
      r.height * scale,
    );
  }
}

export type GameObjectPresentation = {
  kind: GameObjectKind;
  state: GameObjectState;
  label: string;
};
export type ObjectContext = { now: number; playerTier?: number };
export function questObjectPresentation(
  q: Quest,
  { now, playerTier }: ObjectContext,
): GameObjectPresentation {
  const completed = q.completed > 0;
  const chest = q.kind === "chest";
  const route =
    q.kind === "route" ||
    q.activity?.icon === "trail" ||
    q.activity?.icon === "return";
  const discovery = q.kind === "visit" || q.activity?.icon === "visit";
  const kind: GameObjectKind =
    chest && (completed || q.itemAvailable === true)
      ? "chest"
      : route
        ? "route"
        : chest
          ? "place"
          : discovery
            ? "discovery"
            : "place";
  if (completed)
    return {
      kind,
      state: "completed",
      label: tr("Visited · personal activity complete"),
    };
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(q.opens_at) ||
    !Number.isFinite(q.closes_at)
  )
    return {
      kind: "place",
      state: "locked",
      label: tr("Activity status unavailable · refresh details"),
    };
  if (q.closes_at <= now)
    return { kind, state: "locked", label: tr("Closed · activity ended") };
  if (q.opens_at > now) return { kind, state: "locked", label: tr("Opens later") };
  if (Number.isFinite(playerTier) && q.tier > playerTier!)
    return { kind, state: "locked", label: tr("Requires Tier {0}", { 0: q.tier }) };
  return {
    kind,
    state: "ready",
    label: chest
      ? q.itemAvailable === true
        ? tr("Chest activity · item available in current data")
        : q.itemAvailable === false
          ? tr("Chest activity · no item remaining")
          : tr("Chest activity · item availability unknown")
      : route
        ? tr("Walk activity · follow its published requirements")
        : discovery
          ? tr("Discovery activity · read its requirements")
          : tr("Place activity · read its requirements"),
  };
}
function linkedZoneQuests(zone: Zone, quests: readonly Quest[]) {
  return quests.filter(
    (q) =>
      q.zone_id === zone.id ||
      (!q.zone_id &&
        zone.id.includes(":zone:") &&
        q.id === zone.id.replace(":zone:", ":quest:")),
  );
}
export function representativeZoneQuest(
  zone: Zone,
  quests: readonly Quest[],
  context: ObjectContext,
): Quest | undefined {
  const linked = linkedZoneQuests(zone, quests);
  const nonChest = (q: Quest) =>
    q.kind === "visit" ||
    q.kind === "route" ||
    q.activity?.icon === "visit" ||
    q.activity?.icon === "trail" ||
    q.activity?.icon === "return";
  const known = (q: Quest) => q.kind === "chest" || nonChest(q);
  const zoneOpen =
    Number.isFinite(context.now) &&
    Number.isFinite(zone.opensAt) &&
    Number.isFinite(zone.closesAt) &&
    zone.opensAt <= context.now &&
    zone.closesAt > context.now &&
    (!Number.isFinite(context.playerTier) || zone.tier <= context.playerTier!);
  const active = zoneOpen
    ? linked.filter(
        (q) => questObjectPresentation(q, context).state === "ready",
      )
    : [];
  return (
    active.find(nonChest) ||
    active.find(known) ||
    active[0] ||
    linked.find((q) => !q.completed && known(q)) ||
    linked.find(known) ||
    linked[0]
  );
}
export function zoneObjectPresentation(
  zone: Zone,
  quests: readonly Quest[],
  context: ObjectContext,
): GameObjectPresentation {
  const linked = linkedZoneQuests(zone, quests);
  const art = linked.map((q) => questObjectPresentation(q, context));
  if (art.length && art.every((a) => a.state === "completed"))
    return {
      kind: linked.length === 1 ? art[0].kind : "place",
      state: "completed",
      label: tr("Visited · all loaded activities complete"),
    };
  if (
    !Number.isFinite(context.now) ||
    !Number.isFinite(zone.opensAt) ||
    !Number.isFinite(zone.closesAt)
  )
    return {
      kind: "place",
      state: "locked",
      label: tr("Place status unavailable · refresh details"),
    };
  if (zone.closesAt <= context.now)
    return {
      kind: "place",
      state: "locked",
      label: tr("Place closed · opening period ended"),
    };
  if (zone.opensAt > context.now)
    return { kind: "place", state: "locked", label: tr("Place opens later") };
  if (Number.isFinite(context.playerTier) && zone.tier > context.playerTier!)
    return {
      kind: "place",
      state: "locked",
      label: tr("Place requires Tier {0}", { 0: zone.tier }),
    };
  if (!linked.length)
    return {
      kind: "place",
      state: "ready",
      label: tr("Place · activity details not loaded"),
    };
  const active = linked.filter((_, i) => art[i].state === "ready");
  if (active.length) {
    const next = representativeZoneQuest(zone, linked, context)!;
    const presentation = questObjectPresentation(next, context);
    return {
      ...presentation,
      label: `${active.length} current ${active.length === 1 ? "activity" : "activities"} · ${presentation.label}`,
    };
  }
  if (art.length === 1) return art[0];
  return {
    kind: "place",
    state: "locked",
    label: tr("Place · remaining activities are closed or locked"),
  };
}
