import { tr } from "./i18n";

/** Display-only wording. Original template strings are part of published plan hashes. */
export function questDisplayTitle(title: string): string {
  if (title === "Path discovery") return tr("A stop along the path");
  if (title === "Path chest") return tr("A chest along the path");
  return title;
}
