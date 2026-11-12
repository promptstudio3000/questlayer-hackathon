import { tr } from "./i18n";

/** Display-only wording. Original template strings are part of published plan hashes. */
export function questDisplayTitle(title: string): string {
  if (title === "Path discovery") return tr("Path stop");
  if (title === "There and back") return tr("Round trip");
  if (title === "Three-stop trail") return tr("3-stop trail");
  return title;
}

/** Short task line for the same published templates. */
export function questDisplayObjective(text: string): string {
  if (text === "Reach the marked path and confirm your visit.") return tr("Reach the marker.");
  if (text === "Visit three marked stops in order.") return tr("Visit 3 stops in order.");
  if (text === "Visit two further stops, then return to your starting marker.") return tr("Visit 2 stops, then come back.");
  if (text === "Reach the chest and open it. An Aura may remain in its edition.") return tr("Reach the chest and open it.");
  if (text === "Reach the marked public spot next to this place and confirm your visit.") return tr("Reach the marker.");
  if (text === "Visit three places of one kind in this area today, in any order.") return tr("Visit 3 places, any order.");
  if (text === "Reach the marked public spot next to this place, then answer one question about it.") return tr("Reach the marker and answer 1 question.");
  return text;
}
