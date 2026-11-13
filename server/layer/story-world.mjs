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
