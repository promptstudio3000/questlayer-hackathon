// "/?newyork" (docs/TEST-LAYER.md "City demo from the address"): the Test Layer
// opens its demo in another city. A name is matched against the reviewed live
// cities and the auto cities (Czech towns, the demo cities abroad and the
// capitals), ignoring case, spaces, dashes and diacritics. Only the Test Layer
// plays a demo outside its default city: an arena world skips the travel
// checks, so World keeps its one Plzeň arena (server/index.mjs).

/** "New York" / "new-york" / "NEWYORK" -> "newyork"; "Plzeň" -> "plzen". */
export function demoCityKey(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 64);
}

/**
 * Finds a city for a typed name. live: reviewed cities ({ id, name, center }),
 * auto: auto city index entries ({ id, name, center, population }). Reviewed
 * cities win; between auto cities the bigger one wins (Paris, not a namesake).
 */
export function findDemoCity(query, { live = [], auto = [] } = {}) {
  const key = demoCityKey(query);
  if (key.length < 2) return null;
  const hit = (c) => demoCityKey(c.id) === key || demoCityKey(c.name) === key;
  const reviewed = live.find((c) => c?.center && hit(c));
  if (reviewed) return view(reviewed);
  let best = null;
  for (const c of auto) {
    if (!c?.center || !hit(c)) continue;
    if (!best || (c.population || 0) > (best.population || 0)) best = c;
  }
  return best ? view(best) : null;
}

function view(c) {
  return { id: c.id, name: c.name, center: { lat: c.center.lat, lng: c.center.lng } };
}
