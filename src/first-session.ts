
import { tr } from "./i18n.ts";// The guided first five minutes: name → nearest find → first coin → first
// chest → Aura → secure or share. Progress is derived from the player's
// confirmed server state wherever possible (history, inventory, secured
// state); only "shared" has no server trace, so it is a local mark. Nothing
// here grants rewards; it only points at the next playable action.

export type FirstStepId = "name" | "find" | "coin" | "chest" | "aura" | "secure";

export type FirstStep = {
  id: FirstStepId;
  title: string;
  /** Short fallback instruction when the guide has no live hint. */
  hint: string;
  /** Primary action label on the coach card. */
  action: string;
  /** Spoken/visible line after the step completes. */
  done: string;
};

export const FIRST_STEPS: FirstStep[] = [
  {
    id: "name",
    get title() { return tr("Name your ghost"); },
    get hint() { return tr("Pick a name so other explorers know who found what."); },
    get action() { return tr("Start exploring"); },
    get done() { return tr("Your ghost has a name."); },
  },
  {
    id: "find",
    get title() { return tr("Reach the nearest find"); },
    get hint() { return tr("A street find waits nearby. Walk there and your ghost picks it up."); },
    get action() { return tr("Point me there"); },
    get done() { return tr("First street find collected."); },
  },
  {
    id: "coin",
    get title() { return tr("Pick up a coin"); },
    get hint() { return tr("Coins lie along the streets. Walk over one to pick it up."); },
    get action() { return tr("Point me to a coin"); },
    get done() { return tr("First coin in your pocket."); },
  },
  {
    id: "chest",
    get title() { return tr("Open your first chest"); },
    get hint() { return tr("Chests hide in parks. Walk to the nearest one and open it."); },
    get action() { return tr("Show the chest"); },
    get done() { return tr("Chest opened."); },
  },
  {
    id: "aura",
    get title() { return tr("Wear your Aura"); },
    get hint() { return tr("An Aura is the glow your ghost wears. Try it on to see it on the map."); },
    get action() { return tr("Try it on"); },
    get done() { return tr("Your ghost is glowing."); },
  },
  {
    id: "secure",
    get title() { return tr("Secure or share it"); },
    get hint() { return tr("Keep your Aura for good, or share a card of it with a friend."); },
    get action() { return tr("Secure or share"); },
    get done() { return tr("All set. The city is yours to explore."); },
  },
];

type HistoryEntry = { kind: string; title: string };
type InventoryItem = {
  id?: string;
  kind: string;
  equipped: number | boolean;
  native_claim_state?: string | null;
};
export type FirstSessionPlayer = {
  id: string;
  name: string;
  history: HistoryEntry[];
  inventory: InventoryItem[];
  nativeOutfit?: boolean;
};
export type FirstSessionMarks = Partial<Record<FirstStepId, true>> & {
  hidden?: true;
  finished?: true;
};

export type FirstSessionProgress = {
  steps: { step: FirstStep; done: boolean }[];
  current: FirstStep | null;
  completed: number;
  total: number;
};

/** Which steps the confirmed player state already proves. */
export function provenSteps(player: FirstSessionPlayer | null): Set<FirstStepId> {
  const proven = new Set<FirstStepId>();
  if (!player) return proven;
  proven.add("name");
  for (const h of player.history || []) {
    if (h.kind === "coin" && h.title === "Street find") proven.add("find");
    if (h.kind === "coin" && h.title === "Street coin") proven.add("coin");
  }
  // Testnet starter-kit Auras (TEST_SEED, ids "seed-kit-…") are handed out
  // at sign-up; they must not tick off "open a chest" / "wear your Aura",
  // or a newcomer on the test world skips the core loop.
  const auras = (player.inventory || []).filter(
    (i) => i.kind === "aura" && !String(i.id || "").startsWith("seed-kit-"),
  );
  if (auras.length) proven.add("chest");
  if (player.nativeOutfit || auras.some((i) => !!i.equipped)) proven.add("aura");
  if (auras.some((i) => i.native_claim_state === "minted")) proven.add("secure");
  return proven;
}

export function firstSessionProgress(
  player: FirstSessionPlayer | null,
  marks: FirstSessionMarks = {},
): FirstSessionProgress {
  const proven = provenSteps(player);
  // A later step implies the earlier chest/aura steps: an equipped Aura
  // means a chest was opened even if the history window rolled over.
  if (proven.has("aura") || proven.has("secure")) proven.add("chest");
  const steps = FIRST_STEPS.map((step) => ({
    step,
    done: proven.has(step.id) || !!marks[step.id],
  }));
  const current = steps.find((s) => !s.done)?.step || null;
  return {
    steps,
    current,
    completed: steps.filter((s) => s.done).length,
    total: steps.length,
  };
}

/** Steps that just turned done between two progress snapshots. */
export function newlyCompleted(
  before: FirstSessionProgress | null,
  after: FirstSessionProgress,
): FirstStep[] {
  if (!before) return [];
  return after.steps
    .filter((s, i) => s.done && !before.steps[i]?.done)
    .map((s) => s.step);
}

const MARKS = (playerId: string) => `questlayer-first-session:${playerId}`;

export function readMarks(playerId: string): FirstSessionMarks {
  try {
    const raw = localStorage.getItem(MARKS(playerId));
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function writeMarks(playerId: string, marks: FirstSessionMarks) {
  try {
    localStorage.setItem(MARKS(playerId), JSON.stringify(marks));
  } catch {}
}
