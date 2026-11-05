/** Manual selections outrank suggestions. Only one objective owns the map HUD. */
export const OBJECTIVE_ORDER = ["selection", "native", "receipt", "notice", "coach", "find", "quest"] as const;
export type MapObjective = typeof OBJECTIVE_ORDER[number] | "empty";
export function mapObjective(available: Partial<Record<Exclude<MapObjective, "empty">, boolean>>): MapObjective {
  return OBJECTIVE_ORDER.find((kind) => available[kind]) ?? "empty";
}
