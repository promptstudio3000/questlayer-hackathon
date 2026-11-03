// Original low-poly 3D models for roaming NPCs and monsters (docs/NPC-PLAN.md §14).
//
// Every model is built from three.js primitives in code, so no third-party artwork, GLB or texture is copied
// or loaded. The style follows the Aavegotchi-compatible palette and pixel/ghost look in docs/AAVEGOTCHI-REUSE.md
// §5, but the characters are QuestLayer originals. Only the official Aavegotchi SDK bodies (docs/ASSET-CATALOG.md)
// are loaded from upstream, and never here.
//
// The map uses one shared offscreen renderer to bake each model once into a cached PNG sprite, so N markers cost
// no extra WebGL contexts. The encounter sheet uses createActorScene for one animated, rotatable view.
import * as THREE from "three";
import { tr } from "./i18n.ts";

export const ACTOR_MODELS = [
  "chronicler",
  "merchant",
  "keeper",
  "pilgrim",
  "wisp",
  "glitch-moth",
  "rune-warden",
  "pocket-wisp",
  "storm-golem",
  "sun-beetle",
  // Official Gotchiverse models (Lickquidators and props), loaded at runtime through the pinned, digest-checked
  // server route /api/upstream-models/<key>.fbx (server/upstream-models.mjs). Never committed to this repository.
  "lick-soldier",
  "lick-brute",
  "lick-speedy",
  "lick-turret",
  "lick-boss",
  "great-portal",
  "golden-altar",
] as const;
export type ActorModel = (typeof ACTOR_MODELS)[number];
type UpstreamModel = Extract<ActorModel, `lick-${string}` | "great-portal" | "golden-altar">;
const UPSTREAM: Record<UpstreamModel, { file: string; height: number; fallback: ActorModel; recolor?: Record<string, number>; spin?: boolean }> = {
  "lick-soldier": { file: "lick-soldier", height: 1.1, fallback: "glitch-moth" },
  "lick-brute": { file: "lick-brute", height: 1.15, fallback: "rune-warden" },
  "lick-speedy": { file: "lick-speedy", height: 0.95, fallback: "glitch-moth", spin: true },
  "lick-turret": { file: "lick-turret", height: 0.8, fallback: "rune-warden" },
  "lick-boss": {
    file: "lick-soldier",
    height: 2.0,
    fallback: "storm-golem",
    recolor: { lick_body: 0x3d0981, lick_dark: 0x230e4f, lick_visor: 0xffd01f, lick_brain: 0xfa34f3, surface_glass: 0x37f4f1 },
  },
  "great-portal": { file: "great-portal", height: 1.6, fallback: "keeper" },
  "golden-altar": { file: "golden-altar", height: 1.6, fallback: "keeper" },
};
export const isUpstreamModel = (m: string): m is UpstreamModel => Object.hasOwn(UPSTREAM, m);
let upstreamBase = "/api/upstream-models/";
/** Dev/test hook: where the pinned upstream FBX files are served from. */
export function setUpstreamModelBase(base: string) {
  upstreamBase = base;
}
export const isActorModel = (m: string): m is ActorModel =>
  (ACTOR_MODELS as readonly string[]).includes(m);

/** Display metadata shared by the map legend, the encounter sheet and the dev preview page. */
export const ACTOR_MODEL_INFO: Record<
  ActorModel,
  { label: string; role: string; color: string }
> = {
  chronicler: { get label() { return tr("Chronicler"); }, role: "Storyteller NPC", color: "#b9a6ff" },
  merchant: { get label() { return tr("Travelling merchant"); }, role: "Trader NPC", color: "#81cdcf" },
  keeper: { get label() { return tr("Gate keeper"); }, role: "Keeper (bank) NPC", color: "#8f88b8" },
  pilgrim: { get label() { return tr("Pilgrim"); }, role: "Quest giver NPC", color: "#ff96ff" },
  wisp: { get label() { return tr("Will-o'-wisp"); }, role: "Wandering rare NPC", color: "#51ffa8" },
  "glitch-moth": { get label() { return tr("Glitch Moth"); }, role: "Roamer monster", color: "#fa34f3" },
  "rune-warden": { get label() { return tr("Rune Warden"); }, role: "Guardian monster", color: "#37f4f1" },
  "pocket-wisp": { get label() { return tr("Pocket Wisp"); }, role: "Lurker monster", color: "#7bd88f" },
  "storm-golem": { get label() { return tr("Storm Golem"); }, role: "Weekly boss", color: "#fffa65" },
  "sun-beetle": { get label() { return tr("Sun Beetle"); }, role: "Daytime roamer monster", color: "#ffd01f" },
  "lick-soldier": { label: "Lickquidator", role: "Roamer monster (Gotchiverse)", color: "#16a78f" },
  "lick-brute": { label: "Lickquidator Brute", role: "Guardian monster (Gotchiverse)", color: "#8345ff" },
  "lick-speedy": { label: "Dire Tire", role: "Fast roamer (Gotchiverse)", color: "#cebcf1" },
  "lick-turret": { label: "Laser Beamer", role: "Zone guardian turret (Gotchiverse)", color: "#ffb800" },
  "lick-boss": { label: "Lickquidator Boss", role: "Weekly boss (Gotchiverse)", color: "#fa34f3" },
  "great-portal": { get label() { return tr("Great Portal"); }, role: "Boss arena / landmark prop (Gotchiverse)", color: "#dfabff" },
  "golden-altar": { get label() { return tr("Golden Altar"); }, role: "Keeper station prop (Gotchiverse)", color: "#ffd01f" },
};

// Palette (docs/AAVEGOTCHI-REUSE.md §2/§5).
const C = {
  ink: 0x1e1e1e,
  white: 0xffffff,
  purple900: 0x230e4f,
  purple750: 0x2a1655,
  purple700: 0x3d0981,
  darkPurple: 0x4c1f7d,
  hotPurple: 0x7217f4,
  lavender: 0xb9a6ff,
  pink: 0xff96ff,
  hotPink: 0xfa34f3,
  magenta: 0xc82ac2,
  teal: 0x37f4f1,
  cyan: 0x81cdcf,
  darkCyan: 0x219497,
  yellow: 0xfffa65,
  gold: 0xffd01f,
  mint: 0x51ffa8,
  leaf: 0x5fbf77,
  stone: 0x8f88b8,
  brown: 0x8a5a3c,
};

type Built = { root: THREE.Group; update: (t: number) => void; height: number };

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0, ...extra });
const glow = (color: number, intensity = 1.4) =>
  mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

/** Gotchi-like ghost body: a dome on a straight skirt with a wavy hem. The origin is the hem centre. */
function ghostBody(color: number, radius = 0.42, height = 0.9, waves = 6) {
  const pts: THREE.Vector2[] = [];
  const skirt = height - radius;
  pts.push(new THREE.Vector2(radius, 0));
  pts.push(new THREE.Vector2(radius * 1.02, skirt * 0.5));
  pts.push(new THREE.Vector2(radius, skirt));
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * radius, skirt + Math.sin(a) * radius));
  }
  pts[pts.length - 1].x = 0.0001;
  const geometry = new THREE.LatheGeometry(pts, 18);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0.001) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      pos.setY(i, Math.sin(a * waves) * 0.045);
    }
  }
  geometry.computeVertexNormals();
  const material = mat(color);
  material.side = THREE.DoubleSide;
  return mesh(geometry, material);
}

/** Big gotchi eyes with a highlight, facing +z. */
function eyes(y: number, z: number, spread = 0.13, size = 0.085, color = C.ink) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(size, 10, 8), mat(color, { roughness: 0.3 }), s * spread, y, z);
    eye.scale.set(1, 1.25, 0.55);
    const shine = mesh(new THREE.SphereGeometry(size * 0.32, 6, 5), mat(C.white, { emissive: C.white, emissiveIntensity: 0.6 }), s * spread + size * 0.3, y + size * 0.4, z + size * 0.42);
    g.add(eye, shine);
  }
  return g;
}

function cheeks(y: number, z: number, spread = 0.24) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(C.hotPink, { roughness: 0.9 }), s * spread, y, z);
    c.scale.set(1, 0.6, 0.4);
    g.add(c);
  }
  return g;
}

function hand(x: number, y: number, z: number, color: number) {
  return mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(color), x, y, z);
}

const bob = (root: THREE.Object3D, t: number, base = 0.12, amp = 0.05, speed = 2) => {
  root.position.y = base + Math.sin(t * speed) * amp;
};

function chronicler(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(ghostBody(C.lavender));
  const hood = mesh(new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), mat(C.darkPurple), 0, 0.52, -0.06);
  hood.scale.set(1.04, 1.1, 1.04);
  hood.rotation.x = -0.35;
  body.add(hood, eyes(0.5, 0.39), cheeks(0.4, 0.36));
  const book = new THREE.Group();
  book.add(mesh(new THREE.BoxGeometry(0.34, 0.24, 0.05), mat(C.gold), 0, 0, 0));
  book.add(mesh(new THREE.BoxGeometry(0.31, 0.21, 0.055), mat(0xfff6dd), 0, 0, 0.004));
  book.add(mesh(new THREE.BoxGeometry(0.018, 0.25, 0.06), mat(C.magenta), 0, 0, 0));
  book.position.set(0, 0.3, 0.46);
  book.rotation.x = -0.5;
  const quill = mesh(new THREE.ConeGeometry(0.03, 0.3, 5), mat(C.pink), 0.3, 0.42, 0.36);
  quill.rotation.z = -0.6;
  body.add(book, quill, hand(-0.2, 0.28, 0.44, C.lavender), hand(0.22, 0.32, 0.42, C.lavender));
  const sparkles: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = mesh(new THREE.OctahedronGeometry(0.035), glow(C.yellow), 0, 0.55, 0.5);
    sparkles.push(s);
    root.add(s);
  }
  root.add(body);
  return {
    root,
    height: 1.05,
    update: (t) => {
      bob(body, t, 0.1, 0.04, 1.6);
      sparkles.forEach((s, i) => {
        const a = t * 1.3 + i * 2.1;
        s.position.set(Math.cos(a) * 0.22, 0.5 + body.position.y + Math.sin(a * 1.7) * 0.08, 0.5 + Math.sin(a) * 0.05);
        s.rotation.y = t * 3;
      });
    },
  };
}

function merchant(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(ghostBody(C.cyan), eyes(0.55, 0.38), cheeks(0.45, 0.35));
  const brim = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16), mat(C.brown), 0, 0.84, 0);
  const crown = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.22, 10), mat(C.brown), 0, 0.96, 0);
  const band = mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.05, 10), mat(C.hotPink), 0, 0.88, 0);
  const pack = mesh(new THREE.BoxGeometry(0.46, 0.5, 0.26), mat(C.darkPurple), 0, 0.4, -0.42);
  const flap = mesh(new THREE.BoxGeometry(0.48, 0.14, 0.28), mat(C.magenta), 0, 0.62, -0.42);
  const pole = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), mat(C.ink), 0.3, 0.85, -0.42);
  const lantern = mesh(new THREE.IcosahedronGeometry(0.075, 0), glow(C.gold, 1.8), 0.3, 1.05, -0.42);
  const light = new THREE.PointLight(C.gold, 0.6, 1.5);
  light.position.copy(lantern.position);
  const coins = new THREE.Group();
  for (let i = 0; i < 4; i++) coins.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 10), mat(C.gold, { metalness: 0.5, roughness: 0.4 }), 0, i * 0.03, 0));
  coins.position.set(0.24, 0.24, 0.42);
  body.add(brim, crown, band, pack, flap, pole, lantern, light, coins, hand(0.24, 0.2, 0.42, C.cyan), hand(-0.24, 0.3, 0.38, C.cyan));
  root.add(body);
  return {
    root,
    height: 1.15,
    update: (t) => {
      bob(body, t, 0.08, 0.035, 2.4);
      lantern.position.x = 0.3 + Math.sin(t * 2.4) * 0.03;
      (lantern.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + Math.sin(t * 6) * 0.3;
    },
  };
}

function keeper(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.85, 8), mat(C.stone), 0, 0.42, 0);
  const cap = mesh(new THREE.CylinderGeometry(0.46, 0.4, 0.1, 8), mat(0x6f6a8f), 0, 0.9, 0);
  body.add(trunk, cap);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    body.add(mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat(0x6f6a8f), Math.cos(a) * 0.36, 1.0, Math.sin(a) * 0.36));
  }
  const plate = mesh(new THREE.BoxGeometry(0.26, 0.3, 0.04), mat(C.purple700), 0, 0.42, 0.43);
  const hole = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8), glow(C.teal, 2), 0, 0.47, 0.45);
  hole.rotation.x = Math.PI / 2;
  const slot = mesh(new THREE.BoxGeometry(0.035, 0.1, 0.05), glow(C.teal, 2), 0, 0.39, 0.45);
  body.add(plate, hole, slot, eyes(0.7, 0.41, 0.14, 0.07, C.teal));
  const key = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 12), mat(C.gold, { metalness: 0.6, roughness: 0.35 }));
  const shaft = mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), mat(C.gold, { metalness: 0.6, roughness: 0.35 }), 0, -0.22, 0);
  const bit = mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), mat(C.gold, { metalness: 0.6, roughness: 0.35 }), 0.04, -0.33, 0);
  key.add(ring, shaft, bit);
  key.position.set(0.5, 0.75, 0.25);
  root.add(body, key);
  return {
    root,
    height: 1.1,
    update: (t) => {
      key.rotation.y = t * 1.5;
      key.position.y = 0.75 + Math.sin(t * 2) * 0.06;
      key.position.x = 0.5;
      (hole.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 + Math.sin(t * 3) * 0.5;
    },
  };
}

function pilgrim(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(ghostBody(C.pink), eyes(0.55, 0.38), cheeks(0.45, 0.35));
  const hat = mesh(new THREE.ConeGeometry(0.5, 0.32, 12), mat(0xe8c872), 0, 0.98, 0);
  const hatBand = mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.05, 12), mat(C.hotPurple), 0, 0.88, 0);
  const staff = mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.1, 6), mat(C.brown), 0.42, 0.45, 0.2);
  const gem = mesh(new THREE.OctahedronGeometry(0.08), glow(C.teal, 1.6), 0.42, 1.05, 0.2);
  const scarf = mesh(new THREE.TorusGeometry(0.36, 0.05, 6, 16), mat(C.hotPurple), 0, 0.5, 0);
  scarf.rotation.x = Math.PI / 2;
  body.add(hat, hatBand, scarf, staff, gem, hand(0.4, 0.42, 0.28, C.pink));
  root.add(body);
  return {
    root,
    height: 1.2,
    update: (t) => {
      bob(body, t, 0.1, 0.04, 2);
      body.rotation.z = Math.sin(t * 2) * 0.04;
      gem.rotation.y = t * 2;
    },
  };
}

function wisp(): Built {
  const root = new THREE.Group(), core = new THREE.Group();
  const orb = mesh(new THREE.IcosahedronGeometry(0.28, 1), glow(C.mint, 0.8));
  const halo = mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshBasicMaterial({ color: C.mint, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }));
  core.add(orb, halo, eyes(0.04, 0.24, 0.1, 0.06));
  const tail: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const s = mesh(new THREE.IcosahedronGeometry(0.12 - i * 0.02, 0), glow(i % 2 ? C.teal : C.mint, 1.4));
    tail.push(s);
    root.add(s);
  }
  root.add(core);
  return {
    root,
    height: 1.0,
    update: (t) => {
      core.position.set(Math.sin(t * 1.2) * 0.08, 0.55 + Math.sin(t * 2.6) * 0.08, 0);
      halo.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
      tail.forEach((s, i) => {
        const lag = t - (i + 1) * 0.18;
        s.position.set(Math.sin(lag * 1.2) * 0.08 - (i + 1) * 0.1, 0.55 + Math.sin(lag * 2.6) * 0.08 - (i + 1) * 0.06, -(i + 1) * 0.06);
      });
    },
  };
}

function glitchMoth(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  const thorax = mesh(new THREE.CapsuleGeometry(0.13, 0.32, 4, 8), mat(C.purple750));
  thorax.rotation.x = Math.PI / 2.4;
  const head = mesh(new THREE.SphereGeometry(0.14, 10, 8), mat(C.purple750), 0, 0.12, 0.24);
  body.add(thorax, head, eyes(0.16, 0.34, 0.07, 0.055, C.teal));
  for (const s of [-1, 1]) {
    const ant = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4), mat(C.ink), s * 0.06, 0.3, 0.28);
    ant.rotation.z = -s * 0.4;
    const tip = mesh(new THREE.OctahedronGeometry(0.025), glow(C.teal, 2), s * 0.11, 0.4, 0.28);
    body.add(ant, tip);
  }
  const wings: THREE.Group[] = [];
  const wingShape = (w: number, h: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w * 0.35, h * 0.5);
    shape.lineTo(w, h * 0.38);
    shape.lineTo(w * 0.85, -h * 0.1);
    shape.lineTo(w * 0.4, -h * 0.4);
    shape.lineTo(0, 0);
    return new THREE.ShapeGeometry(shape);
  };
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const upper = mesh(wingShape(0.6, 0.5), mat(C.hotPink, { side: THREE.DoubleSide, emissive: C.magenta, emissiveIntensity: 0.4 }));
    const lower = mesh(wingShape(0.38, 0.32), mat(C.hotPurple, { side: THREE.DoubleSide }), 0, -0.05, -0.12);
    lower.rotation.z = -0.5;
    const spot = mesh(new THREE.CircleGeometry(0.06, 6), glow(C.teal, 1.6), 0.38, 0.12, 0.002);
    pivot.add(upper, lower, spot);
    pivot.scale.x = s;
    pivot.rotation.x = -Math.PI / 2 + 0.75;
    wings.push(pivot);
    body.add(pivot);
  }
  root.add(body);
  return {
    root,
    height: 0.9,
    update: (t) => {
      bob(body, t, 0.55, 0.07, 3);
      const flap = Math.sin(t * 14) * 0.6;
      wings[0].rotation.z = flap;
      wings[1].rotation.z = -flap;
      // Occasional "glitch": a brief sideways jitter.
      body.position.x = Math.sin(t * 0.9) > 0.97 ? Math.sin(t * 60) * 0.03 : 0;
    },
  };
}

function runeWarden(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  const stone = mesh(new THREE.OctahedronGeometry(0.42, 0), mat(C.purple700));
  stone.scale.set(0.8, 1.35, 0.8);
  const eyeWhite = mesh(new THREE.SphereGeometry(0.13, 12, 10), mat(C.white, { roughness: 0.3 }), 0, 0.08, 0.27);
  eyeWhite.scale.set(1.2, 0.85, 0.5);
  const pupil = mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(C.teal, 2), 0, 0.08, 0.33);
  pupil.scale.set(1, 1, 0.5);
  body.add(stone, eyeWhite, pupil);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const r = mesh(new THREE.TorusGeometry(0.55 + i * 0.12, 0.018, 4, 24), glow(i ? C.hotPink : C.teal, 1.5));
    r.rotation.x = Math.PI / 2 + (i ? 0.4 : -0.3);
    rings.push(r);
    body.add(r);
  }
  const runes: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const rune = mesh(new THREE.BoxGeometry(0.08, 0.12, 0.02), glow(C.teal, 1.8));
    runes.push(rune);
    body.add(rune);
  }
  const base = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.1, 8), mat(C.purple900), 0, 0.05, 0);
  root.add(base, body);
  return {
    root,
    height: 1.35,
    update: (t) => {
      body.position.y = 0.72 + Math.sin(t * 1.5) * 0.05;
      stone.rotation.y = Math.sin(t * 0.6) * 0.15;
      rings[0].rotation.z = t * 0.8;
      rings[1].rotation.z = -t * 0.6;
      runes.forEach((r, i) => {
        const a = t * 0.7 + (i / runes.length) * Math.PI * 2;
        r.position.set(Math.cos(a) * 0.62, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.62);
        r.rotation.y = -a;
      });
      pupil.position.x = Math.sin(t * 0.8) * 0.04;
    },
  };
}

function pocketWisp(): Built {
  const root = new THREE.Group(), bush = new THREE.Group();
  const leaves = [
    [0, 0.22, 0, 0.3],
    [-0.24, 0.16, 0.05, 0.22],
    [0.25, 0.17, 0.02, 0.23],
    [0.05, 0.38, -0.05, 0.22],
    [-0.12, 0.14, 0.2, 0.17],
  ];
  leaves.forEach(([x, y, z, r], i) => bush.add(mesh(new THREE.DodecahedronGeometry(r, 0), mat(i % 2 ? C.leaf : 0x4a9a62), x, y, z)));
  for (let i = 0; i < 3; i++) bush.add(mesh(new THREE.OctahedronGeometry(0.04), glow(C.pink, 1.2), -0.2 + i * 0.2, 0.42 - (i % 2) * 0.12, 0.2));
  const peeker = new THREE.Group();
  const face = mesh(new THREE.SphereGeometry(0.16, 12, 10), glow(0xd9fff0, 0.5));
  peeker.add(face, eyes(0.02, 0.13, 0.065, 0.045));
  root.add(bush, peeker);
  return {
    root,
    height: 0.75,
    update: (t) => {
      const peek = Math.max(0, Math.sin(t * 1.1));
      peeker.position.set(0.08, 0.22 + peek * 0.28, 0.18);
      bush.rotation.z = Math.sin(t * 5) * 0.015 * (1 - peek);
    },
  };
}

function stormGolem(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  const rock = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat(0x6a4a9e), x, y, z);
    m.rotation.set((x * 7) % 0.2, (y * 5) % 0.3, (z * 3) % 0.2);
    return m;
  };
  body.add(rock(0.8, 0.7, 0.55, 0, 0.75, 0), rock(0.6, 0.4, 0.45, 0, 1.25, 0.02));
  for (const s of [-1, 1]) {
    body.add(rock(0.24, 0.45, 0.24, s * 0.22, 0.22, 0));
    body.add(rock(0.24, 0.6, 0.26, s * 0.55, 0.72, 0.05));
    body.add(rock(0.3, 0.26, 0.3, s * 0.58, 0.36, 0.08));
  }
  const cracks: THREE.Mesh[] = [];
  [
    [0.1, 0.8, 0.28, 0.04, 0.3],
    [-0.15, 0.65, 0.28, 0.04, 0.22],
    [0, 1.25, 0.25, 0.3, 0.035],
  ].forEach(([x, y, z, w, h]) => {
    const c = mesh(new THREE.BoxGeometry(w, h, 0.02), glow(C.yellow, 2), x, y, z);
    cracks.push(c);
    body.add(c);
  });
  for (const s of [-1, 1]) body.add(mesh(new THREE.BoxGeometry(0.12, 0.07, 0.03), glow(C.yellow, 2.4), s * 0.13, 1.3, 0.25));
  const cloud = new THREE.Group();
  [
    [0, 0, 0, 0.2],
    [-0.2, -0.03, 0.05, 0.15],
    [0.21, -0.02, -0.03, 0.16],
    [0.05, 0.08, -0.1, 0.14],
  ].forEach(([x, y, z, r]) => cloud.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat(0x5a5276), x, y, z)));
  const bolts: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const b = mesh(new THREE.ConeGeometry(0.04, 0.22, 4), glow(C.yellow, 2.4), s * 0.14, -0.2, 0.05);
    b.rotation.z = Math.PI + s * 0.3;
    bolts.push(b);
    cloud.add(b);
  }
  cloud.position.set(0, 1.75, 0);
  root.add(body, cloud);
  return {
    root,
    height: 2.0,
    update: (t) => {
      body.position.y = Math.abs(Math.sin(t * 1.2)) * 0.03;
      body.rotation.y = Math.sin(t * 0.5) * 0.12;
      cloud.rotation.y = t * 0.6;
      cloud.position.y = 1.75 + Math.sin(t * 1.8) * 0.04;
      const flash = Math.sin(t * 3.3) > 0.9 ? 3 : 1.6;
      cracks.forEach((c) => ((c.material as THREE.MeshStandardMaterial).emissiveIntensity = flash));
      bolts.forEach((b) => (b.visible = flash > 2));
    },
  };
}

/** Daytime roamer: a round gold-shelled beetle with a sun disc on its back. */
function sunBeetle(): Built {
  const root = new THREE.Group(), body = new THREE.Group();
  const shell = mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.gold, { roughness: 0.45 }));
  shell.scale.set(1, 0.8, 1.2);
  const seam = mesh(new THREE.BoxGeometry(0.02, 0.02, 0.8), mat(C.brown), 0, 0.27, 0);
  const belly = mesh(new THREE.CylinderGeometry(0.33, 0.3, 0.08, 10), mat(C.brown), 0, -0.02, 0);
  belly.scale.z = 1.2;
  const head = mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(C.purple750), 0, 0.06, 0.4);
  const sun = mesh(new THREE.CircleGeometry(0.11, 12), glow(C.yellow, 1.8), 0, 0.29, -0.05);
  sun.rotation.x = -Math.PI / 2;
  body.add(shell, seam, belly, head, sun, eyes(0.1, 0.53, 0.06, 0.045, C.white));
  const legs: THREE.Mesh[] = [];
  for (const s of [-1, 1])
    for (const z of [-0.2, 0, 0.2]) {
      const leg = mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.22, 4), mat(C.ink), s * 0.3, -0.06, z);
      leg.rotation.z = s * 0.9;
      legs.push(leg);
      body.add(leg);
    }
  const rays: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ray = mesh(new THREE.ConeGeometry(0.025, 0.09, 4), glow(C.gold, 1.2), Math.cos(a) * 0.16, 0.29, -0.05 + Math.sin(a) * 0.16);
    ray.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2);
    rays.push(ray);
    body.add(ray);
  }
  root.add(body);
  return {
    root,
    height: 0.75,
    update: (t) => {
      bob(body, t, 0.16, 0.025, 6);
      legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 10 + i * 1.7) * 0.4));
      sun.rotation.z = t * 0.8;
      rays.forEach((r) => ((r.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.sin(t * 3) * 0.4));
    },
  };
}

const BUILDERS: Record<Exclude<ActorModel, UpstreamModel>, () => Built> = {
  chronicler,
  merchant,
  keeper,
  pilgrim,
  wisp,
  "glitch-moth": glitchMoth,
  "rune-warden": runeWarden,
  "pocket-wisp": pocketWisp,
  "storm-golem": stormGolem,
  "sun-beetle": sunBeetle,
};

const upstreamCache = new Map<string, Promise<THREE.Group>>();
async function loadUpstream(model: UpstreamModel): Promise<Built> {
  const spec = UPSTREAM[model];
  let source = upstreamCache.get(spec.file);
  if (!source) {
    source = import("three/addons/loaders/FBXLoader.js").then(({ FBXLoader }) =>
      new FBXLoader().loadAsync(`${upstreamBase}${spec.file}.fbx`),
    );
    source.catch(() => upstreamCache.delete(spec.file));
    upstreamCache.set(spec.file, source);
  }
  const object = (await source).clone(true);
  // Unify lighting with the original models: flat-shaded standard materials in the upstream colours.
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material) => {
      const old = m as THREE.MeshPhongMaterial;
      let color = spec.recolor?.[old.name] ?? (old.color ? old.color.getHex() : 0xcccccc);
      // The portal surface relies on a texture we don't load; show it as a glowing portal instead.
      if (old.name === "port_pink_on") return mat(0xfa34f3, { emissive: 0xc82ac2, emissiveIntensity: 1.2, name: old.name, side: THREE.DoubleSide });
      // Near-black upstream materials disappear on the dark map; lift them into the purple shell range.
      const c = new THREE.Color(color);
      if (Math.max(c.r, c.g, c.b) < 0.12) color = 0x2a2440;
      if (/glass/i.test(old.name))
        return mat(color, { transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false, name: old.name });
      const glowing = /visor|brain|crystal|accent|bolts/i.test(old.name);
      return mat(color, glowing ? { emissive: color, emissiveIntensity: 0.35, name: old.name } : { name: old.name });
    };
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
  });
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = spec.height / Math.max(size.y, 1e-6);
  object.scale.multiplyScalar(scale);
  const fitted = new THREE.Box3().setFromObject(object);
  const centre = fitted.getCenter(new THREE.Vector3());
  object.position.sub(new THREE.Vector3(centre.x, fitted.min.y, centre.z));
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(object);
  root.add(body);
  const prop = model === "great-portal" || model === "golden-altar";
  return {
    root,
    height: spec.height,
    update: (t) => {
      if (prop) return;
      body.position.y = Math.abs(Math.sin(t * (spec.spin ? 6 : 2.2))) * 0.04;
      body.rotation.y = Math.sin(t * 0.8) * (spec.spin ? 0.5 : 0.18);
    },
  };
}

/** Builds an original model at its idle pose (t = 0.6 s). The caller owns disposal (see disposeActorModel). */
export function buildActorModel(model: ActorModel): Built {
  const built = isUpstreamModel(model) ? BUILDERS[UPSTREAM[model].fallback as Exclude<ActorModel, UpstreamModel>]() : BUILDERS[model]();
  built.update(0.6);
  return built;
}

/** Like buildActorModel, but resolves official upstream models; falls back to the original stand-in on failure. */
export async function loadActorModel(model: ActorModel): Promise<Built> {
  if (!isUpstreamModel(model)) return buildActorModel(model);
  try {
    const built = await loadUpstream(model);
    built.update(0.6);
    return built;
  } catch {
    return buildActorModel(model);
  }
}

export function disposeActorModel(object: THREE.Object3D) {
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose();
  });
}

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x817498, 2.2));
  const key = new THREE.DirectionalLight(0xfff6ed, 2.6);
  key.position.set(2, 4, 4);
  const rim = new THREE.DirectionalLight(0xd5c2ff, 1.4);
  rim.position.set(-3, 2, -3);
  scene.add(key, rim);
}

function frame(camera: THREE.PerspectiveCamera, height: number, yaw = 0.45) {
  const d = height * 2.8;
  camera.position.set(Math.sin(yaw) * d, height * 0.8, Math.cos(yaw) * d);
  camera.lookAt(0, height * 0.5, 0);
}

/** A plain SVG badge, used when WebGL is unavailable or the model key is unknown. */
export function actorFallbackSprite(model: string) {
  const color = isActorModel(model) ? ACTOR_MODEL_INFO[model].color : "#b9a6ff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M6 28V14a10 10 0 0 1 20 0v14l-3.3-2.5L19.3 28 16 25.5 12.7 28 9.3 25.5z" fill="${color}" stroke="#230e4f" stroke-width="2"/><ellipse cx="12" cy="15" rx="2.2" ry="3" fill="#1e1e1e"/><ellipse cx="20" cy="15" rx="2.2" ry="3" fill="#1e1e1e"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
const spriteCache = new Map<string, Promise<string>>();

/**
 * A map-marker image for a model: rendered once into a transparent PNG with a single shared offscreen renderer,
 * then cached per (model, size). Falls back to an SVG badge without WebGL.
 */
export function actorSprite(model: string, size = 96): Promise<string> {
  const key = `${model}:${size}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const job = Promise.resolve().then(async () => {
    if (!isActorModel(model)) return actorFallbackSprite(model);
    const built = await loadActorModel(model);
    try {
      if (!shared) {
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        lights(scene);
        shared = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.01, 50) };
      }
      const { renderer, scene, camera } = shared;
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      scene.add(built.root);
      frame(camera, built.height);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/png");
      scene.remove(built.root);
      disposeActorModel(built.root);
      return url;
    } catch {
      return actorFallbackSprite(model);
    }
  });
  spriteCache.set(key, job);
  return job;
}

/**
 * An animated, rotatable view for the encounter sheet. One canvas, an idle animation that pauses when the tab is
 * hidden or reduced motion is requested, and full disposal of the WebGL context on close.
 */
export function createActorScene(host: HTMLElement, model: string, options: { label?: string } = {}) {
  if (!isActorModel(model)) {
    const img = document.createElement("img");
    img.src = actorFallbackSprite(model);
    img.alt = options.label || "Character";
    host.append(img);
    return { dispose: () => img.remove() };
  }
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.label || ACTOR_MODEL_INFO[model].label);
  host.append(canvas);
  const scene = new THREE.Scene();
  lights(scene);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  let built = buildActorModel(model);
  scene.add(built.root);
  if (isUpstreamModel(model))
    void loadActorModel(model).then((loaded) => {
      if (disposed) return disposeActorModel(loaded.root);
      scene.remove(built.root);
      disposeActorModel(built.root);
      built = loaded;
      scene.add(built.root);
      draw();
    });
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let yaw = 0.45, dragging = false, lastX = 0, raf = 0, disposed = false;
  const start = performance.now();
  const draw = () => {
    frame(camera, built.height, yaw);
    renderer.render(scene, camera);
  };
  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  };
  const loop = () => {
    if (disposed) return;
    if (!document.hidden) {
      built.update((performance.now() - start) / 1000);
      draw();
    }
    raf = requestAnimationFrame(loop);
  };
  const down = (e: PointerEvent) => ((dragging = true), (lastX = e.clientX), canvas.setPointerCapture(e.pointerId));
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
    if (reduced) draw();
  };
  const up = () => (dragging = false);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  if (!reduced) raf = requestAnimationFrame(loop);
  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.remove(built.root);
      disposeActorModel(built.root);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
