import { tr } from "../i18n";
import { MARKER, SIGNAL_SITES } from "../../server/layer/story-world.mjs";

export type StoryState = {
  seed: string;
  stage: "expedition" | "quarry" | "signals" | "marker" | "beacon" | "complete";
  signals: string[]; quarry: boolean; basalt: number; basaltGoal: number;
  marker: boolean; markerReady: boolean; finishedAt: number | null; sharedBeaconLit: boolean;
};
export type ExpeditionProgress = {
  inventory: { diamonds: number; stone: number };
  quest: { state: "available" | "discover" | "mine" | "complete"; diamonds: number; goal: number };
  story: StoryState;
  discoveries?: string[];
  settlement: "not-configured";
};
export const siteName = (id: string) => id === "garden" ? tr("Spore Garden") : id === "arch" ? tr("Tide Arch") : tr("Star Observatory");
export function storyObjective(p: ExpeditionProgress | null) {
  const s = p?.story;
  if (!s || s.stage === "expedition") {
    if (!p || p.quest.state === "available") return { title: tr("Keeper Nera"), hint: tr("Meet Nera beside the arrival path."), target: {x:12.5,z:-6.5}, ready:false };
    return { title: p?.quest.state === "mine" ? tr("Mine 10 diamonds") : p?.quest.state === "discover" ? tr("Find Crystal Hollow") : tr("Your first expedition"),
      hint: p?.quest.state === "mine" ? tr("Hold the pickaxe on glowing diamond ore.") : tr("Follow the cyan beam north of the square."),
      target: { x: 0, z: -47 }, ready: false };
  }
  if (s.stage === "quarry") return { title: tr("Echoes in basalt"), hint: tr("Visit the quarry and mine 6 basalt blocks."), target: { x: 53, z: -16 }, ready: false };
  if (s.stage === "signals") {
    const site = SIGNAL_SITES[s.signals.length];
    return { title: siteName(site.id), hint: tr("Read the inscription and tune its signal."), target: site, ready: true };
  }
  if (s.stage === "marker") return { title: tr("A light for everyone"), hint: tr("Build a trail marker at the outlined site."), target: MARKER, ready: true };
  if (s.stage === "beacon") return { title: tr("Wake the quiet beacon"), hint: tr("Return to the central beacon with your diamonds."), target: { x: 0, z: 0 }, ready: true };
  return { title: tr("The beacon is awake"), hint: tr("Keep exploring, mine or build with other explorers."), target: null, ready: false };
}

export const signalClue = (id: string) => id === "garden"
  ? tr("I grow without roots and carry a cap. Which sign belongs to this garden?")
  : id === "arch" ? tr("I rise and fall without taking a step. Which sign belongs to this arch?")
    : tr("I shine above the clouds when the world grows dark. Which sign belongs to this tower?");

export function playFailure(failure: unknown) {
  const message = failure instanceof Error ? failure.message : "";
  if (message.startsWith("That symbol")) return tr("That symbol does not match the inscription.");
  if (message === "Move closer to the signal station.") return tr("Walk closer to tune this signal.");
  if (message === "Follow the current chapter first.") return tr("Continue the story");
  return message ? tr(message) : tr("Connection problem. Try again.");
}
