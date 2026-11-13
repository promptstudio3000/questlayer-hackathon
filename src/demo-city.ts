// "/?newyork" or "/?city=new-york": open the Test Layer's demo in another
// city (docs/TEST-LAYER.md "City demo from the address"). World sends the
// address on to the Test Layer; an unknown name quietly keeps Plzeň.
import type { Point } from "./types";

export type DemoCity = { id: string; name: string; center: Point };

// Address flags that are not city names.
const FLAGS = new Set(["tester", "world", "lang", "id", "city"]);

/** The city name in an address query, or "" when there is none. */
export function demoCityFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const named = params.get("city");
  if (named?.trim()) return named.trim().slice(0, 64);
  for (const [key, value] of params) {
    if (value || FLAGS.has(key.toLowerCase())) continue;
    if (/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,63}$/u.test(key)) return key;
  }
  return "";
}

/** The same query on another origin (World hands it to the Test Layer). */
export function demoCityUrl(origin: string, name: string): string {
  const url = new URL(origin);
  url.searchParams.set("city", name);
  return url.toString();
}
