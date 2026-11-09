// Map guidance for today's board and NPC lines. Loaded on demand so the
// welcome screen does not carry it (docs/PERFORMANCE-BUDGET.md).
import { api, meters } from "./api";
import { tr } from "./i18n";
import type { Coin, Point, Quest, World } from "./types";
import type { NpcMapTask } from "./npc-client";

/** The player's open NPC lines in one world (server/npc/routes.mjs). */
export const npcMapTasks = (worldId: string) =>
  api<{ worldId: string; tasks: NpcMapTask[] }>(`/actors/tasks?worldId=${encodeURIComponent(worldId)}`);

export type GoalTarget =
  | { kind: "actor"; archetypes: string[] }
  | { kind: "quest"; quest: Quest }
  | { kind: "coin"; coin: Coin }
  | { kind: "none"; text: string };

/** The nearest thing a board goal needs; hidden lurkers are never pointed at. */
export function goalTarget(
  goal: string,
  { world, position, tier, now, point }: { world: World | null; position: Point; tier: number; now: number; point: (q: Quest) => Point },
): GoalTarget {
  if (goal === "monster") return { kind: "actor", archetypes: ["roamer", "guardian"] };
  if (goal === "boss") return { kind: "actor", archetypes: ["boss"] };
  if (goal === "npc") return { kind: "actor", archetypes: ["quest_giver", "storyteller", "trader", "keeper", "wandering_rare"] };
  if (goal === "quest") {
    let best: Quest | null = null, bestM = Infinity;
    for (const q of world?.quests || []) {
      const zone = world?.zones.find((z) => z.id === q.zone_id);
      if (q.completed || !zone || zone.tier > tier || q.opens_at > now || q.closes_at <= now) continue;
      const m = meters(position, point(q));
      if (m < bestM) [best, bestM] = [q, m];
    }
    return best ? { kind: "quest", quest: best } : { kind: "none", text: tr("No quest is open near you right now. Check Discoveries for opening times.") };
  }
  const find = goal === "finds";
  let best: Coin | null = null, bestM = Infinity;
  for (const c of world?.coins || []) {
    if (c.claimant || !!c.find !== find) continue;
    const m = meters(position, c);
    if (m < bestM) [best, bestM] = [c, m];
  }
  if (best) return { kind: "coin", coin: best };
  return { kind: "none", text: find ? tr("No street find is left near you today.") : tr("No coin is left near you right now. More appear in the next wave.") };
}

/** After a claim: whom to report to, if this quest finished an NPC line. */
export function reportNote(tasks: readonly NpcMapTask[] | null, questId: string) {
  const report = tasks?.find((t) => t.ready && t.steps.some((s) => s.questId === questId));
  if (!report) return "";
  const who = report.actorName || tr("the character who gave it");
  return report.errand
    ? tr("Errand done. Go back to {0} to report: +{1} XP. Look for Report back on the map.", { 0: who, 1: report.xp })
    : tr("All steps done. Go back to {0} to turn it in. Look for Report back on the map.", { 0: who });
}
