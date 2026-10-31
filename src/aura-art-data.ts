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
export const AURA_EDITIONS = ["polar", "moon", "gold"] as const;
export type AuraEdition = (typeof AURA_EDITIONS)[number];
export const AURA_GRIDS = Object.freeze({
  above: Object.freeze({ width: 48, height: 24 }),
  below: Object.freeze({ width: 56, height: 20 }),
});
export const AURA_OUTLINE = Object.freeze({ color: "#1A0335", opacity: 0.4 });
export const AURA_EDITION_NAMES = Object.freeze({
  polar: "Northern Lights",
  moon: "Moonwake Aura",
  gold: "Sunlit Aura",
});
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

const PAINTERS: Record<AuraSlot, Record<AuraEdition | "generic", (c: Canvas) => void>> = {
  above: {
    polar: paintPolarAbove,
    moon: paintMoonAbove,
    gold: paintGoldAbove,
    generic: paintGenericAbove,
  },
  below: {
    polar: paintPolarBelow,
    moon: paintMoonBelow,
    gold: paintGoldBelow,
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
