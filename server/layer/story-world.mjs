// Authored, reproducible MetaLayer story. These are play requirements, not
// currency prices or XP/reward amounts. No daily reset or paid gate applies.
export const STORY_SEED = "quiet-beacon-1";
export const BASALT_GOAL = 6;
export const SIGNAL_SITES = Object.freeze([
  Object.freeze({ id: "garden", x: -28, z: 22, symbol: "spore" }),
  Object.freeze({ id: "arch", x: 28, z: 28, symbol: "tide" }),
  Object.freeze({ id: "observatory", x: 30, z: -27, symbol: "star" }),
]);
export const MARKER = Object.freeze({
  x: 18, z: 18,
  blocks: Object.freeze([
    Object.freeze({ x: 18, y: 15, z: 18, material: "wood" }),
    Object.freeze({ x: 18, y: 16, z: 18, material: "wood" }),
    Object.freeze({ x: 18, y: 17, z: 18, material: "lantern" }),
  ]),
});
export const storySiteAt = (x, z) => SIGNAL_SITES.find(site =>
  Math.abs(x - site.x) <= 3 && Math.abs(z - site.z) <= 3);

// Authored places are shared landmarks, not accounts, reward sources or parcels.
// Their boards can be read from anywhere; a discovery requires validated presence.
export const PLACE_REACH = 6;
export const WORLD_PLACES = Object.freeze([
  { id: "nera", kind: "guide", x: 12.5, z: -6.5 },
  { id: "treasury", kind: "treasury", x: -5.5, z: -5.5 },
  { id: "workshop", kind: "workshop", x: -22.5, z: 32.5 },
  { id: "hollow", kind: "quest", x: -2.5, z: -46.5 },
  { id: "quarry", kind: "quest", x: 55.5, z: -17.5 },
  ...SIGNAL_SITES.map(site => ({ id: site.id, kind: "quest", x: site.x - .5, z: site.z - 1.5 })),
  { id: "marker", kind: "quest", x: MARKER.x - 2.5, z: MARKER.z - 1.5 },
  { id: "beacon", kind: "quest", x: 4.5, z: -4.5 },
].map(Object.freeze));
export const placeById = id => WORLD_PLACES.find(place => place.id === id);
export function nearbyPlace(x, y, z) {
  if (Math.abs(y - 15) > 3) return null;
  return WORLD_PLACES.filter(place => Math.hypot(x - place.x, z - place.z) <= PLACE_REACH)
    .sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z))[0] ?? null;
}
export const protectedPlace = (x, z) => WORLD_PLACES.some(place =>
  Math.abs(x + .5 - place.x) <= (place.id === "workshop" ? 4 : 1.5) &&
  Math.abs(z + .5 - place.z) <= (place.id === "workshop" ? 4 : 1.5));
