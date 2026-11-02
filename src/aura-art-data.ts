// Authored QuestLayer Aura sprites. Dependency-free so the map marker markup and
// Node tests can import it; the React wrapper lives in aura-art.tsx.
//
// Grids: `above` 48x24 (floats over the head), `below` 56x20 (ground glow).
// Light falls from the upper left on every edition; a 1px outline in the brand
// ink `#1A0335` at 40% opacity keeps the shapes legible on the light paper
// sheets and on the map alike. Each sprite has a static base layer plus two
// alternating sparkle frames (`a`, `b`) for a two-frame idle twinkle.

export const AURA_SLOTS = ["above", "below"] as const;
export type AuraSlot = (typeof AURA_SLOTS)[number];
import { AURA_CATALOG, catalogEditionFor } from "./aura-catalog.ts";

export const AURA_EDITIONS = [
  "ember",
  "dew",
  "polar",
  "bloom",
  "storm",
  "moon",
  "comet",
  "gold",
  "nova",
  "pilgrim",
  "chronicle",
  "ledger",
  "wardbreaker",
  "wisp",
  "bossbane",
  "stride",
  "kindle",
  "compass",
  "quill",
  "laurel",
  "summit",
] as const;
export type AuraEdition = (typeof AURA_EDITIONS)[number];
export const AURA_GRIDS = Object.freeze({
  above: Object.freeze({ width: 48, height: 24 }),
  below: Object.freeze({ width: 56, height: 20 }),
});
export const AURA_OUTLINE = Object.freeze({ color: "#1A0335", opacity: 0.4 });
export const AURA_EDITION_NAMES = Object.freeze(
  Object.fromEntries(AURA_CATALOG.map((e) => [e.id, e.name])),
) as Readonly<Record<AuraEdition, string>>;
// Verified edition colors from server/native/collectibles.mjs and the demo
// AURAS table in server/game.mjs. Presence markers only carry a color, so a
// known color still gets its authored design.
const EDITION_COLORS: Readonly<Record<string, AuraEdition>> = Object.freeze({
  "#9edfc5": "polar",
  "#8dd8bd": "polar",
  "#59ddcc": "polar",
  "#c2a0df": "moon",
  "#b49beb": "moon",
  "#b8a0ee": "moon",
  "#e7c35f": "gold",
  "#f2c869": "gold",
  "#ffd667": "gold",
  ...Object.fromEntries(
    AURA_CATALOG.flatMap((e) =>
      [e.color, e.demoColor].filter(Boolean).map((c) => [c, e.id]),
    ),
  ),
});

export type AuraPixelRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity?: number;
  /** `a`/`b` sparkle frames alternate during the idle animation. */
  frame?: "a" | "b";
}>;
export type AuraOptions = {
  edition?: string | null;
  slot?: string | null;
  color?: string | null;
};

const HEX = /^#[a-fA-F0-9]{6}$/;
export function isAuraEdition(value: unknown): value is AuraEdition {
  return (
    typeof value === "string" && (AURA_EDITIONS as readonly string[]).includes(value)
  );
}
export function auraSlot(value: unknown): AuraSlot {
  return value === "below" ? "below" : "above";
}
/** Resolve the authored edition for an item; null means the generic design. */
export function auraEdition(item: {
  edition?: string | null;
  name?: string | null;
  color?: string | null;
}): AuraEdition | null {
  if (isAuraEdition(item.edition)) return item.edition;
  const listed = catalogEditionFor(item);
  if (listed && isAuraEdition(listed.id)) return listed.id;
  const name = item.name || "";
  if (/northern|polar/i.test(name)) return "polar";
  if (/moon/i.test(name)) return "moon";
  if (/sun|gold/i.test(name)) return "gold";
  const color = (item.color || "").toLowerCase();
  return EDITION_COLORS[color] || null;
}

type Palette = Readonly<Record<string, string>>;
const PALETTES: Readonly<Record<AuraEdition, Palette>> = Object.freeze({
  polar: {
    hi: "#E2FDF0", // mint highlight
    body: "#6FE3CF", // teal
    deep: "#2F9FAD", // deep teal
    fringe: "#9D7BF0", // violet fringe
    spark: "#FFFFFF",
    spark2: "#BFF6E6",
  },
  moon: {
    hi: "#F6EFFF",
    body: "#C9ABEF",
    deep: "#8A62CF",
    fringe: "#6A48B5",
    spark: "#FFFFFF",
    spark2: "#9ECBFF", // soft blue star dust
  },
  gold: {
    hi: "#FFFDF0",
    body: "#FEF87D",
    deep: "#F3BD54",
    fringe: "#CF8A2B",
    spark: "#FFFFFF",
    spark2: "#FEF87D",
  },
  ember: {
    hi: "#FFF1C2", // white-hot core
    body: "#FF9A4D", // flame orange
    deep: "#E5532E", // ember red
    fringe: "#9E2A3A", // smoky crimson
    spark: "#FFFFFF",
    spark2: "#FFD36B",
  },
  dew: {
    hi: "#F2FBFF",
    body: "#8FD3FF", // clear water
    deep: "#4A9BE0",
    fringe: "#3566B8",
    spark: "#FFFFFF",
    spark2: "#CDEEFF",
  },
  bloom: {
    hi: "#FFF0F6",
    body: "#FF9FC8", // petals
    deep: "#5FBF6A", // leaves
    fringe: "#2F8A55", // stems
    spark: "#FFFFFF",
    spark2: "#FFE58A", // pollen
  },
  storm: {
    hi: "#F4F7FF", // cloud tops
    body: "#8FA6FF",
    deep: "#4E5BD6",
    fringe: "#2E2A8C",
    spark: "#FFFFFF",
    spark2: "#FFF27A", // lightning
  },
  comet: {
    hi: "#FFFFFF",
    body: "#E6ECFF", // icy head
    deep: "#9AA8E0",
    fringe: "#E07AB8", // rose tail
    spark: "#FFFFFF",
    spark2: "#FFD1EA",
  },
  nova: {
    hi: "#FFF4FB",
    body: "#FF5FA8", // magenta burst
    deep: "#D23F8E",
    fringe: "#8A2A9E",
    spark: "#FFFFFF",
    spark2: "#FFC2E0",
  },
  pilgrim: {
    hi: "#EEFAD9",
    body: "#9BD17A", // moss
    deep: "#5E9A4B",
    fringe: "#8A6B45", // trodden path
    spark: "#FFFFFF",
    spark2: "#F4E7A1",
  },
  chronicle: {
    hi: "#FFF6E0", // parchment
    body: "#B48CFF", // violet cover
    deep: "#6E4BC2",
    fringe: "#3E2A80",
    spark: "#FFFFFF",
    spark2: "#FFD86B", // gold runes
  },
  ledger: {
    hi: "#FFF3C4",
    body: "#E0A94A", // coin gold
    deep: "#A8692A",
    fringe: "#B8433A", // ledger ribbon
    spark: "#FFFFFF",
    spark2: "#FFE07A",
  },
  wardbreaker: {
    hi: "#F4FFF8",
    body: "#CFE9DA", // bone horn
    deep: "#7FA592",
    fringe: "#2F6B55",
    spark: "#FFFFFF",
    spark2: "#7CF0B0", // ghost-green ward
  },
  wisp: {
    hi: "#F2FFFF",
    body: "#9FF6FF", // ghost fire
    deep: "#3FB8D0",
    fringe: "#2A5E8C", // lantern iron
    spark: "#FFFFFF",
    spark2: "#D6FFF4",
  },
  bossbane: {
    hi: "#FFE1D6", // fang bone
    body: "#FF6B6B",
    deep: "#B3263E",
    fringe: "#4A1035", // rift
    spark: "#FFFFFF",
    spark2: "#FFB15C", // ember glow
  },
  stride: {
    hi: "#FFFFFF",
    body: "#C9D3E0", // silver
    deep: "#8592A8",
    fringe: "#4E5A73",
    spark: "#FFFFFF",
    spark2: "#E6F0FF",
  },
  kindle: {
    hi: "#FFF4C2",
    body: "#FF9F43", // altar flame
    deep: "#D9622B",
    fringe: "#8A5A2B", // brass
    spark: "#FFFFFF",
    spark2: "#FFD27A",
  },
  compass: {
    hi: "#E9FFF5",
    body: "#5FD3A8", // verdigris
    deep: "#2E9C7E",
    fringe: "#1F5E5A",
    spark: "#FFFFFF",
    spark2: "#FFE08A", // needle gold
  },
  quill: {
    hi: "#F2F5FF",
    body: "#8FA8FF", // ink blue
    deep: "#5262C9",
    fringe: "#2E2F7A",
    spark: "#FFFFFF",
    spark2: "#C9D6FF",
  },
  laurel: {
    hi: "#F1FFD9",
    body: "#9BE36B", // leaf
    deep: "#4FA33F",
    fringe: "#2C6B2F",
    spark: "#FFFFFF",
    spark2: "#FFE08A", // gold ribbon
  },
  summit: {
    hi: "#FFFFFF", // snow
    body: "#FFE08A", // gold crown
    deep: "#D9A441",
    fringe: "#7A6FB8", // dusk rock
    spark: "#FFFFFF",
    spark2: "#FFF6CF",
  },
});

function mix(hex: string, target: string, amount: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
    b = [1, 3, 5].map((i) => parseInt(target.slice(i, i + 2), 16));
  return (
    "#" +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}
function genericPalette(color: string): Palette {
  return {
    hi: mix(color, "#FFFFFF", 0.65),
    body: color.toUpperCase(),
    deep: mix(color, "#1A0335", 0.3),
    fringe: mix(color, "#1A0335", 0.5),
    spark: "#FFFFFF",
    spark2: mix(color, "#FFFFFF", 0.4),
  };
}

type Layer = "base" | "a" | "b";
class Canvas {
  readonly width: number;
  readonly height: number;
  readonly cells: Record<Layer, (string | null)[]>;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = {
      base: Array(width * height).fill(null),
      a: Array(width * height).fill(null),
      b: Array(width * height).fill(null),
    };
  }
  put(x: number, y: number, key: string, layer: Layer = "base") {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[layer][y * this.width + x] = key;
  }
  get(x: number, y: number, layer: Layer = "base") {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.cells[layer][y * this.width + x];
  }
  /** Four-point pixel star: a plus shape with a bright centre. */
  star(x: number, y: number, key: string, centre: string, layer: Layer) {
    this.put(x, y, centre, layer);
    this.put(x - 1, y, key, layer);
    this.put(x + 1, y, key, layer);
    this.put(x, y - 1, key, layer);
    this.put(x, y + 1, key, layer);
  }
  /** One pixel dark outline around every opaque base pixel. */
  outline() {
    const base = this.cells.base.slice();
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (base[y * this.width + x]) continue;
        const near = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(
          ([nx, ny]) =>
            nx >= 0 &&
            ny >= 0 &&
            nx < this.width &&
            ny < this.height &&
            base[ny * this.width + nx] &&
            base[ny * this.width + nx] !== "outline",
        );
        if (near) this.cells.base[y * this.width + x] = "outline";
      }
  }
}

/** Where a ring pixel sits relative to the upper-left light. 1 = fully lit. */
function lit(dx: number, dy: number) {
  const length = Math.hypot(dx, dy) || 1;
  return (-dx - dy) / (length * Math.SQRT2);
}
function ellipseRing(
  c: Canvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thickness: number | ((light: number) => number),
  paint: (dx: number, dy: number, light: number, angle: number) => string | null,
) {
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy,
        outer = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry),
        t =
          typeof thickness === "number"
            ? thickness
            : thickness(lit(dx / rx, dy / ry)),
        irx = rx - t,
        iry = Math.max(0.5, ry - t * (ry / rx) * 1.4),
        inner = (dx * dx) / (irx * irx) + (dy * dy) / (iry * iry);
      if (outer <= 1 && inner > 1) {
        const key = paint(dx, dy, lit(dx / rx, dy / ry), Math.atan2(dy / ry, dx / rx));
        if (key) c.put(x, y, key);
      }
    }
}
/** Smooth hand-authored keypoints into one value per column. */
function curve(points: [number, number][], x: number) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1],
      [x1, y1] = points[i];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0),
        s = (1 - Math.cos(Math.PI * t)) / 2;
      return y0 + (y1 - y0) * s;
    }
  }
  return points[points.length - 1][1];
}
/** A drifting aurora ribbon with mint crest, teal body, deep lower half and violet hem. */
function ribbon(
  c: Canvas,
  centre: [number, number][],
  thickness: [number, number][],
  from: number,
  to: number,
  wisp = false,
) {
  for (let x = from; x <= to; x++) {
    const cy = curve(centre, x),
      t = Math.max(1, Math.round(curve(thickness, x))),
      top = Math.round(cy - t / 2);
    for (let i = 0; i < t; i++) {
      const y = top + i;
      let key = "body";
      if (wisp) key = i === 0 ? "body" : "fringe";
      else if (t >= 3 && i === 0) key = "hi";
      else if (t >= 4 && i === t - 1) key = "fringe";
      else if (t >= 4 && i >= Math.ceil(t * 0.55)) key = "deep";
      c.put(x, y, key);
    }
  }
}

const POLAR_CENTRE: [number, number][] = [
  [2, 12],
  [11, 8],
  [24, 13],
  [37, 7],
  [46, 10],
];
const POLAR_THICKNESS: [number, number][] = [
  [2, 1],
  [6, 3],
  [14, 5],
  [30, 5],
  [40, 4],
  [46, 1],
];
function paintPolarAbove(c: Canvas) {
  // A slow S-curve band: mint crest, teal body, deep lower half, violet hem.
  ribbon(c, POLAR_CENTRE, POLAR_THICKNESS, 2, 46);
  c.outline();
  // Aurora curtains hang below the band; drawn after the outline so each
  // one-pixel streamer stays airy instead of gaining a dark border.
  const curtains: [number, number][] = [
    [7, 3],
    [12, 6],
    [18, 3],
    [25, 7],
    [31, 4],
    [37, 6],
    [42, 3],
  ];
  for (const [x, length] of curtains) {
    let y = Math.round(curve(POLAR_CENTRE, x));
    while (c.get(x, y) && c.get(x, y) !== "outline") y++;
    for (let i = 0; i < length; i++)
      c.put(x, y + i, i < length / 2 ? "deep" : "fringe");
  }
  c.star(6, 4, "spark2", "spark", "a");
  c.star(33, 3, "spark2", "spark", "a");
  c.put(44, 4, "spark", "a");
  c.put(20, 21, "spark2", "a");
  c.star(44, 4, "spark2", "spark", "b");
  c.star(20, 21, "spark2", "spark", "b");
  c.put(6, 4, "spark", "b");
  c.put(33, 3, "spark2", "b");
  c.put(24, 3, "spark2", "b");
}
function paintMoonAbove(c: Canvas) {
  // Crescent lit from the upper left: outer disc minus an offset disc.
  const cx = 32,
    cy = 12,
    r = 9.5,
    bx = 35.5,
    by = 14.5,
    br = 8.6;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const ex = x + 0.5 - bx,
        ey = y + 0.5 - by;
      if (ex * ex + ey * ey <= br * br) continue;
      const edge = Math.hypot(dx, dy) > r - 1.4,
        biteEdge = Math.hypot(ex, ey) <= br + 1.1,
        light = lit(dx, dy);
      let key = "body";
      if (biteEdge) key = "deep";
      else if (edge && light > 0.2) key = "hi";
      else if (edge && light < -0.4) key = "deep";
      c.put(x, y, key);
    }
  c.outline();
  // Star dust wake curling away from the lower tip, fading with distance.
  const wake: [number, number][] = [
    [23, 19],
    [19, 18],
    [15, 17],
    [11, 15],
    [7, 13],
    [4, 10],
  ];
  wake.forEach(([x, y], i) => {
    const far = i >= 3;
    if (i % 2 === 0) {
      c.put(x, y, far ? "spark2" : "hi", "a");
      c.star(x, y, "spark2", "spark", "b");
    } else {
      c.star(x, y, "spark2", far ? "hi" : "spark", "a");
      c.put(x, y, "spark2", "b");
    }
  });
  c.put(25, 3, "spark", "a");
  c.put(43, 5, "spark2", "a");
  c.star(43, 5, "spark2", "spark", "b");
  c.put(26, 2, "spark2", "b");
}
function paintGoldAbove(c: Canvas) {
  ellipseRing(c, 24, 17.5, 16, 4.5, 2.6, (_dx, _dy, light) =>
    light > 0.55 ? "hi" : light < -0.45 ? "deep" : "body",
  );
  // Sun rays above the halo; tips catch the light.
  const rays: [number, number, number, number][] = [
    [23, 3, 23, 7],
    [24, 3, 24, 7],
    [16, 6, 18, 8],
    [31, 6, 29, 8],
    [10, 10, 12, 11],
    [37, 10, 35, 11],
  ];
  for (const [x0, y0, x1, y1] of rays) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps),
        y = Math.round(y0 + ((y1 - y0) * i) / steps);
      c.put(x, y, i === 0 && x0 <= 24 ? "hi" : i === 0 ? "body" : "body");
      if (i === steps) c.put(x, y, "deep");
    }
  }
  c.outline();
  c.put(23, 3, "hi");
  c.put(16, 6, "hi");
  c.star(6, 5, "spark2", "spark", "a");
  c.star(41, 5, "spark2", "spark", "a");
  c.put(3, 15, "spark2", "a");
  c.put(45, 14, "spark2", "a");
  c.put(6, 5, "spark", "b");
  c.put(41, 5, "spark", "b");
  c.star(3, 15, "spark2", "spark", "b");
  c.star(45, 14, "spark2", "spark", "b");
  c.put(24, 1, "spark", "b");
}
function paintGenericAbove(c: Canvas) {
  ellipseRing(c, 24, 15.5, 17, 4.5, 2.2, (_dx, _dy, light) =>
    light > 0.55 ? "hi" : light < -0.45 ? "deep" : "body",
  );
  c.outline();
  c.star(8, 6, "spark2", "spark", "a");
  c.star(38, 5, "spark2", "spark", "a");
  c.put(24, 3, "spark2", "a");
  c.put(8, 6, "spark", "b");
  c.put(38, 5, "spark", "b");
  c.star(24, 3, "spark2", "spark", "b");
}

/** Ground glow: a perspective ring of light under the feet with floating motes. */
function groundRing(
  c: Canvas,
  paint: (light: number, angle: number) => string | null,
) {
  ellipseRing(c, 28, 12.5, 25, 6.5, 3, (_dx, _dy, light, angle) =>
    paint(light, angle),
  );
}
function paintPolarBelow(c: Canvas) {
  // Lit mint fades through teal into the violet hem on the far side.
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > 0 ? "body" : light > -0.55 ? "deep" : "fringe",
  );
  c.outline();
  // Curtains rise from the back edge of the ring and shimmer between frames.
  const streamers: [number, number, number][] = [
    [9, 7, 3],
    [15, 5, 2],
    [21, 4, 4],
    [28, 3, 3],
    [35, 4, 4],
    [41, 5, 2],
    [47, 7, 3],
  ];
  streamers.forEach(([x, top, length], i) => {
    const long = i % 2 === 0;
    for (const layer of ["a", "b"] as const) {
      const n = (layer === "a") === long ? length : Math.max(1, length - 1);
      for (let j = 0; j < n; j++)
        c.put(x, top - j, j === n - 1 ? "hi" : j === 0 ? "deep" : "body", layer);
    }
  });
  c.star(4, 3, "spark2", "spark", "a");
  c.put(52, 4, "spark", "a");
  c.put(4, 3, "spark", "b");
  c.star(52, 4, "spark2", "spark", "b");
}
function paintMoonBelow(c: Canvas) {
  // Moonwake: a bright crescent on the lit side, the rest a dim wake.
  ellipseRing(
    c,
    28,
    12.5,
    25,
    6.5,
    (light) => 2 + 2.6 * Math.max(0, light),
    (_dx, _dy, light) =>
      light > 0.55 ? "hi" : light > 0 ? "body" : light > -0.5 ? "deep" : "fringe",
  );
  c.outline();
  c.star(12, 4, "spark2", "spark", "a");
  c.put(22, 2, "spark2", "a");
  c.put(40, 3, "spark2", "a");
  c.star(48, 6, "spark2", "hi", "a");
  c.put(12, 4, "spark", "b");
  c.star(22, 2, "spark2", "spark", "b");
  c.star(40, 3, "spark2", "hi", "b");
  c.put(48, 6, "spark2", "b");
  c.put(31, 5, "spark", "b");
}
function paintGoldBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light < -0.45 ? "deep" : "body",
  );
  // Short ray ticks around the halo.
  const ticks: [number, number, string][] = [
    [28, 4, "hi"],
    [28, 5, "body"],
    [1, 12, "body"],
    [2, 12, "body"],
    [53, 12, "deep"],
    [54, 12, "deep"],
    [10, 6, "hi"],
    [11, 7, "body"],
    [45, 6, "body"],
    [44, 7, "body"],
    [11, 18, "deep"],
    [44, 18, "deep"],
  ];
  for (const [x, y, key] of ticks) c.put(x, y, key);
  c.outline();
  c.star(6, 3, "spark2", "spark", "a");
  c.star(50, 4, "spark2", "spark", "a");
  c.put(36, 2, "spark", "a");
  c.put(6, 3, "spark", "b");
  c.put(50, 4, "spark", "b");
  c.star(36, 2, "spark2", "spark", "b");
  c.put(20, 1, "spark", "b");
}
function paintGenericBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light < -0.45 ? "deep" : "body",
  );
  c.outline();
  c.star(10, 4, "spark2", "spark", "a");
  c.put(45, 4, "spark2", "a");
  c.put(10, 4, "spark", "b");
  c.star(45, 4, "spark2", "spark", "b");
}


// ---- Catalog v2 editions -------------------------------------------------
// Same rules as the originals: light from the upper left, a shared 1px ink
// outline on the base layer and two alternating sparkle frames.

/** Bresenham-style line on one layer. */
function line(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  key: string,
  layer: Layer = "base",
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++)
    c.put(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, key, layer);
}
/** Filled disc shaded from the upper left. */
function disc(c: Canvas, cx: number, cy: number, r: number, layer: Layer = "base") {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const light = lit(dx, dy),
        edge = Math.hypot(dx, dy) > r - 1.3;
      c.put(
        x,
        y,
        edge && light > 0.25 ? "hi" : edge && light < -0.35 ? "deep" : "body",
        layer,
      );
    }
}
/** Teardrop flame: tip at (x, top), rounded base on row `base`. */
function flame(c: Canvas, x: number, top: number, base: number, width: number) {
  const height = base - top;
  for (let y = top; y <= base; y++) {
    const t = (y - top) / height,
      half = width * Math.sqrt(t) * (t > 0.78 ? 1 - ((t - 0.78) / 0.22) * 0.55 : 1),
      lean = Math.sin(t * Math.PI) * 0.8,
      left = Math.round(x - lean - half),
      right = Math.round(x - lean + half);
    for (let px = left; px <= right; px++) {
      const inner = Math.abs(px - (x - lean)) < half * 0.45 && t > 0.4;
      let key = inner ? "hi" : px < x - lean ? "body" : "deep";
      if (y === base || (t > 0.9 && !inner)) key = "deep";
      c.put(px, y, key);
    }
  }
}
function paintEmberAbove(c: Canvas) {
  flame(c, 13, 9, 19, 3);
  flame(c, 24, 3, 20, 4.2);
  flame(c, 35, 9, 19, 3);
  c.outline();
  // Embers drift up and swap sides between frames.
  c.put(8, 6, "spark2", "a");
  c.star(18, 2, "spark2", "spark", "a");
  c.put(30, 4, "spark2", "a");
  c.put(41, 7, "fringe", "a");
  c.put(9, 4, "fringe", "b");
  c.put(19, 4, "spark2", "b");
  c.star(30, 2, "spark2", "spark", "b");
  c.put(40, 5, "spark2", "b");
}
function paintEmberBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > 0 ? "body" : light > -0.5 ? "deep" : "fringe",
  );
  c.outline();
  // Flame tongues lick up from the back edge and flicker between frames.
  const tongues: [number, number, number][] = [
    [10, 7, 3],
    [17, 5, 4],
    [24, 4, 3],
    [31, 4, 5],
    [38, 5, 3],
    [45, 7, 4],
  ];
  tongues.forEach(([x, top, length], i) => {
    for (const layer of ["a", "b"] as const) {
      const n = (layer === "a") === (i % 2 === 0) ? length : Math.max(1, length - 2);
      for (let j = 0; j < n; j++)
        c.put(x, top - j, j === n - 1 ? "spark2" : j === 0 ? "deep" : "body", layer);
    }
  });
  c.put(4, 4, "spark2", "a");
  c.put(52, 2, "spark2", "b");
}
/** Small falling drop: point on top, round shaded belly. */
function drop(c: Canvas, x: number, y: number, layer: Layer = "base") {
  c.put(x, y, "body", layer);
  c.put(x, y + 1, "body", layer);
  c.put(x - 1, y + 2, "hi", layer);
  c.put(x, y + 2, "body", layer);
  c.put(x + 1, y + 2, "deep", layer);
  c.put(x - 1, y + 3, "body", layer);
  c.put(x, y + 3, "deep", layer);
  c.put(x + 1, y + 3, "deep", layer);
  c.put(x, y + 4, "fringe", layer);
}
function paintDewAbove(c: Canvas) {
  // A thin water halo strung with drops.
  ellipseRing(c, 24, 13, 18, 5, 1.2, (_dx, _dy, light) =>
    light > 0.3 ? "hi" : light < -0.3 ? "deep" : "body",
  );
  for (const [x, y] of [
    [7, 11],
    [14, 6],
    [24, 4],
    [34, 6],
    [41, 11],
    [17, 15],
    [31, 15],
  ] as [number, number][])
    drop(c, x, y);
  c.outline();
  drop(c, 10, 18, "a");
  drop(c, 38, 18, "b");
  c.star(24, 1, "spark2", "spark", "a");
  c.put(24, 1, "spark", "b");
  c.star(44, 3, "spark2", "spark", "b");
}
function paintDewBelow(c: Canvas) {
  // Two ripples spreading from where the drop lands.
  ellipseRing(c, 28, 12.5, 25, 6.5, 1.6, (_dx, _dy, light) =>
    light > 0.45 ? "hi" : light > -0.2 ? "body" : "deep",
  );
  ellipseRing(c, 28, 12, 13, 3.6, 1.8, (_dx, _dy, light) =>
    light > 0.3 ? "hi" : light < -0.4 ? "fringe" : "deep",
  );
  c.outline();
  drop(c, 28, 2, "a");
  c.put(27, 11, "spark2", "b");
  c.put(29, 11, "spark2", "b");
  c.put(28, 10, "spark", "b");
  c.star(8, 3, "spark2", "spark", "a");
  c.star(48, 3, "spark2", "spark", "b");
}
/** Five-petal diamond flower with a pollen centre. */
function flower(c: Canvas, x: number, y: number) {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > 2) continue;
      c.put(x + dx, y + dy, d === 0 ? "spark2" : dx + dy < 0 ? "hi" : "body");
    }
}
function paintBloomAbove(c: Canvas) {
  // A leafy crown with flowers on top.
  ellipseRing(c, 24, 15, 18, 5.5, 2, (_dx, _dy, light) =>
    light > 0.2 ? "deep" : "fringe",
  );
  for (const [x, y] of [
    [8, 12],
    [16, 9],
    [24, 8],
    [32, 9],
    [40, 12],
  ] as [number, number][])
    flower(c, x, y);
  c.outline();
  // Drifting petals.
  c.put(4, 6, "body", "a");
  c.put(20, 3, "hi", "a");
  c.put(44, 5, "body", "a");
  c.put(5, 8, "body", "b");
  c.put(29, 3, "hi", "b");
  c.put(43, 7, "body", "b");
  c.star(28, 2, "spark2", "spark", "a");
}
function paintBloomBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.1 ? "deep" : "fringe"));
  for (const [x, y] of [
    [6, 11],
    [14, 16],
    [28, 18],
    [42, 16],
    [50, 11],
    [20, 7],
    [36, 7],
  ] as [number, number][])
    flower(c, x, y);
  c.outline();
  c.put(10, 3, "body", "a");
  c.put(28, 2, "hi", "a");
  c.put(47, 4, "body", "a");
  c.put(11, 5, "body", "b");
  c.put(29, 4, "hi", "b");
  c.put(46, 2, "body", "b");
  c.star(52, 5, "spark2", "spark", "b");
}
function paintStormAbove(c: Canvas) {
  // Puffy cloud crown; bolts strike from its underside in alternate frames.
  disc(c, 11, 10, 4.5);
  disc(c, 19, 7.5, 5.5);
  disc(c, 29, 7.5, 5.5);
  disc(c, 37, 10, 4.5);
  for (let x = 8; x <= 40; x++) {
    c.put(x, 13, "deep");
    if (x > 10 && x < 38) c.put(x, 14, "fringe");
  }
  c.outline();
  const bolt = (points: [number, number][], layer: Layer) => {
    for (let i = 1; i < points.length; i++)
      line(c, ...points[i - 1], ...points[i], "spark2", layer);
  };
  bolt(
    [
      [15, 15],
      [13, 18],
      [16, 18],
      [13, 22],
    ],
    "a",
  );
  bolt(
    [
      [33, 15],
      [31, 18],
      [34, 18],
      [32, 21],
    ],
    "b",
  );
  c.put(24, 16, "body", "a");
  c.put(25, 18, "body", "b");
  c.star(44, 3, "spark2", "spark", "a");
  c.star(4, 4, "spark2", "spark", "b");
}
function paintStormBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > 0 ? "body" : light > -0.5 ? "deep" : "fringe",
  );
  c.outline();
  // Arcs crackle across the ring, jumping between frames.
  const arc = (points: [number, number][], layer: Layer) => {
    for (let i = 1; i < points.length; i++)
      line(c, ...points[i - 1], ...points[i], "spark2", layer);
  };
  arc(
    [
      [6, 9],
      [9, 6],
      [12, 8],
      [15, 4],
    ],
    "a",
  );
  arc(
    [
      [37, 4],
      [40, 7],
      [43, 5],
      [46, 8],
    ],
    "a",
  );
  arc(
    [
      [20, 3],
      [23, 1],
      [25, 4],
      [28, 1],
    ],
    "b",
  );
  arc(
    [
      [49, 9],
      [51, 6],
      [53, 9],
    ],
    "b",
  );
  c.put(2, 13, "spark", "b");
}
function paintCometAbove(c: Canvas) {
  // Tail first, tapering toward the lower left, then the bright head.
  for (let x = 3; x <= 34; x++) {
    const t = (x - 3) / 31,
      cy = 20 - t * 11,
      half = 0.5 + t * 2.6;
    for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
      const top = y <= cy - half * 0.4;
      c.put(x, y, t < 0.35 ? "fringe" : t < 0.7 ? (top ? "body" : "deep") : top ? "hi" : "body");
    }
  }
  disc(c, 37, 8, 4.6);
  c.outline();
  c.star(35, 6, "spark2", "spark", "a");
  c.put(12, 13, "spark2", "a");
  c.put(22, 19, "spark2", "a");
  c.star(44, 2, "spark2", "spark", "a");
  c.put(35, 6, "spark", "b");
  c.star(9, 13, "spark2", "spark", "b");
  c.put(26, 18, "spark2", "b");
  c.put(45, 15, "spark2", "b");
}
function paintCometBelow(c: Canvas) {
  // An orbit: the comet head on the lit front left, its tail trailing round.
  const head = Math.atan2(0.72, -0.7);
  ellipseRing(c, 28, 12.5, 25, 6.5, 2, (dx, _dy, _light, angle) => {
    const behind = (((head - angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (behind < 0.7) return "hi";
    if (behind < 1.5) return "body";
    if (behind < 2.4) return "deep";
    if (behind < 3.2) return "fringe";
    return null;
  });
  disc(c, 10.5, 16, 3.2);
  c.outline();
  // The rest of the orbit is a faint dotted path that shimmers.
  for (let i = 0; i < 14; i++) {
    const angle = head + 3.4 + i * 0.2,
      x = 28 + Math.cos(angle) * 24,
      y = 12.5 + Math.sin(angle) * 5.8;
    if (i % 2 === 0) c.put(x, y, "deep", i % 4 === 0 ? "a" : "b");
  }
  c.star(10, 15, "spark2", "spark", "a");
  c.put(30, 2, "spark2", "a");
  c.star(48, 4, "spark2", "spark", "a");
  c.put(10, 15, "spark", "b");
  c.star(30, 2, "spark2", "spark", "b");
  c.put(4, 5, "spark2", "b");
}
function paintNovaAbove(c: Canvas) {
  // A starburst: shaded core, long cardinal rays, shorter diagonals.
  const cx = 24,
    cy = 11;
  line(c, cx - 15, cy, cx + 15, cy, "body");
  line(c, cx, cy - 10, cx, cy + 10, "body");
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    line(c, cx + sx * 2, cy + sy * 2, cx + sx * 7, cy + sy * 6, "deep");
  disc(c, cx + 0.5, cy + 0.5, 4);
  c.put(cx - 15, cy, "hi");
  c.put(cx, cy - 10, "hi");
  c.outline();
  // Rays extend and flare alternately.
  c.put(cx - 17, cy, "spark2", "a");
  c.put(cx + 17, cy, "spark2", "a");
  c.star(cx - 9, cy - 8, "spark2", "spark", "a");
  c.star(cx + 10, cy + 8, "spark2", "spark", "a");
  c.put(cx, cy - 12, "spark2", "b");
  c.put(cx, cy + 12, "spark2", "b");
  c.star(cx + 9, cy - 8, "spark2", "spark", "b");
  c.star(cx - 10, cy + 8, "spark2", "spark", "b");
  c.put(cx - 1, cy - 1, "spark", "b");
}
function paintNovaBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light < -0.45 ? "deep" : "body",
  );
  // Radiant spikes push outward from the ring.
  const spikes: number[] = [];
  for (let k = 0; k < 12; k++) {
    const angle = (k * Math.PI) / 6 + Math.PI / 12;
    if (Math.sin(angle) > 0.6) continue; // keep the front edge clear
    spikes.push(angle);
  }
  const spike = (angle: number, from: number, to: number, layer: Layer) => {
    const ux = Math.cos(angle),
      uy = Math.sin(angle);
    for (let i = from; i <= to; i++)
      c.put(
        28 + ux * (24.5 + i),
        12.5 + uy * (6 + i * 0.6),
        i >= to ? "fringe" : lit(ux, uy) > 0 ? "hi" : "deep",
        layer,
      );
  };
  spikes.forEach((angle) => spike(angle, 1, 2, "base"));
  c.outline();
  spikes.forEach((angle, k) => spike(angle, 3, 3, k % 2 ? "a" : "b"));
  c.star(28, 3, "spark2", "spark", "a");
  c.star(10, 2, "spark2", "spark", "b");
  c.star(46, 2, "spark2", "spark", "b");
  c.put(28, 3, "spark", "b");
}

// ---- NPC and monster editions --------------------------------------------
// Earned only from NPCs (pilgrim, chronicle, ledger, wisp) and monsters
// (wardbreaker, bossbane). Original creature motifs in the same pixel rules:
// upper-left light, the shared ink outline on the base layer, two sparkle frames.

/** A small footprint (heel, sole and toe), pointing up when `flip` is false. */
function footprint(c: Canvas, x: number, y: number, flip = false, layer: Layer = "base") {
  const d = flip ? -1 : 1;
  c.put(x, y, "hi", layer);
  c.put(x + 1, y, "body", layer);
  c.put(x, y + d, "body", layer);
  c.put(x + 1, y + d, "deep", layer);
  c.put(x, y + 3 * d, "body", layer);
  c.put(x + 1, y + 3 * d, "deep", layer);
}
function paintPilgrimAbove(c: Canvas) {
  // A worn trail ring with footprints walking round it toward a waystone.
  ellipseRing(c, 24, 16, 17, 4.5, 3, (_dx, _dy, light) =>
    light > 0.2 ? "deep" : "fringe",
  );
  // Waystone: a rounded standing stone with a moss cap, right of centre.
  for (let y = 5; y <= 14; y++)
    for (let x = 32; x <= 36; x++) {
      if ((y === 5 && (x === 32 || x === 36)) || (y === 6 && x === 36)) continue;
      c.put(x, y, y <= 6 ? "body" : x === 32 ? "hi" : x === 36 ? "deep" : "fringe");
    }
  c.put(33, 9, "hi");
  c.put(34, 10, "hi");
  c.put(33, 11, "hi");
  for (const [x, y] of [
    [9, 9],
    [14, 6],
    [20, 4],
    [26, 4],
  ] as [number, number][])
    footprint(c, x, y);
  c.outline();
  footprint(c, 6, 13, false, "a");
  footprint(c, 40, 13, true, "b");
  c.star(28, 1, "spark2", "spark", "a");
  c.star(43, 4, "spark2", "spark", "b");
  c.put(4, 6, "spark2", "b");
}
function paintPilgrimBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.3 ? "body" : light > -0.4 ? "deep" : "fringe"));
  for (const [x, y, flip] of [
    [8, 14, false],
    [14, 16, false],
    [21, 17, false],
    [33, 17, true],
    [40, 16, true],
    [46, 14, true],
  ] as [number, number, boolean][])
    footprint(c, x, flip ? y + 1 : y - 2, flip);
  c.outline();
  // A trail of fresh prints appears ahead of the walker in turn.
  footprint(c, 12, 3, false, "a");
  footprint(c, 42, 3, false, "b");
  c.star(28, 2, "spark2", "spark", "a");
  c.put(4, 4, "spark2", "b");
  c.put(52, 5, "spark2", "a");
}
function paintChronicleAbove(c: Canvas) {
  // An open storybook floating as a crown, pages bowing up from the spine.
  for (let x = 9; x <= 39; x++) {
    const d = Math.abs(x - 24),
      bow = Math.sin((Math.min(d, 15) / 15) * Math.PI),
      top = Math.round(12 - 3.2 * bow),
      bottom = Math.round(18 - 1.4 * bow);
    for (let y = top; y <= bottom; y++) {
      let key = "hi";
      if (x === 24) key = "deep";
      else if (y === bottom) key = "fringe";
      else if (y === bottom - 1) key = x < 24 ? "body" : "deep";
      else if (d >= 3 && d <= 12 && (y - top) % 2 === 0 && y > top && x % 3 !== 0)
        key = "body"; // lines of text
      c.put(x, y, key);
    }
  }
  c.outline();
  // Rune glyphs lift off the pages and swap between frames.
  const rune = (x: number, y: number, layer: Layer) => {
    c.put(x, y, "spark2", layer);
    c.put(x, y + 1, "spark2", layer);
    c.put(x + 1, y + 1, "spark2", layer);
    c.put(x, y + 2, "spark2", layer);
  };
  rune(14, 4, "a");
  rune(30, 2, "a");
  rune(19, 1, "b");
  rune(35, 5, "b");
  c.star(24, 3, "spark2", "spark", "a");
  c.put(24, 4, "spark", "b");
  c.star(5, 9, "spark2", "spark", "b");
  c.put(43, 10, "spark2", "a");
}
function paintChronicleBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > 0 ? "body" : light > -0.5 ? "deep" : "fringe",
  );
  // A bookmark ribbon hangs from the front of the ring.
  for (let y = 17; y <= 19; y++) {
    c.put(27, y, "spark2");
    c.put(28, y, "spark2");
  }
  c.outline();
  // Runes circle the ring, alternating between frames.
  for (let k = 0; k < 10; k++) {
    const angle = (k * Math.PI) / 5,
      x = 28 + Math.cos(angle) * 21,
      y = 12.5 + Math.sin(angle) * 4.2 - 5;
    c.put(x, y, "spark2", k % 2 ? "a" : "b");
    c.put(x, y - 1, "hi", k % 2 ? "a" : "b");
  }
  c.star(52, 3, "spark2", "spark", "a");
  c.star(4, 3, "spark2", "spark", "b");
}
/** A gold coin seen edge-on: a shaded oval with a bright rim on the lit side. */
function coin(c: Canvas, x: number, y: number) {
  for (let dx = -2; dx <= 2; dx++) {
    c.put(x + dx, y, dx < 0 ? "hi" : "body");
    if (Math.abs(dx) < 2) c.put(x + dx, y + 1, dx < 1 ? "body" : "deep");
  }
}
function paintLedgerAbove(c: Canvas) {
  // A halo of floating coins tied with the ledger's red ribbon.
  ellipseRing(c, 24, 15.5, 17, 4.5, 2.6, () => "fringe");
  const coins: [number, number][] = [
    [8, 13],
    [13, 10],
    [19, 9],
    [29, 9],
    [35, 10],
    [40, 13],
  ];
  for (const [x, y] of coins) {
    coin(c, x, y);
    coin(c, x, y - 2);
  }
  // Ledger: a closed book at the top centre.
  for (let y = 4; y <= 10; y++)
    for (let x = 22; x <= 26; x++)
      c.put(x, y, x === 22 ? "hi" : y === 10 ? "deep" : x === 26 ? "deep" : "fringe");
  for (let y = 5; y <= 9; y++) c.put(25, y, "hi");
  c.outline();
  c.star(13, 5, "spark2", "spark", "a");
  c.put(35, 5, "spark2", "a");
  c.star(35, 5, "spark2", "spark", "b");
  c.put(13, 5, "spark2", "b");
  c.put(24, 1, "spark", "a");
  c.put(4, 18, "spark2", "b");
}
function paintLedgerBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.45 ? "hi" : light > -0.3 ? "body" : "deep"));
  // Coin stacks of different heights on the back half of the ring.
  const stacks: [number, number, number][] = [
    [9, 8, 2],
    [17, 6, 3],
    [28, 5, 4],
    [39, 6, 3],
    [47, 8, 2],
  ];
  for (const [x, y, n] of stacks) for (let i = 0; i < n; i++) coin(c, x, y - i * 2);
  // Ribbon tail across the front.
  for (let x = 22; x <= 34; x++) c.put(x, 18 + (x % 4 === 0 ? 1 : 0), "fringe");
  c.outline();
  // A coin flips over the top stack.
  c.put(28, 1, "spark2", "a");
  c.put(27, 1, "hi", "a");
  c.put(29, 1, "hi", "a");
  c.put(28, 0, "spark", "b");
  c.star(4, 4, "spark2", "spark", "a");
  c.star(52, 4, "spark2", "spark", "b");
}
/** One curved horn: it sweeps out from its base, then turns up to a pale tip. */
function horn(c: Canvas, baseX: number, baseY: number, side: -1 | 1) {
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      x = baseX + side * 11 * Math.sin((t * Math.PI) / 2) ** 0.7,
      y = baseY - 2 * t - 13 * t * t,
      half = 2.4 * (1 - t) + 0.5;
    for (let w = -half; w <= half; w += 0.5) {
      const key = t > 0.85 ? "hi" : w < -half * 0.3 ? "hi" : w > half * 0.4 ? "deep" : "body";
      c.put(x, y + w, key);
    }
    // Growth rings near the base.
    if (i % 7 === 3 && t < 0.6) c.put(x, y, "deep");
  }
}
function paintWardbreakerAbove(c: Canvas) {
  // Guardian horns flank a ward rune that has been cracked in two.
  horn(c, 15, 19, -1);
  horn(c, 33, 19, 1);
  const cx = 24,
    cy = 12;
  for (let k = 0; k <= 5; k++) {
    // Diamond ward, split by a gap on the crack line.
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = cx + sx * k + (sx < 0 ? -1 : 1),
        y = cy + sy * (5 - k);
      c.put(x, y, sx < 0 ? "fringe" : "spark2");
    }
  }
  c.put(cx - 1, cy - 1, "spark2");
  c.put(cx + 1, cy + 1, "fringe");
  c.outline();
  // Ward shards fly off and green ghost-light flickers between frames.
  c.put(19, 4, "spark2", "a");
  c.put(30, 20, "spark2", "a");
  c.put(29, 3, "spark2", "b");
  c.put(18, 20, "spark2", "b");
  c.star(cx, cy, "spark2", "spark", "a");
  c.put(cx, cy, "spark", "b");
  c.star(44, 3, "spark2", "spark", "b");
  c.star(4, 3, "spark2", "spark", "a");
}
function paintWardbreakerBelow(c: Canvas) {
  // A ward circle broken in three places; its shards hover above the gaps.
  const gaps = [Math.PI * 0.1, Math.PI * 0.8, Math.PI * 1.45];
  groundRing(c, (light, angle) => {
    const a = (angle + 2 * Math.PI) % (2 * Math.PI);
    if (gaps.some((g) => Math.abs(a - g) < 0.16)) return null;
    return light > 0.3 ? "spark2" : light > -0.3 ? "deep" : "fringe";
  });
  c.outline();
  gaps.forEach((g, k) => {
    const x = 28 + Math.cos(g) * 25,
      y = 12.5 + Math.sin(g) * 6.5 - 3;
    for (const layer of ["a", "b"] as const) {
      const lift = (layer === "a") === (k % 2 === 0) ? 0 : 1;
      c.put(x, y - lift, "spark2", layer);
      c.put(x + 1, y - lift - 1, "body", layer);
    }
  });
  c.star(28, 2, "spark2", "spark", "a");
  c.put(28, 2, "spark", "b");
  c.star(8, 3, "spark2", "spark", "b");
  c.star(48, 3, "spark2", "spark", "a");
}
/** A small ghost-fire soul flame. */
function soulFlame(c: Canvas, x: number, y: number, layer: Layer = "base") {
  c.put(x, y, "hi", layer);
  c.put(x, y + 1, "body", layer);
  c.put(x - 1, y + 2, "body", layer);
  c.put(x, y + 2, "hi", layer);
  c.put(x + 1, y + 2, "deep", layer);
  c.put(x - 1, y + 3, "deep", layer);
  c.put(x, y + 3, "body", layer);
  c.put(x + 1, y + 3, "deep", layer);
}
function paintWispAbove(c: Canvas) {
  // A ghost-fire lantern hangs over the head; three soul flames orbit it.
  for (let x = 21; x <= 27; x++) c.put(x, 7, "fringe"); // cap
  c.put(23, 6, "fringe");
  c.put(24, 5, "fringe");
  c.put(25, 6, "fringe");
  for (let y = 8; y <= 16; y++)
    for (let x = 21; x <= 27; x++)
      c.put(
        x,
        y,
        x === 21 || x === 27 || y === 16 ? "fringe" : x === 22 ? "hi" : x === 26 ? "deep" : "body",
      );
  flame(c, 24, 9, 15, 1.6);
  for (let x = 22; x <= 26; x++) c.put(x, 17, "deep"); // base
  soulFlame(c, 10, 10);
  soulFlame(c, 38, 10);
  soulFlame(c, 24, 18);
  c.outline();
  // The souls drift round the lantern between frames.
  soulFlame(c, 14, 4, "a");
  soulFlame(c, 34, 15, "a");
  soulFlame(c, 34, 3, "b");
  soulFlame(c, 13, 15, "b");
  c.star(44, 3, "spark2", "spark", "a");
  c.star(4, 4, "spark2", "spark", "b");
  c.put(24, 12, "spark", "a");
}
function paintWispBelow(c: Canvas) {
  // A pale will-o'-wisp ring; soul flames stand on it and motes rise.
  ellipseRing(c, 28, 12.5, 25, 6.5, 2, (_dx, _dy, light) =>
    light > 0.45 ? "hi" : light > -0.2 ? "body" : light > -0.6 ? "deep" : "fringe",
  );
  soulFlame(c, 8, 8);
  soulFlame(c, 28, 2);
  soulFlame(c, 48, 8);
  c.outline();
  for (const [x, y, layer] of [
    [16, 3, "a"],
    [40, 2, "a"],
    [20, 1, "b"],
    [36, 4, "b"],
  ] as [number, number, Layer][])
    c.star(x, y, "spark2", "spark", layer);
  c.put(3, 4, "spark2", "a");
  c.put(53, 4, "spark2", "b");
}
/** A monster fang: wide at its root, tapering to a pale tip. */
function fang(c: Canvas, x: number, rootY: number, length: number, dir: -1 | 1) {
  for (let i = 0; i < length; i++) {
    const y = rootY + dir * i,
      half = Math.round((1 - i / length) * 1.6);
    for (let dx = -half; dx <= half; dx++)
      c.put(x + dx, y, i >= length - 2 ? "hi" : dx < 0 ? "hi" : "body");
  }
}
function paintBossbaneAbove(c: Canvas) {
  // A crown of fangs on a dark band, with a rift-glow eye in the middle.
  ellipseRing(c, 24, 16.5, 16, 4.5, 2.2, (_dx, _dy, light) =>
    light > 0.3 ? "deep" : "fringe",
  );
  for (const [x, len] of [
    [10, 4],
    [16, 6],
    [24, 9],
    [32, 6],
    [38, 4],
  ] as [number, number][])
    fang(c, x, 12 - (x === 24 ? 0 : x === 16 || x === 32 ? 1 : 0), len, -1);
  c.outline();
  // Glowing eyes open in the band and blink between frames.
  c.put(20, 16, "spark2", "a");
  c.put(28, 16, "spark2", "a");
  c.put(20, 16, "deep", "b");
  c.put(28, 16, "deep", "b");
  c.star(24, 1, "spark2", "spark", "a");
  c.star(5, 8, "spark2", "spark", "b");
  c.star(43, 8, "spark2", "spark", "a");
  c.put(24, 1, "spark", "b");
}
function paintBossbaneBelow(c: Canvas) {
  // A rift glows inside a ring of fangs: back fangs hang down, front ones rise.
  groundRing(c, (light) => (light > 0.45 ? "body" : light > -0.3 ? "deep" : "fringe"));
  ellipseRing(c, 28, 12.5, 9, 2.2, 1.2, (_dx, _dy, light) =>
    light > 0 ? "spark2" : "body",
  );
  for (const x of [12, 20, 28, 36, 44]) fang(c, x, 7 + Math.round(Math.abs(x - 28) / 8), 3, 1);
  for (const x of [16, 28, 40]) fang(c, x, 18 - Math.round(Math.abs(x - 28) / 9), 3, -1);
  c.outline();
  // Embers spill out of the rift.
  c.put(24, 10, "spark2", "a");
  c.put(31, 9, "spark", "a");
  c.put(27, 8, "spark2", "b");
  c.put(33, 11, "spark", "b");
  c.star(4, 4, "spark2", "spark", "a");
  c.star(52, 4, "spark2", "spark", "b");
}

// ---- Level editions (L5-L10) ---------------------------------------------
// Earned only by reaching a level (claim prefix earned:level:). Same rules:
// upper-left light, the shared ink outline on the base layer, two sparkle frames.

function paintStrideAbove(c: Canvas) {
  // A thin silver ring with a stride of prints walking over it.
  ellipseRing(c, 24, 16, 17, 4.5, 2.6, (_dx, _dy, light) =>
    light > 0.4 ? "hi" : light < -0.4 ? "deep" : "body",
  );
  for (const [x, y] of [
    [11, 7],
    [17, 5],
    [23, 4],
    [29, 5],
    [35, 7],
  ] as [number, number][])
    footprint(c, x, y);
  c.outline();
  c.star(5, 4, "spark2", "spark", "a");
  c.star(43, 4, "spark2", "spark", "b");
}
function paintStrideBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.5 ? "hi" : light > -0.3 ? "body" : "deep"));
  for (const [x, y, flip] of [
    [7, 12, false],
    [13, 15, false],
    [20, 16, false],
    [34, 17, true],
    [41, 16, true],
    [47, 13, true],
  ] as [number, number, boolean][])
    footprint(c, x, flip ? y + 1 : y - 2, flip);
  c.outline();
  footprint(c, 26, 2, false, "a");
  footprint(c, 30, 2, false, "b");
  c.star(5, 4, "spark2", "spark", "a");
  c.star(51, 4, "spark2", "spark", "b");
}
function paintKindleAbove(c: Canvas) {
  // A small brass altar ring with three flames standing on it.
  ellipseRing(c, 24, 18, 14, 4, 2.6, (_dx, _dy, light) =>
    light > 0.3 ? "fringe" : "deep",
  );
  flame(c, 16, 9, 17, 2.4);
  flame(c, 24, 4, 17, 3.4);
  flame(c, 32, 9, 17, 2.4);
  c.outline();
  c.put(16, 6, "spark2", "a");
  c.put(32, 5, "spark2", "b");
  c.star(24, 1, "spark2", "spark", "a");
  c.star(41, 6, "spark2", "spark", "b");
  c.put(6, 7, "spark2", "a");
}
function paintKindleBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.4 ? "fringe" : light > -0.4 ? "deep" : "fringe"));
  flame(c, 10, 4, 11, 2);
  flame(c, 28, 1, 7, 2.4);
  flame(c, 46, 4, 11, 2);
  c.outline();
  c.put(10, 1, "spark2", "a");
  c.put(46, 1, "spark2", "b");
  c.star(20, 2, "spark2", "spark", "b");
  c.star(37, 2, "spark2", "spark", "a");
}
function compassPoints(c: Canvas, cx: number, cy: number, rx: number, ry: number) {
  // Four diamond points around the ring: N and S tall, E and W wide.
  for (let i = 0; i < 4; i++) {
    c.put(cx, cy - ry - 1 - i, i === 3 ? "hi" : "spark2");
    c.put(cx - rx - 1 - i, cy, i === 3 ? "deep" : "spark2");
    c.put(cx + rx + i, cy, i === 3 ? "deep" : "spark2");
  }
  for (let i = 0; i < 2; i++) c.put(cx, cy + ry + i, "spark2");
}
function paintCompassAbove(c: Canvas) {
  ellipseRing(c, 24, 15.5, 15, 4.5, 2.4, (_dx, _dy, light) =>
    light > 0.5 ? "hi" : light < -0.4 ? "deep" : "body",
  );
  compassPoints(c, 24, 15, 15, 4);
  // Needle across the middle.
  line(c, 17, 13, 31, 17, "spark2");
  c.outline();
  c.star(7, 5, "spark2", "spark", "a");
  c.star(41, 5, "spark2", "spark", "b");
}
function paintCompassBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > -0.2 ? "body" : light > -0.6 ? "deep" : "fringe",
  );
  compassPoints(c, 28, 12, 25, 6);
  c.outline();
  c.star(10, 3, "spark2", "spark", "a");
  c.star(46, 3, "spark2", "spark", "b");
  c.put(28, 1, "spark", "a");
}
function quill(c: Canvas, x: number, y: number, length: number) {
  // A slanted feather: a shaft with vanes on its upper side and a dark nib.
  for (let i = 0; i < length; i++) {
    const px = x + i,
      py = y - Math.round(i * 0.6);
    c.put(px, py, i < 2 ? "fringe" : "deep");
    if (i >= 2) {
      const vane = Math.min(3, Math.round(Math.sin((i / length) * Math.PI) * 3.5));
      for (let v = 1; v <= vane; v++) c.put(px - v, py - v, v === vane ? "hi" : "body");
    }
  }
}
function paintQuillAbove(c: Canvas) {
  ellipseRing(c, 24, 17.5, 16, 4.5, 2.4, (_dx, _dy, light) =>
    light > 0.3 ? "body" : light < -0.4 ? "fringe" : "deep",
  );
  quill(c, 20, 15, 14);
  c.outline();
  // Ink stars written along the ring.
  c.star(8, 13, "spark2", "spark", "a");
  c.star(40, 13, "spark2", "spark", "b");
  c.put(14, 9, "spark2", "b");
  c.put(36, 21, "spark2", "a");
  c.star(38, 3, "spark2", "spark", "a");
}
function paintQuillBelow(c: Canvas) {
  groundRing(c, (light) => (light > 0.4 ? "body" : light > -0.4 ? "deep" : "fringe"));
  quill(c, 22, 11, 14);
  c.outline();
  c.star(8, 4, "spark2", "spark", "a");
  c.star(48, 4, "spark2", "spark", "b");
  c.put(16, 2, "spark2", "b");
}
function leaf(c: Canvas, x: number, y: number, dir: number, layer: Layer = "base") {
  c.put(x, y, "body", layer);
  c.put(x + dir, y, "hi", layer);
  c.put(x, y - 1, "deep", layer);
  c.put(x + dir, y + 1, "deep", layer);
}
function paintLaurelAbove(c: Canvas) {
  ellipseRing(c, 24, 16, 16, 4.5, 2.4, (_dx, _dy, light) => (light > 0.3 ? "deep" : "fringe"));
  for (let i = 0; i < 6; i++) {
    leaf(c, 9 + i * 2, 15 - i, -1);
    leaf(c, 39 - i * 2, 15 - i, 1);
  }
  c.put(24, 21, "spark2");
  c.put(23, 21, "spark2");
  c.put(25, 21, "spark2");
  c.outline();
  c.star(24, 4, "spark2", "spark", "a");
  c.star(6, 6, "spark2", "spark", "b");
  c.star(42, 6, "spark2", "spark", "b");
}
function paintLaurelBelow(c: Canvas) {
  // A ground wreath: leaves pointing round the ring, gold ribbon at the front.
  groundRing(c, (light) => (light > 0.4 ? "body" : light > -0.4 ? "deep" : "fringe"));
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.1 + (i / 6) * 0.8),
      x = 28 + Math.cos(a) * 25,
      y = 12.5 - Math.sin(a) * 6.5;
    leaf(c, Math.round(x), Math.round(y) - 1, x < 28 ? 1 : -1);
  }
  for (let x = 25; x <= 31; x++) c.put(x, 19, "spark2");
  c.put(26, 18, "spark2");
  c.put(30, 18, "spark2");
  c.outline();
  c.star(6, 3, "spark2", "spark", "a");
  c.star(50, 3, "spark2", "spark", "b");
  c.put(28, 1, "spark", "a");
}
function peak(c: Canvas, x: number, top: number, base: number) {
  for (let y = top; y <= base; y++) {
    const half = Math.round((y - top) * 0.9);
    for (let px = x - half; px <= x + half; px++)
      c.put(px, y, y - top < 2 ? "hi" : px < x ? "body" : "deep");
  }
}
function paintSummitAbove(c: Canvas) {
  // A gold crown band with three snowy peaks and a summit star.
  ellipseRing(c, 24, 18, 16, 3.8, 2.4, (_dx, _dy, light) =>
    light > 0.5 ? "hi" : light < -0.4 ? "deep" : "body",
  );
  peak(c, 14, 10, 16);
  peak(c, 24, 5, 16);
  peak(c, 34, 10, 16);
  c.outline();
  c.star(24, 2, "spark2", "spark", "a");
  c.put(24, 2, "spark", "b");
  c.star(5, 7, "spark2", "spark", "b");
  c.star(43, 7, "spark2", "spark", "a");
}
function paintSummitBelow(c: Canvas) {
  groundRing(c, (light) =>
    light > 0.55 ? "hi" : light > -0.2 ? "body" : light > -0.6 ? "deep" : "fringe",
  );
  peak(c, 18, 2, 7);
  peak(c, 28, 0, 7);
  peak(c, 38, 2, 7);
  c.outline();
  c.star(7, 3, "spark2", "spark", "a");
  c.star(49, 3, "spark2", "spark", "b");
}

const PAINTERS: Record<AuraSlot, Record<AuraEdition | "generic", (c: Canvas) => void>> = {
  above: {
    polar: paintPolarAbove,
    moon: paintMoonAbove,
    gold: paintGoldAbove,
    ember: paintEmberAbove,
    dew: paintDewAbove,
    bloom: paintBloomAbove,
    storm: paintStormAbove,
    comet: paintCometAbove,
    nova: paintNovaAbove,
    pilgrim: paintPilgrimAbove,
    chronicle: paintChronicleAbove,
    ledger: paintLedgerAbove,
    wardbreaker: paintWardbreakerAbove,
    wisp: paintWispAbove,
    bossbane: paintBossbaneAbove,
    stride: paintStrideAbove,
    kindle: paintKindleAbove,
    compass: paintCompassAbove,
    quill: paintQuillAbove,
    laurel: paintLaurelAbove,
    summit: paintSummitAbove,
    generic: paintGenericAbove,
  },
  below: {
    polar: paintPolarBelow,
    moon: paintMoonBelow,
    gold: paintGoldBelow,
    ember: paintEmberBelow,
    dew: paintDewBelow,
    bloom: paintBloomBelow,
    storm: paintStormBelow,
    comet: paintCometBelow,
    nova: paintNovaBelow,
    pilgrim: paintPilgrimBelow,
    chronicle: paintChronicleBelow,
    ledger: paintLedgerBelow,
    wardbreaker: paintWardbreakerBelow,
    wisp: paintWispBelow,
    bossbane: paintBossbaneBelow,
    stride: paintStrideBelow,
    kindle: paintKindleBelow,
    compass: paintCompassBelow,
    quill: paintQuillBelow,
    laurel: paintLaurelBelow,
    summit: paintSummitBelow,
    generic: paintGenericBelow,
  },
};

const cache = new Map<string, readonly AuraPixelRect[]>();
/** Horizontal run-length rects for one Aura sprite, base layer first. */
export function auraRects(options: AuraOptions = {}): readonly AuraPixelRect[] {
  const slot = auraSlot(options.slot),
    edition = isAuraEdition(options.edition) ? options.edition : null,
    color = HEX.test(options.color || "") ? options.color!.toLowerCase() : "#b8a1ed",
    key = `${edition || "generic:" + color}:${slot}`;
  if (cache.has(key)) return cache.get(key)!;
  const grid = AURA_GRIDS[slot],
    canvas = new Canvas(grid.width, grid.height),
    palette = edition ? PALETTES[edition] : genericPalette(color);
  PAINTERS[slot][edition || "generic"](canvas);
  const rects: AuraPixelRect[] = [];
  for (const layer of ["base", "a", "b"] as const)
    for (let y = 0; y < grid.height; y++) {
      let x = 0;
      while (x < grid.width) {
        const cell = canvas.get(x, y, layer);
        if (!cell) {
          x++;
          continue;
        }
        let width = 1;
        while (canvas.get(x + width, y, layer) === cell) width++;
        rects.push(
          cell === "outline"
            ? { x, y, width, height: 1, color: AURA_OUTLINE.color, opacity: AURA_OUTLINE.opacity }
            : {
                x,
                y,
                width,
                height: 1,
                color: palette[cell] || palette.body,
                ...(layer === "base" ? {} : { frame: layer }),
              },
        );
        x += width;
      }
    }
  cache.set(key, Object.freeze(rects));
  return cache.get(key)!;
}

export function auraScale(size: unknown) {
  return typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= 6
    ? size
    : 1;
}
const rectMarkup = (r: AuraPixelRect) =>
  `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.color}"${r.opacity !== undefined ? ` fill-opacity="${r.opacity}"` : ""}/>`;
/**
 * Static SVG markup for map markers and other innerHTML surfaces. `size` is an
 * integer scale factor on the authored grid. Output contains only rects.
 */
export function auraMarkup(
  edition: string | null | undefined,
  slot: string | null | undefined,
  color?: string | null,
  size = 1,
) {
  const resolvedSlot = auraSlot(slot),
    grid = AURA_GRIDS[resolvedSlot],
    scale = auraScale(size),
    rects = auraRects({ edition, slot: resolvedSlot, color }),
    base = rects.filter((r) => !r.frame).map(rectMarkup).join(""),
    a = rects.filter((r) => r.frame === "a").map(rectMarkup).join(""),
    b = rects.filter((r) => r.frame === "b").map(rectMarkup).join(""),
    resolved = isAuraEdition(edition) ? edition : "generic";
  return `<svg class="aura-sprite aura-sprite-${resolvedSlot}" width="${grid.width * scale}" height="${grid.height * scale}" viewBox="0 0 ${grid.width} ${grid.height}" shape-rendering="crispEdges" aria-hidden="true" focusable="false" data-aura-edition="${resolved}" data-aura-slot="${resolvedSlot}">${base}<g class="aura-frame aura-frame-a">${a}</g><g class="aura-frame aura-frame-b">${b}</g></svg>`;
}
