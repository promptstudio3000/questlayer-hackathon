// Layer world generator (docs/LAYER.md). Pure and deterministic: the browser
// renders and the server validates from the same function of
// (layer seed, x, y, z). Only player changes inside plots are stored.
// No Node imports: the client bundles this file directly.

export const CHUNK = 32;
export const HEIGHT = 48;
export const SEA_LEVEL = 11;
/** Distance between district centres, in blocks. District 0 sits at the origin. */
export const DISTRICT = 384;
export const PLOT = 16;
/** Plot pitch: a 16-block plot plus a 4-block road. */
export const PLOT_PITCH = 20;
/** Plot grid index range inside a district (-3..2 on both axes). */
export const PLOT_GRID = 3;
/** Ground level of every settlement (plaza, roads, plots). */
export const SETTLE_Y = 14;
const SETTLE_HALF = PLOT_GRID * PLOT_PITCH + 2;
const SETTLE_BLEND = 26;
/** Builders may dig this many blocks under a plot's ground. */
export const PLOT_DEPTH = 3;
/** Beacons (signal relays): at most one per region of this size. */
export const BEACON_REGION = 64;
export const BEACON_REACH = 3.5;

export const BLOCK = Object.freeze({
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  sand: 4,
  water: 5,
  wood: 6,
  leaves: 7,
  snow: 8,
  mud: 9,
  crystal: 10,
  plank: 11,
  brick: 12,
  glass: 13,
  lantern: 14,
  moss: 15,
  path: 16,
  forest: 17,
  bloom: 18,
  cactus: 19,
});
/** Blocks a player may place on their plot. Order is the palette order. */
export const BUILD_BLOCKS = Object.freeze([
  BLOCK.plank,
  BLOCK.brick,
  BLOCK.stone,
  BLOCK.glass,
  BLOCK.lantern,
  BLOCK.grass,
  BLOCK.sand,
  BLOCK.wood,
  BLOCK.leaves,
  BLOCK.crystal,
]);
export const BLOCK_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(BLOCK).map(([name, id]) => [id, name])),
);
export const isSolid = (b) => b !== BLOCK.air && b !== BLOCK.water;

export const BIOMES = Object.freeze([
  "meadow",
  "forest",
  "desert",
  "wetland",
  "crag",
  "crystal",
  "settlement",
]);

// ---------------------------------------------------------------- noise

export function hash(seed, x, z) {
  let h =
    (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const rand = (seed, x, z) => hash(seed, x, z) / 4294967296;
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function valueNoise(seed, x, z) {
  const xi = Math.floor(x),
    zi = Math.floor(z),
    u = smooth(x - xi),
    v = smooth(z - zi);
  return (
    lerp(
      lerp(rand(seed, xi, zi), rand(seed, xi + 1, zi), u),
      lerp(rand(seed, xi, zi + 1), rand(seed, xi + 1, zi + 1), u),
      v,
    ) *
      2 -
    1
  );
}
function fbm(seed, x, z, octaves) {
  let sum = 0,
    amp = 1,
    freq = 1,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 1013, x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------- settlements

export const districtOf = (x, z) => [
  Math.round(x / DISTRICT),
  Math.round(z / DISTRICT),
];
/** Chebyshev distance from the nearest district centre, in blocks. */
function settlementDistance(x, z) {
  const [dx, dz] = districtOf(x, z);
  return Math.max(Math.abs(x - dx * DISTRICT), Math.abs(z - dz * DISTRICT));
}

/** Plot slots of one district, nearest the plaza first. */
export function districtSlots(dx, dz) {
  const slots = [];
  for (let i = -PLOT_GRID; i < PLOT_GRID; i++)
    for (let j = -PLOT_GRID; j < PLOT_GRID; j++) {
      if ((i === -1 || i === 0) && (j === -1 || j === 0)) continue; // plaza
      slots.push({
        x0: dx * DISTRICT + i * PLOT_PITCH + 2,
        z0: dz * DISTRICT + j * PLOT_PITCH + 2,
        ring: Math.max(Math.abs(i + 0.5), Math.abs(j + 0.5)),
        angle: Math.atan2(j + 0.5, i + 0.5),
      });
    }
  return slots
    .sort((a, b) => a.ring - b.ring || a.angle - b.angle)
    .map(({ x0, z0 }) => ({ x0, z0, size: PLOT }));
}
export const SLOTS_PER_DISTRICT = (PLOT_GRID * 2) ** 2 - 4;
/** Districts in a square spiral from the origin: 0 → (0,0), 1 → (1,0), … */
export function districtAt(n) {
  if (n === 0) return [0, 0];
  let ring = 1;
  while ((2 * ring + 1) ** 2 <= n) ring++;
  let k = n - (2 * ring - 1) ** 2;
  const side = 2 * ring;
  if (k < side) return [ring, -ring + 1 + k];
  k -= side;
  if (k < side) return [ring - 1 - k, ring];
  k -= side;
  if (k < side) return [-ring, ring - 1 - k];
  k -= side;
  return [-ring + 1 + k, -ring];
}
/** Global slot number → plot rectangle. Home plots fill outward from the origin. */
export function slotPlot(slot) {
  const district = Math.floor(slot / SLOTS_PER_DISTRICT);
  const [dx, dz] = districtAt(district);
  return districtSlots(dx, dz)[slot % SLOTS_PER_DISTRICT];
}
export const inPlot = (plot, x, z) =>
  x >= plot.x0 && x < plot.x0 + plot.size && z >= plot.z0 && z < plot.z0 + plot.size;

// --------------------------------------------------------------- columns

function naturalColumn(seed, x, z) {
  const continent = fbm(seed, x / 220, z / 220, 4),
    detail = fbm(seed + 7, x / 60, z / 60, 3),
    ridge = 1 - Math.abs(fbm(seed + 13, x / 140, z / 140, 3)),
    temperature = fbm(seed + 21, x / 400, z / 400, 2),
    moisture = fbm(seed + 29, x / 350, z / 350, 2);
  let height =
    13 +
    continent * 11 +
    detail * 4 +
    Math.max(0, ridge - 0.72) * (continent > 0 ? 46 : 16);
  height = Math.max(2, Math.min(HEIGHT - 8, Math.round(height)));
  let biome;
  if (height >= 29) biome = "crag";
  else if (temperature > 0.22 && moisture < -0.02) biome = "desert";
  else if (moisture > 0.28) biome = "wetland";
  else if (temperature < -0.3 && moisture < 0.05) biome = "crystal";
  else if (moisture > 0.04) biome = "forest";
  else biome = "meadow";
  return { height, biome };
}

/**
 * Surface column at (x, z): ground height, biome and top block. Settlements
 * are flat at SETTLE_Y with roads, a plaza and plots, blended into the land.
 */
export function column(seed, x, z) {
  const d = settlementDistance(x, z);
  if (d <= SETTLE_HALF) {
    const [dx, dz] = districtOf(x, z),
      lx = x - dx * DISTRICT,
      lz = z - dz * DISTRICT;
    const plaza = Math.max(Math.abs(lx + 0.5), Math.abs(lz + 0.5)) < 20;
    const inCell = (v) => {
      const m = (((v + PLOT_GRID * PLOT_PITCH) % PLOT_PITCH) + PLOT_PITCH) % PLOT_PITCH;
      return m >= 2 && m < 18;
    };
    const lot = !plaza && inCell(lx) && inCell(lz) && d < PLOT_GRID * PLOT_PITCH;
    return {
      height: SETTLE_Y,
      biome: "settlement",
      top: lot ? BLOCK.grass : BLOCK.path,
    };
  }
  const natural = naturalColumn(seed, x, z);
  let { height } = natural;
  if (d < SETTLE_HALF + SETTLE_BLEND)
    height = Math.round(
      lerp(SETTLE_Y, height, smooth((d - SETTLE_HALF) / SETTLE_BLEND)),
    );
  const biome = natural.biome;
  let top;
  if (height <= SEA_LEVEL + 1 && biome !== "wetland") top = BLOCK.sand;
  else if (height >= 33) top = BLOCK.snow;
  else
    top =
      biome === "desert"
        ? BLOCK.sand
        : biome === "wetland"
          ? BLOCK.mud
          : biome === "crag"
            ? BLOCK.moss
            : biome === "forest"
              ? BLOCK.forest
              : biome === "crystal"
                ? BLOCK.bloom
                : BLOCK.grass;
  return { height, biome, top };
}

/** Natural block (no features) for a known column. */
export function columnBlock(col, y) {
  if (y <= 0) return BLOCK.stone;
  if (y < col.height - 3) return BLOCK.stone;
  if (y < col.height)
    return col.top === BLOCK.sand ? BLOCK.sand : col.biome === "crag" ? BLOCK.stone : BLOCK.dirt;
  if (y === col.height) return col.top;
  if (y <= SEA_LEVEL) return BLOCK.water;
  return BLOCK.air;
}

// -------------------------------------------------------------- features

/** Beacons are wilderness landmarks; each region holds at most one. */
export function regionBeacon(seed, rx, rz) {
  const h = hash(seed + 404, rx, rz);
  if (h % 100 >= 55) return null;
  const x = rx * BEACON_REGION + 8 + ((h >>> 8) % (BEACON_REGION - 16)),
    z = rz * BEACON_REGION + 8 + ((h >>> 16) % (BEACON_REGION - 16));
  if (settlementDistance(x, z) < SETTLE_HALF + SETTLE_BLEND + 6) return null;
  const col = column(seed, x, z);
  if (col.height <= SEA_LEVEL || col.height >= HEIGHT - 10) return null;
  return { id: `s${rx}_${rz}`, x, z, y: col.height + 1, biome: col.biome };
}
export function beaconsNear(seed, x, z, radius) {
  const out = [];
  const r0x = Math.floor((x - radius) / BEACON_REGION),
    r1x = Math.floor((x + radius) / BEACON_REGION),
    r0z = Math.floor((z - radius) / BEACON_REGION),
    r1z = Math.floor((z + radius) / BEACON_REGION);
  for (let rx = r0x; rx <= r1x; rx++)
    for (let rz = r0z; rz <= r1z; rz++) {
      const s = regionBeacon(seed, rx, rz);
      if (s && Math.hypot(s.x + 0.5 - x, s.z + 0.5 - z) <= radius) out.push(s);
    }
  return out.sort(
    (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z),
  );
}
export function beaconById(seed, id) {
  const m = /^s(-?\d{1,7})_(-?\d{1,7})$/.exec(String(id));
  if (!m) return null;
  const s = regionBeacon(seed, Number(m[1]), Number(m[2]));
  return s && s.id === id ? s : null;
}

function treeAt(seed, x, z, col) {
  if (col.biome === "settlement" || col.height <= SEA_LEVEL) return null;
  const density =
    col.biome === "forest"
      ? 0.035
      : col.biome === "meadow"
        ? 0.006
        : col.biome === "desert"
          ? 0.004
          : col.biome === "crystal"
            ? 0.01
            : col.biome === "wetland"
              ? 0.012
              : 0;
  if (rand(seed + 99, x, z) >= density) return null;
  if (settlementDistance(x, z) < SETTLE_HALF + 4) return null;
  return 3 + (hash(seed + 98, x, z) % 3);
}

/**
 * Feature blocks (trees, cacti, crystal spires, beacons, the plaza spire)
 * whose voxels fall inside [x0, x1) × [z0, z1). Calls put(x, y, z, block).
 */
export function forEachFeature(seed, x0, z0, x1, z1, put) {
  const pad = 3;
  for (let x = x0 - pad; x < x1 + pad; x++)
    for (let z = z0 - pad; z < z1 + pad; z++) {
      const col = column(seed, x, z);
      const tall = treeAt(seed, x, z, col);
      if (!tall) continue;
      const base = col.height + 1;
      const inside = (px, pz) => px >= x0 && px < x1 && pz >= z0 && pz < z1;
      if (col.biome === "desert") {
        if (inside(x, z))
          for (let y = 0; y < tall; y++) put(x, base + y, z, BLOCK.cactus);
        continue;
      }
      if (col.biome === "crystal") {
        if (inside(x, z))
          for (let y = 0; y < tall + 1; y++) put(x, base + y, z, BLOCK.crystal);
        continue;
      }
      for (let ox = -2; ox <= 2; ox++)
        for (let oz = -2; oz <= 2; oz++)
          for (let oy = tall - 2; oy <= tall + 1; oy++) {
            const r = Math.abs(ox) + Math.abs(oz) + Math.max(0, oy - tall) * 2;
            if (r > (oy >= tall ? 2 : 3)) continue;
            if ((Math.abs(ox) === 2 || Math.abs(oz) === 2) && hash(seed, x + ox * 7 + oy, z + oz * 7) % 3 === 0)
              continue;
            if (inside(x + ox, z + oz)) put(x + ox, base + oy, z + oz, BLOCK.leaves);
          }
      if (inside(x, z))
        for (let y = 0; y < tall; y++) put(x, base + y, z, BLOCK.wood);
    }
  // Beacons: a 5×5 platform, four pillars and a crystal core with a lamp.
  for (const s of beaconsNear(seed, (x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) + BEACON_REGION)) {
    for (let ox = -2; ox <= 2; ox++)
      for (let oz = -2; oz <= 2; oz++) {
        const px = s.x + ox,
          pz = s.z + oz;
        if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
        const ground = column(seed, px, pz).height;
        for (let y = Math.min(ground + 1, s.y); y < s.y; y++) put(px, y, pz, BLOCK.stone);
        put(px, s.y, pz, Math.abs(ox) + Math.abs(oz) <= 1 ? BLOCK.brick : BLOCK.moss);
        for (let y = s.y + 1; y < s.y + 7; y++) put(px, y, pz, BLOCK.air);
        if (Math.abs(ox) === 2 && Math.abs(oz) === 2)
          for (let y = s.y + 1; y <= s.y + 3; y++) put(px, y, pz, BLOCK.brick);
        if (ox === 0 && oz === 0) {
          put(px, s.y + 1, pz, BLOCK.crystal);
          put(px, s.y + 2, pz, BLOCK.lantern);
        }
      }
  }
  // District plaza beacon.
  const [dx, dz] = districtOf((x0 + x1) / 2, (z0 + z1) / 2);
  const cx = dx * DISTRICT,
    cz = dz * DISTRICT;
  for (let ox = -2; ox <= 1; ox++)
    for (let oz = -2; oz <= 1; oz++) {
      const px = cx + ox,
        pz = cz + oz;
      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
      const edge = ox === -2 || ox === 1 || oz === -2 || oz === 1;
      put(px, SETTLE_Y + 1, pz, edge ? BLOCK.brick : BLOCK.stone);
      if (!edge) {
        for (let y = SETTLE_Y + 2; y < SETTLE_Y + 7; y++) put(px, y, pz, BLOCK.crystal);
        put(px, SETTLE_Y + 7, pz, BLOCK.lantern);
      } else if ((ox === -2 || ox === 1) && (oz === -2 || oz === 1)) {
        put(px, SETTLE_Y + 2, pz, BLOCK.lantern);
      }
    }
}

/** Human-readable biome under a point (HUD). */
export const biomeAt = (seed, x, z) => column(seed, Math.floor(x), Math.floor(z)).biome;

/** Blocky explorer outfits: colours only, no wearable ownership implied. */
export const OUTFITS = Object.freeze([
  Object.freeze({ id: "nebula", suit: "#6b4fd8", trim: "#f2c94c", visor: "#7ff3ff" }),
  Object.freeze({ id: "solar", suit: "#f08a24", trim: "#fff1c1", visor: "#2a1a5e" }),
  Object.freeze({ id: "comet", suit: "#e8edf7", trim: "#4fb6ff", visor: "#1d2340" }),
  Object.freeze({ id: "moss", suit: "#3f8f5a", trim: "#c9f27a", visor: "#ffd36e" }),
  Object.freeze({ id: "void", suit: "#1f1b2e", trim: "#ff5fd2", visor: "#9b8cff" }),
  Object.freeze({ id: "ember", suit: "#b8323a", trim: "#ffb36b", visor: "#fff4d6" }),
]);
export const outfitById = (id) => OUTFITS.find((o) => o.id === id) ?? OUTFITS[0];
