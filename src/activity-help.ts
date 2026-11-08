import { tr } from "./i18n.ts";
import { activityKind } from "./activity-view.ts";
import type { HelpTopic } from "./learning-store.ts";
import type { Quest } from "./types";

export const questHelpTopic = (quest: Quest): HelpTopic => activityKind(quest);

/** Short deterministic copy; live requirements and rewards remain in the activity itself. */
export function helpText(topic: HelpTopic): string {
  switch (topic) {
    case "movement-arena": return tr("Use the pad to move. Side arrows turn your ghost.");
    case "movement-gps": return tr("Your phone's GPS moves your ghost as you walk.");
    case "find": return tr("Move over a sparkling find to collect it automatically.");
    case "coin": return tr("Move over a coin to collect it automatically.");
    case "visit": return tr("Reach the marked spot, then confirm your visit.");
    case "trail": return tr("Confirm each stop in order. The next marker stays highlighted.");
    case "return": return tr("Confirm the stops, then return to the starting marker.");
    case "hunt": return tr("Visit the marked places in any order. Each counts once.");
    case "clue": return tr("Reach the place, choose an answer, then confirm.");
    case "chest": return tr("Reach the chest and open it. The result shows what you found.");
    case "aura": return tr("Try an Aura on your ghost. It changes your look, not your power.");
    case "npc": return tr("Accept an errand, visit its stops, then return when asked.");
    case "quiz": return tr("Choose an answer before the question timer runs out.");
    case "rhythm": return tr("Tap when the beat reaches the ring.");
    case "trace": return tr("Trace the numbered runes in order, then release.");
    case "memory": return tr("Watch the runes, then repeat their order.");
    case "duel": return tr("Strike beats Trick, Trick beats Guard, Guard beats Strike. Time your choice with the ring.");
    case "boss": return tr("Everyone shares the boss's health. Your confirmed hit adds to the team's progress.");
  }
}
