/** Manual selections outrank suggestions. Only one objective owns the map HUD. */
export const OBJECTIVE_ORDER = ["selection", "native", "receipt", "notice", "coach", "find", "quest"] as const;
export type MapObjective = typeof OBJECTIVE_ORDER[number] | "empty";
export function mapObjective(available: Partial<Record<Exclude<MapObjective, "empty">, boolean>>): MapObjective {
  return OBJECTIVE_ORDER.find((kind) => available[kind]) ?? "empty";
}

/** A nearby encounter must not hide a confirmed result or the next equipment action. */
export function canOfferNearbyAction(objective: MapObjective, coachStep?: string, dismissed = false, activeQuest = false, atQuestTarget = false): boolean {
  if (dismissed) return true;
  if (activeQuest) return atQuestTarget;
  if (objective === "receipt" || objective === "notice") return false;
  return objective !== "coach" || ["find", "coin", "chest"].includes(coachStep || "");
}
