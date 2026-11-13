// Chunk voxels and meshes for the Layer (docs/LAYER.md). Culled faces with
// per-vertex ambient occlusion and colour; three buckets: lit opaque, glowing
// (lamps, crystals, aether) and translucent (glass, aether surface).
import {
  BLOCK,
  CHUNK,
  HEIGHT,
  column,
  columnBlock,
  forEachFeature,
  hash,
} from "./world";
import { DIAMOND_ORE, expeditionBlock, inExpeditionRegion } from "../../server/layer/expedition-world.mjs";

export const PAD = CHUNK + 2;
export const vIndex = (lx: number, y: number, lz: number) =>
  lx + 1 + (lz + 1) * PAD + y * PAD * PAD;

/** Natural voxels (terrain and features) of a chunk plus a one-block border. */
export function chunkVoxels(seed: number, cx: number, cz: number, expedition = false) {
  const vox = new Uint8Array(PAD * PAD * HEIGHT);
  const x0 = cx * CHUNK,
    z0 = cz * CHUNK;
  for (let lx = -1; lx <= CHUNK; lx++)
    for (let lz = -1; lz <= CHUNK; lz++) {
      const col = column(seed, x0 + lx, z0 + lz);
      const special = expedition && inExpeditionRegion(x0 + lx, z0 + lz);
      const top = special ? 28 : Math.max(col.height, 11);
      for (let y = 0; y <= top && y < HEIGHT; y++)
        vox[vIndex(lx, y, lz)] = (special ? expeditionBlock(seed, x0 + lx, y, z0 + lz) : undefined) ?? columnBlock(col, y);
    }
  forEachFeature(seed, x0 - 1, z0 - 1, x0 + CHUNK + 1, z0 + CHUNK + 1, (x, y, z, b) => {
    if (y >= 0 && y < HEIGHT && !(expedition && inExpeditionRegion(x, z))) vox[vIndex(x - x0, y, z - z0)] = b;
  });
  return vox;
}

const hex = (h: number): [number, number, number] => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];
/** Space palette: alien turf, violet soil, basalt, stardust, aether. */
export const BLOCK_COLORS: Record<number, [number, number, number]> = {
  [BLOCK.grass]: hex(0x4fc9a4),
  [BLOCK.dirt]: hex(0x6a5a7a),
  [BLOCK.stone]: hex(0x5b6178),
  [BLOCK.sand]: hex(0xd9c7a0),
  [BLOCK.water]: hex(0x3ee6ff),
  [BLOCK.wood]: hex(0x8a5fbf),
  [BLOCK.leaves]: hex(0xe26bd0),
  [BLOCK.snow]: hex(0xe8f1ff),
  [BLOCK.mud]: hex(0x3a4a6a),
  [BLOCK.crystal]: hex(0x9b7bff),
  [BLOCK.plank]: hex(0xc79a5b),
  [BLOCK.brick]: hex(0x8f8aa6),
  [BLOCK.glass]: hex(0xbfefff),
  [BLOCK.lantern]: hex(0xffd36e),
  [BLOCK.moss]: hex(0x4a5b6b),
  [BLOCK.path]: hex(0xa9a3c2),
  [BLOCK.forest]: hex(0x3aa88a),
  [BLOCK.bloom]: hex(0xb490ff),
  [BLOCK.cactus]: hex(0x5ccf7a),
  [DIAMOND_ORE]: hex(0x66f4ef),
};
export const cssColor = (b: number) =>
  "#" + (BLOCK_COLORS[b] ?? [1, 1, 1]).map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");

const GLOW = new Set([BLOCK.lantern, BLOCK.crystal, DIAMOND_ORE]);
const CLEAR = new Set([BLOCK.water, BLOCK.glass]);
const opaque = (b: number) => b !== BLOCK.air && !CLEAR.has(b);

// Face normal, origin and the two in-plane axes (u × v = normal).
const FACES: [number[], number[], number[], number[], number][] = [
  [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.8],
  [[-1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 0], 0.8],
  [[0, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], 1],
  [[0, -1, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1], 0.55],
  [[0, 0, 1], [0, 0, 1], [1, 0, 0], [0, 1, 0], 0.9],
  [[0, 0, -1], [0, 0, 0], [0, 1, 0], [1, 0, 0], 0.9],
];
const AO = [0.5, 0.68, 0.84, 1];

export type Bucket = { positions: number[]; normals: number[]; colors: number[]; indices: number[] };
const bucket = (): Bucket => ({ positions: [], normals: [], colors: [], indices: [] });

export function meshChunk(vox: Uint8Array, cx: number, cz: number) {
  const out = { opaque: bucket(), glow: bucket(), clear: bucket() };
  const at = (lx: number, y: number, lz: number) =>
    y < 0 || y >= HEIGHT ? BLOCK.air : vox[vIndex(lx, y, lz)];
  const x0 = cx * CHUNK,
    z0 = cz * CHUNK;
  for (let y = 0; y < HEIGHT; y++)
    for (let lz = 0; lz < CHUNK; lz++)
      for (let lx = 0; lx < CHUNK; lx++) {
        const b = vox[vIndex(lx, y, lz)];
        if (b === BLOCK.air) continue;
        const clear = CLEAR.has(b);
        const target = clear ? out.clear : GLOW.has(b) ? out.glow : out.opaque;
        const base = BLOCK_COLORS[b] ?? [1, 0, 1];
        const jitter = 0.94 + (hash(7, x0 + lx + y * 131, z0 + lz) % 1000) / 8000;
        for (const [n, o, u, v, shade] of FACES) {
          const nb = at(lx + n[0], y + n[1], lz + n[2]);
          if (opaque(nb) || (clear && nb === b)) continue;
          if (b === BLOCK.water && n[1] !== 1 && nb !== BLOCK.air) continue;
          const start = target.positions.length / 3;
          const ao: number[] = [];
          for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const px = lx + o[0] + a * u[0] + c * v[0],
              pz = lz + o[2] + a * u[2] + c * v[2];
            let py = y + o[1] + a * u[1] + c * v[1];
            if (b === BLOCK.water && py > y) py -= 0.15;
            target.positions.push(px, py, pz);
            target.normals.push(n[0], n[1], n[2]);
            // Ambient occlusion from the three voxels touching this corner.
            const su = a ? 1 : -1,
              sv = c ? 1 : -1;
            const fx = lx + n[0],
              fy = y + n[1],
              fz = lz + n[2];
            const s1 = opaque(at(fx + su * u[0], fy + su * u[1], fz + su * u[2])) ? 1 : 0;
            const s2 = opaque(at(fx + sv * v[0], fy + sv * v[1], fz + sv * v[2])) ? 1 : 0;
            const cr = opaque(
              at(fx + su * u[0] + sv * v[0], fy + su * u[1] + sv * v[1], fz + su * u[2] + sv * v[2]),
            )
              ? 1
              : 0;
            const level = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            ao.push(level);
            const k = (GLOW.has(b) ? 1 : shade * AO[level]) * jitter;
            target.colors.push(base[0] * k, base[1] * k, base[2] * k);
          }
          if (ao[0] + ao[2] < ao[1] + ao[3])
            target.indices.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
          else target.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      }
  return out;
}
