// Client view of the level table (server/data/level-table.json, served with any
// operator override at GET /api/levels). Same curve as levelFor on the server:
// level n starts at 100*(n-1)^2 XP. Unlocks are things to do or wear only.
import table from "../server/data/level-table.json" with { type: "json" };
import { api } from "./api";

export type LevelUnlock = Readonly<{
  id: string;
  kind: string;
  title: string;
  status: "live" | "coming";
  value?: unknown;
}>;
export type LevelEntry = Readonly<{
  level: number;
  requiredXp: number;
  unlock: LevelUnlock;
  item?: Readonly<{ edition: string; name: string }>;
}>;
export type LevelTable = Readonly<{
  version: number;
  maxLevel: number;
  itemEditions: boolean;
  levels: readonly LevelEntry[];
}>;
export type LevelProgress = Readonly<{
  xp: number;
  level: number;
  levelStartXp: number;
  nextLevelXp: number;
  percent: number;
  maxed: boolean;
  next: LevelEntry | null;
  title: string | null;
}>;

/** Bundled table, items hidden (the server decides LEVEL_ITEM_EDITIONS). */
export const DEFAULT_LEVEL_TABLE: LevelTable = Object.freeze({
  version: table.version,
  maxLevel: table.levels.length,
  itemEditions: false,
  levels: (table.levels as LevelEntry[]).map(({ item: _item, ...rest }) => rest),
});

export const requiredXpFor = (level: number) => 100 * (level - 1) ** 2;
export const levelForXp = (xp: number) =>
  Math.min(50, 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100)));

export function levelProgress(
  xpValue: number | string | bigint,
  levels: LevelTable = DEFAULT_LEVEL_TABLE,
): LevelProgress {
  const xp = Math.max(0, Math.floor(Number(xpValue) || 0));
  const level = levelForXp(xp);
  const levelStartXp = requiredXpFor(level),
    nextLevelXp = requiredXpFor(level + 1);
  const titleEntry = levels.levels.find(
    (e) =>
      e.unlock.kind === "title" &&
      e.unlock.status === "live" &&
      e.level <= level &&
      typeof e.unlock.value === "string",
  );
  return {
    xp,
    level,
    levelStartXp,
    nextLevelXp,
    percent: Math.min(
      100,
      Math.floor(((xp - levelStartXp) / (nextLevelXp - levelStartXp)) * 100),
    ),
    maxed: level >= levels.maxLevel,
    next: levels.levels.find((e) => e.level > level) ?? null,
    title: (titleEntry?.unlock.value as string | undefined) ?? null,
  };
}

let cached: Promise<LevelTable> | null = null;
/** The served table (operator overrides, item flag); falls back to the bundled one. */
export function loadLevelTable(): Promise<LevelTable> {
  cached ??= api<LevelTable>("/levels").then(
    (t) => (Array.isArray(t?.levels) && t.levels.length ? t : DEFAULT_LEVEL_TABLE),
    () => {
      cached = null;
      return DEFAULT_LEVEL_TABLE;
    },
  );
  return cached;
}
