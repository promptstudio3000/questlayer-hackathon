// Content for the "How it works" one-pager (docs/HOW-IT-WORKS-PLAN.md).
// Numbers are read from the same rules files the server uses, so the page
// cannot drift from the game: the level table, the staker gates and the
// curated place badges. Season numbers mirror docs/SEASON.md defaults.
import levelTable from "../../server/data/level-table.json" with { type: "json" };
import stakerGates from "../../server/data/staker-gates.json" with { type: "json" };
import placeBadges from "../../server/data/place-badges.json" with { type: "json" };

export const CHAPTERS = [
  { id: "start", label: "Start" },
  { id: "walk", label: "Walk and collect" },
  { id: "zones", label: "Daily zones" },
  { id: "levels", label: "Levels" },
  { id: "collectibles", label: "Collectibles" },
  { id: "badges", label: "Badges" },
  { id: "npcs", label: "NPCs and traders" },
  { id: "staking", label: "Staking" },
  { id: "seasons", label: "Seasons" },
  { id: "fair-play", label: "Fair play" },
  { id: "join", label: "How to join" },
] as const;
export type ChapterId = (typeof CHAPTERS)[number]["id"];

export type LevelRung = Readonly<{
  level: number;
  xp: number;
  unlock: string;
  item: string | null;
}>;
/** L1–L10 with the unlock each level opens (and its level Aura, if any). */
export const LEVEL_LADDER: readonly LevelRung[] = levelTable.levels.map((l) => ({
  level: l.level,
  xp: l.requiredXp,
  unlock: l.unlock.title,
  item: (l as { item?: { name: string } }).item?.name ?? null,
}));
export const MAX_LEVEL = levelTable.maxLevel;

export const STAKER_MIN_NEAR = Number(stakerGates.stakerMinNear);
/** Vault tiers from docs/GAME-RULES.md E04 (1 NEAR = 1,000 GOLD, weighted by contribution). */
export const TIER_NEAR = Object.freeze({ tier2: 50, tier3: 100 });

type Step = "staker" | "tier2" | "tier3";
const STEP_LABEL: Record<Step, string> = {
  staker: "Staker",
  tier2: "Tier 2",
  tier3: "Tier 3",
};
export type StakerRung = Readonly<{
  key: string;
  step: Step;
  stepLabel: string;
  level: number;
  unlocks: readonly string[];
}>;
/** The staker ladder grouped by step + level, in the order a player meets it. */
export const STAKER_LADDER: readonly StakerRung[] = (() => {
  const rungs = new Map<string, { step: Step; level: number; unlocks: string[] }>();
  for (const gate of Object.values(stakerGates.gates)) {
    const step = gate.step as Step;
    const key = `${step}-${gate.level}`;
    const rung = rungs.get(key) ?? { step, level: gate.level, unlocks: [] };
    rung.unlocks.push(gate.label);
    rungs.set(key, rung);
  }
  const order: Step[] = ["staker", "tier2", "tier3"];
  return [...rungs.entries()]
    .map(([key, r]) => ({ key, ...r, stepLabel: STEP_LABEL[r.step] }))
    .sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step) || a.level - b.level);
})();

export const PLACE_BADGE_COUNT = placeBadges.badges.length;
/** A few real places from the curated list, for the badge scene. */
export const SAMPLE_PLACES = ["peak-snezka", "peak-lysa-hora", "landmark-prague-castle", "city-plzen"]
  .map((id) => placeBadges.badges.find((b) => b.id === id))
  .filter((b): b is (typeof placeBadges.badges)[number] => !!b)
  .concat(placeBadges.badges)
  .filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i)
  .slice(0, 4)
  .map((b) => ({ id: b.id, name: b.name, kind: b.kind }));

export const SEASON = Object.freeze({
  goal: 30,
  points: [
    { id: "hunt", label: "Hunt", points: 1 },
    { id: "visit", label: "Zone visit", points: 2 },
    { id: "line", label: "NPC line", points: 3 },
  ],
  ranks: ["Explorer", "Season finisher", "Trailblazer", "Season legend"],
  lengthDays: 14,
});

/** Daily zones: 3 free, 2 Tier 2, 1 Tier 3 (docs/GAME-LOOPS.md §3). */
export const DAILY_ZONES = [
  { id: "z1", tier: 1 },
  { id: "z2", tier: 1 },
  { id: "z3", tier: 1 },
  { id: "z4", tier: 2 },
  { id: "z5", tier: 2 },
  { id: "z6", tier: 3 },
] as const;
