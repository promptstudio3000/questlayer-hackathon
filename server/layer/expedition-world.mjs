// Shared rules for the MetaLayer first-expedition preview. These are spatial
// and resource rules only. No currency, XP, NFT or settlement is issued here.
import { BLOCK, BUILD_BLOCKS, column, columnBlock } from "./world.mjs";
import { storySiteAt } from "./story-world.mjs";

export const DIAMOND_ORE = 20;
export const PLAZA = Object.freeze({ x0: -48, z0: -48, size: 96, y: 14 });
export const PLAZA_SPAWN = Object.freeze({ x: 12.5, y: 15, z: 0.5 });
export const DIAMOND_GOAL = 10;
export const ORE_RENEW_MS = 15 * 60_000;
export const MINING_REACH = 5.5;
export const ATLAS_CELL = 16;
export const MINES = Object.freeze([
  Object.freeze({
    id: "crystal-hollow",
    kind: "cave",
    x: 0,
    z: -65,
    entranceX: 0,
    entranceZ: -47,
    radius: 18,
  }),
  Object.freeze({
    id: "basalt-quarry",
    kind: "quarry",
    x: 68,
    z: -16,
    entranceX: 53,
    entranceZ: -16,
    radius: 15,
  }),
]);

export function mineAt(x, z) {
  return (
    MINES.find(
      (mine) =>
        Math.abs(x - mine.x) <= mine.radius &&
        Math.abs(z - mine.z) <= mine.radius,
    ) ?? null
  );
}
export const inPlaza = (x, z) =>
  x >= PLAZA.x0 &&
  x < PLAZA.x0 + PLAZA.size &&
  z >= PLAZA.z0 &&
  z < PLAZA.z0 + PLAZA.size;
export const protectedPlaza = (x, z) =>
  Math.abs(x) <= 3 ||
  Math.abs(z) <= 3 ||
  (Math.abs(x) <= 8 && Math.abs(z) <= 8) || !!storySiteAt(x, z);
export const inExpeditionRegion = (x, z) => inPlaza(x, z) || !!mineAt(x, z);

// The cave and quarry have one stable floor. Only natural stone and ore above
// that floor are mineable; the entrance and the walking surface survive digging.
export function expeditionBlock(seed, x, y, z) {
  const mine = mineAt(x, z);
  if (mine) {
    if (y <= PLAZA.y) return y === PLAZA.y ? BLOCK.stone : BLOCK.dirt;
    const dx = Math.abs(x - mine.x),
      dz = Math.abs(z - mine.z);
    if (mine.kind === "cave") {
      const roof = 24 - Math.floor((dx + dz) / 9);
      if (y > roof) return BLOCK.air;
      const corridor = dx <= 4 && y <= 19;
      const chamber = dx <= 8 && dz <= 6 && y <= 20;
      if (corridor || chamber) return BLOCK.air;
      if (
        dx === 5 &&
        z >= -61 &&
        z <= -49 &&
        z % 2 === 0 &&
        (y === 15 || y === 17)
      )
        return DIAMOND_ORE;
      if (dx === 9 && dz <= 7 && z % 2 === 0 && y === 16) return DIAMOND_ORE;
      return BLOCK.stone;
    }
    const rim = Math.max(dx, dz);
    const top = rim > 11 ? 21 : rim > 8 ? 19 : rim > 5 ? 17 : 14;
    // A western opening gives the quarry a level, walkable entrance.
    if (Math.abs(z - mine.z) <= 2 && x < mine.x && y <= 18) return BLOCK.air;
    if (y > top) return BLOCK.air;
    if ((rim === 6 || rim === 9) && (x + z) % 3 === 0 && y === top)
      return DIAMOND_ORE;
    return BLOCK.stone;
  }
  if (!inPlaza(x, z)) return undefined;
  if (y <= PLAZA.y)
    return y === PLAZA.y
      ? protectedPlaza(x, z)
        ? BLOCK.path
        : BLOCK.grass
      : BLOCK.dirt;
  const site = storySiteAt(x, z);
  if (site) {
    const dx = x - site.x, dz = z - site.z;
    if (dx === 0 && dz === 0 && y <= 17)
      return y === 17 ? BLOCK.crystal : BLOCK.brick;
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && y <= 18)
      return y === 18 ? BLOCK.lantern : BLOCK.stone;
    if (site.id === "arch" && Math.abs(dx) <= 2 && dz === 2 && y === 19) return BLOCK.plank;
    if (site.id === "garden" && Math.abs(dx) === 3 && dz === -2 && y === 15) return BLOCK.leaves;
  }
  // A protected altar and four corner lamps make the square readable at ground level.
  if (Math.abs(x) <= 2 && Math.abs(z) <= 2 && y === 15) return BLOCK.brick;
  if (x === 0 && z === 0 && y >= 16 && y <= 22)
    return y === 22 ? BLOCK.lantern : BLOCK.crystal;
  if (Math.abs(x) === 7 && Math.abs(z) === 7 && y >= 15 && y <= 18)
    return y === 18 ? BLOCK.lantern : BLOCK.wood;
  return BLOCK.air;
}

export function naturalExpeditionBlock(seed, x, y, z) {
  return expeditionBlock(seed, x, y, z) ?? columnBlock(column(seed, x, z), y);
}
export const miningDuration = (block) => (block === DIAMOND_ORE ? 1200 : 600);
export const mineable = (seed, x, y, z, block) =>
  y > PLAZA.y &&
  !!mineAt(x, z) &&
  (block === BLOCK.stone || block === DIAMOND_ORE) &&
  naturalExpeditionBlock(seed, x, y, z) === block;

export function clearMiningRay(from, target, readBlock) {
  const origin = { x: from.x, y: from.y + 1.4, z: from.z };
  const dx = target.x + 0.5 - origin.x,
    dy = target.y + 0.5 - origin.y,
    dz = target.z + 0.5 - origin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance > MINING_REACH) return false;
  const steps = Math.ceil(distance * 5);
  for (let i = 1; i < steps; i++) {
    const x = Math.floor(origin.x + (dx * i) / steps),
      y = Math.floor(origin.y + (dy * i) / steps),
      z = Math.floor(origin.z + (dz * i) / steps);
    if (x === target.x && y === target.y && z === target.z) continue;
    if (readBlock(x, y, z) !== BLOCK.air) return false;
  }
  return true;
}

export function breakable(seed, x, y, z, block) {
  return (
    mineable(seed, x, y, z, block) ||
    (inPlaza(x, z) &&
      !protectedPlaza(x, z) &&
      y > PLAZA.y &&
      y < 40 &&
      BUILD_BLOCKS.includes(block))
  );
}
