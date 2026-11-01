// Level table to L10 (docs/GAME-LOOPS.md P0-1). One unlock per level, read from
// server/data/level-table.json, with an optional operator override file
// (LEVEL_TABLE_FILE) so every default stays configurable without a code change.
// Unlocks are things to do or wear only: nothing here touches odds, damage,
// GOLD or payouts. Level-item editions (`item`) stay off unless
// LEVEL_ITEM_EDITIONS=1, because the owner has not decided on them yet.
import { readFileSync } from "node:fs";
import { levelFor } from "./domain.mjs";

const DEFAULT_TABLE = JSON.parse(
  readFileSync(new URL("./data/level-table.json", import.meta.url), "utf8"),
);
const KINDS = new Set(["start", "aura", "craft", "quest-slot", "title", "ring"]);
const STATUSES = new Set(["live", "coming"]);

export const requiredXpFor = (level) => 100 * (level - 1) ** 2;

/** Validate and freeze a table. Throws on anything the game can't honour. */
export function normalizeLevelTable(raw, { itemEditions = false } = {}) {
  if (!raw || !Array.isArray(raw.levels)) throw new Error("Level table needs a levels array.");
  const levels = raw.levels
    .map((entry) => {
      const level = Number(entry.level);
      if (!Number.isInteger(level) || level < 1 || level > 50) throw new Error(`Bad level ${entry.level}.`);
      if (Number(entry.requiredXp) !== requiredXpFor(level))
        throw new Error(`Level ${level} must need ${requiredXpFor(level)} XP (levelFor curve).`);
      const u = entry.unlock || {};
      if (typeof u.id !== "string" || !u.id || typeof u.title !== "string" || !u.title)
        throw new Error(`Level ${level} needs an unlock id and title.`);
      if (!KINDS.has(u.kind)) throw new Error(`Level ${level} has unknown unlock kind ${u.kind}.`);
      const status = u.status || "live";
      if (!STATUSES.has(status)) throw new Error(`Level ${level} has unknown status ${status}.`);
      const item =
        itemEditions && entry.item && typeof entry.item.edition === "string" && entry.item.edition
          ? Object.freeze({ edition: entry.item.edition, name: String(entry.item.name || entry.item.edition) })
          : null;
      return Object.freeze({
        level,
        requiredXp: requiredXpFor(level),
        unlock: Object.freeze({ id: u.id, kind: u.kind, title: u.title, status, ...(u.value !== undefined ? { value: u.value } : {}) }),
        item,
      });
    })
    .sort((a, b) => a.level - b.level);
  levels.forEach((entry, i) => {
    if (entry.level !== i + 1) throw new Error("Level table must list every level from 1 without gaps.");
  });
  return Object.freeze({
    version: Number(raw.version) || 1,
    maxLevel: levels.length,
    itemEditions: !!itemEditions,
    levels: Object.freeze(levels),
  });
}

export function loadLevelTable(env = process.env) {
  const itemEditions = env.LEVEL_ITEM_EDITIONS === "1";
  const raw = env.LEVEL_TABLE_FILE ? JSON.parse(readFileSync(env.LEVEL_TABLE_FILE, "utf8")) : DEFAULT_TABLE;
  return normalizeLevelTable(raw, { itemEditions });
}

let current = loadLevelTable();
export const levelTable = () => current;
/** Tests and the operator CLI can swap the table; returns the previous one. */
export function setLevelTable(table) {
  const previous = current;
  current = table;
  return previous;
}

/** Progress view for an XP amount: the shape the HUD bar uses. */
export function levelProgress(xp, table = current) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0));
  const level = levelFor(safe);
  const levelStartXp = requiredXpFor(level),
    nextLevelXp = requiredXpFor(level + 1);
  const unlocked = table.levels.filter((entry) => entry.level <= level);
  const next = table.levels.find((entry) => entry.level > level) || null;
  return {
    xp: safe,
    level,
    levelStartXp,
    nextLevelXp,
    percent: Math.min(100, Math.floor(((safe - levelStartXp) / (nextLevelXp - levelStartXp)) * 100)),
    maxed: level >= table.maxLevel,
    unlocked: unlocked.map((entry) => entry.unlock.id),
    next,
  };
}

/** A live unlock's value for this level, or `fallback` while it is still locked. */
export function unlockValue(level, id, fallback, table = current) {
  const entry = table.levels.find((e) => e.unlock.id === id && e.unlock.status === "live");
  if (!entry || level < entry.level || entry.unlock.value === undefined) return fallback;
  return entry.unlock.value;
}

/** Daily altar offerings at this level (L6 default: 2). */
export const altarOfferingsPerDay = (level, base, table = current) =>
  Math.max(base, Number(unlockValue(level, "altar-second-offering", base, table)) || base);

const liveUnlocks = (level, kind, table) =>
  table.levels.filter((e) => e.unlock.kind === kind && e.unlock.status === "live" && e.level <= level);

/** Extra quest lines per NPC and day at this level: every live quest-slot unlock adds up (L7 +1, L8 +1). */
export const extraQuestLines = (level, table = current) =>
  liveUnlocks(level, "quest-slot", table).reduce((n, e) => n + Math.max(0, Number(e.unlock.value) || 0), 0);

/** Highest cosmetic title earned by level, or null (L5 "Wayfarer", L9 "Pathfinder"). */
export const levelTitle = (level, table = current) => {
  const value = liveUnlocks(level, "title", table).at(-1)?.unlock.value;
  return typeof value === "string" && value ? value : null;
};

/** Level-item editions (only with LEVEL_ITEM_EDITIONS=1), as native level milestones. */
export function levelItemMilestones(table = current) {
  if (!table.itemEditions) return [];
  return table.levels
    .filter((entry) => entry.item)
    .map((entry) => ({
      level: entry.level,
      requiredXp: String(entry.requiredXp),
      edition: entry.item.edition,
      name: entry.item.name,
    }));
}

/** Public view for GET /api/levels. */
export function publicLevelTable(table = current) {
  return {
    version: table.version,
    maxLevel: table.maxLevel,
    itemEditions: table.itemEditions,
    levels: table.levels.map((entry) => ({
      level: entry.level,
      requiredXp: entry.requiredXp,
      unlock: entry.unlock,
      ...(entry.item ? { item: entry.item } : {}),
    })),
  };
}
