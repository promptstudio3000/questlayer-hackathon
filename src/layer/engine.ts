// Layer renderer and local simulation (docs/LAYER.md): chunked voxel world in
// three.js, a third-person blocky explorer with low-gravity physics, voxel
// building on the explorer's own plot, peers, plot borders and beacons.
// The server stays authoritative for plots, edits and beacon activations.
import * as THREE from "three";
import { chunkVoxels, meshChunk, vIndex, type Bucket } from "./mesher";
import { createAvatar, disposeSprite, nameTag, type Avatar } from "./avatar";
import {
  BEACON_REACH,
  BLOCK,
  CHUNK,
  HEIGHT,
  PLOT_DEPTH,
  SETTLE_Y,
  beaconsNear,
  biomeAt,
  column,
  columnBlock,
  inPlot,
  isSolid,
  outfitById,
  type Beacon,
  type Biome,
  type Outfit,
} from "./world";

export type LayerPlot = {
  id: string;
  ownerName: string;
  x0: number;
  z0: number;
  size: number;
  revision: number;
  blocks?: number;
};
export type Peer = { id: string; name: string; outfit: string; x: number; y: number; z: number; yaw: number };
export type BlockEdit = { x: number; y: number; z: number; block: number; previous: number };
export type EngineState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  biome: Biome;
  plot: { id: string; ownerName: string; mine: boolean } | null;
  beacon: { id: string; distance: number; bearing: number; active: boolean } | null;
  ready: boolean;
  fps: number;
};
export type EngineOptions = {
  seed: number;
  spawn: { x: number; y: number; z: number };
  home: LayerPlot;
  outfit: Outfit;
  aura?: string;
  phone: boolean;
  reducedMotion: boolean;
  onEdit: (edit: BlockEdit) => void;
  onNotice: (text: "own-plot" | "too-far" | "occupied" | "depth") => void;
};

const GRAVITY = 17,
  JUMP = 7.6,
  WALK = 4.6,
  HALF = 0.3,
  TALL = 1.8,
  REACH = 9,
  MIN_Y = SETTLE_Y - PLOT_DEPTH + 1;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function createLayerEngine(host: HTMLElement, options: EngineOptions) {
  const { seed, phone } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: !phone, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, phone ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "layer-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "3D voxel world");
  host.append(canvas);

  const scene = new THREE.Scene();
  const radius = phone ? 3 : 4;
  const fogFar = radius * CHUNK - 8;
  const camera = new THREE.PerspectiveCamera(phone ? 68 : 60, 1, 0.1, 900);

  // ------------------------------------------------------------ space sky
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const daylight = Math.max(0, Math.min(1, Math.min(hour - 6, 21 - hour) / 2));
  const sky = new THREE.Color().lerpColors(new THREE.Color(0x0a0820), new THREE.Color(0x2c2470), daylight);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky.clone().lerp(new THREE.Color(0x3a2f7a), 0.4), fogFar * 0.45, fogFar);
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  {
    const stars = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) {
      const u = Math.random() * 2 - 1,
        a = Math.random() * Math.PI * 2,
        r = Math.sqrt(1 - u * u);
      stars.set([Math.cos(a) * r * 600, Math.abs(u) * 600 - 40, Math.sin(a) * r * 600], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    skyGroup.add(
      new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })),
    );
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(70, 32, 20),
      new THREE.MeshLambertMaterial({ color: 0xff8a5c, emissive: 0x3a1030, fog: false }),
    );
    planet.position.set(-260, 170, -420);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(95, 140, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd8a8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false }),
    );
    ring.position.copy(planet.position);
    ring.rotation.set(1.2, 0.3, 0.2);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(16, 20, 12),
      new THREE.MeshLambertMaterial({ color: 0xbfd6ff, emissive: 0x1a2440, fog: false }),
    );
    moon.position.set(300, 210, -250);
    skyGroup.add(planet, ring, moon);
  }
  scene.add(new THREE.HemisphereLight(0xc9b8ff, 0x2a2040, 1.6 + daylight * 0.8));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.2 + daylight * 1.4);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);
  const materials = {
    opaque: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    clear: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false }),
  };

  // ------------------------------------------------------------- chunks
  type Chunk = { cx: number; cz: number; vox: Uint8Array; group: THREE.Group | null; dirty: boolean };
  const chunks = new Map<string, Chunk>();
  const plots = new Map<string, { plot: LayerPlot; blocks: Map<string, number>; border: THREE.Object3D }>();
  const ckey = (cx: number, cz: number) => `${cx},${cz}`;
  const naturalAt = (x: number, y: number, z: number) => columnBlock(column(seed, x, z), y);
  function overrideAt(x: number, y: number, z: number) {
    for (const p of plots.values())
      if (inPlot(p.plot, x, z)) return p.blocks.get(key(x, y, z));
    return undefined;
  }
  function blockAt(x: number, y: number, z: number) {
    if (y < 0) return BLOCK.stone;
    if (y >= HEIGHT) return BLOCK.air;
    const cx = Math.floor(x / CHUNK),
      cz = Math.floor(z / CHUNK);
    const c = chunks.get(ckey(cx, cz));
    if (c) return c.vox[vIndex(x - cx * CHUNK, y, z - cz * CHUNK)];
    return overrideAt(x, y, z) ?? naturalAt(x, y, z);
  }
  /** Writes a voxel into every loaded chunk whose padded copy holds it. */
  function setVoxel(x: number, y: number, z: number, b: number) {
    for (let ox = -1; ox <= 1; ox++)
      for (let oz = -1; oz <= 1; oz++) {
        const cx = Math.floor(x / CHUNK) + ox,
          cz = Math.floor(z / CHUNK) + oz;
        const c = chunks.get(ckey(cx, cz));
        if (!c) continue;
        const lx = x - cx * CHUNK,
          lz = z - cz * CHUNK;
        if (lx < -1 || lx > CHUNK || lz < -1 || lz > CHUNK) continue;
        c.vox[vIndex(lx, y, lz)] = b;
        c.dirty = true;
      }
  }
  function toGeometry(b: Bucket) {
    if (!b.indices.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.colors, 3));
    g.setIndex(b.indices);
    g.computeBoundingSphere();
    return g;
  }
  function remesh(c: Chunk) {
    if (c.group) {
      scene.remove(c.group);
      c.group.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    }
    const mesh = meshChunk(c.vox, c.cx, c.cz);
    const group = new THREE.Group();
    group.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
    for (const name of ["opaque", "glow", "clear"] as const) {
      const g = toGeometry(mesh[name]);
      if (!g) continue;
      const m = new THREE.Mesh(g, materials[name]);
      if (name === "clear") m.renderOrder = 1;
      group.add(m);
    }
    scene.add(group);
    c.group = group;
    c.dirty = false;
  }
  function loadChunk(cx: number, cz: number) {
    const vox = chunkVoxels(seed, cx, cz);
    const c: Chunk = { cx, cz, vox, group: null, dirty: true };
    chunks.set(ckey(cx, cz), c);
    const x0 = cx * CHUNK - 1,
      z0 = cz * CHUNK - 1;
    for (const p of plots.values()) {
      const r = p.plot;
      if (r.x0 > x0 + CHUNK + 2 || r.x0 + r.size < x0 || r.z0 > z0 + CHUNK + 2 || r.z0 + r.size < z0) continue;
      for (const [k, b] of p.blocks) {
        const [x, y, z] = k.split(",").map(Number);
        const lx = x - cx * CHUNK,
          lz = z - cz * CHUNK;
        if (lx >= -1 && lx <= CHUNK && lz >= -1 && lz <= CHUNK) vox[vIndex(lx, y, lz)] = b;
      }
    }
    remesh(c);
  }
  function unloadChunk(c: Chunk) {
    if (c.group) {
      scene.remove(c.group);
      c.group.children.forEach((m) => (m as THREE.Mesh).geometry.dispose());
    }
    chunks.delete(ckey(c.cx, c.cz));
  }

  // -------------------------------------------------------------- plots
  function plotBorder(plot: LayerPlot, mine: boolean) {
    const g = new THREE.Group();
    const y = SETTLE_Y + 1.04;
    const pts = [
      [plot.x0, plot.z0],
      [plot.x0 + plot.size, plot.z0],
      [plot.x0 + plot.size, plot.z0 + plot.size],
      [plot.x0, plot.z0 + plot.size],
    ].map(([x, z]) => new THREE.Vector3(x, y, z));
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: mine ? 0xffd36e : 0xb9a8ff, transparent: true, opacity: 0.9 }),
    );
    g.add(line);
    const tag = nameTag(mine ? "★ " + plot.ownerName : plot.ownerName, mine ? "#ffd36e" : "#e8e2ff");
    tag.position.set(plot.x0 + 1, SETTLE_Y + 3.2, plot.z0 + 1);
    g.add(tag);
    scene.add(g);
    return g;
  }
  function setPlot(plot: LayerPlot, list: [number, number, number, number][]) {
    const next = new Map(list.map(([x, y, z, b]) => [key(x, y, z), b]));
    const prev = plots.get(plot.id);
    const old = prev?.blocks ?? new Map<string, number>();
    if (prev) {
      scene.remove(prev.border);
      prev.border.traverse((n) => {
        if (n instanceof THREE.Sprite) disposeSprite(n);
        else if (n instanceof THREE.Line) n.geometry.dispose();
      });
    }
    plots.set(plot.id, { plot, blocks: next, border: plotBorder(plot, plot.id === options.home.id) });
    for (const [k, b] of next) if (old.get(k) !== b) setVoxel(...(k.split(",").map(Number) as [number, number, number]), b);
    for (const k of old.keys())
      if (!next.has(k)) {
        const [x, y, z] = k.split(",").map(Number);
        setVoxel(x, y, z, naturalAt(x, y, z));
      }
  }
  const knownPlots = () => [...plots.values()].map((p) => ({ id: p.plot.id, revision: p.plot.revision }));

  // ------------------------------------------------------------- player
  const pos = new THREE.Vector3(options.spawn.x, options.spawn.y, options.spawn.z);
  const vel = new THREE.Vector3();
  let onGround = false,
    lastGround = false,
    camYaw = Math.PI * 0.25,
    camPitch = 0.45,
    camDist = phone ? 7 : 6.5,
    faceYaw = 0;
  const me = createAvatar(options.outfit, options.aura);
  scene.add(me.group);
  const move = { x: 0, y: 0 };
  const keys = new Set<string>();
  let wantJump = false;
  function collides(px: number, py: number, pz: number) {
    for (let x = Math.floor(px - HALF); x <= Math.floor(px + HALF); x++)
      for (let y = Math.floor(py); y <= Math.floor(py + TALL - 0.01); y++)
        for (let z = Math.floor(pz - HALF); z <= Math.floor(pz + HALF); z++)
          if (isSolid(blockAt(x, y, z))) return true;
    return false;
  }
  function step(dt: number) {
    let mx = move.x,
      my = move.y;
    if (keys.has("w") || keys.has("arrowup")) my += 1;
    if (keys.has("s") || keys.has("arrowdown")) my -= 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (keys.has("q")) camYaw += dt * 2;
    if (keys.has("e")) camYaw -= dt * 2;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const s = Math.sin(camYaw),
      c = Math.cos(camYaw);
    const dx = -s * my + c * mx,
      dz = -c * my - s * mx;
    const swimming = blockAt(Math.floor(pos.x), Math.floor(pos.y + 0.4), Math.floor(pos.z)) === BLOCK.water;
    const speed = WALK * (swimming ? 0.55 : 1);
    vel.x = dx * speed;
    vel.z = dz * speed;
    if (wantJump && (onGround || swimming)) vel.y = swimming ? 4.2 : JUMP;
    if (!keys.has(" ")) wantJump = false;
    vel.y -= GRAVITY * (swimming ? 0.35 : 1) * dt;
    if (swimming) vel.y = Math.max(vel.y, -2.5);
    vel.y = Math.max(vel.y, -30);
    if (Math.hypot(dx, dz) > 0.05) faceYaw = Math.atan2(-dx, -dz);
    // Axis-separated movement with a one-block auto-step for joystick play.
    const parts = Math.ceil(Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt / 0.4) || 1;
    const h = dt / parts;
    onGround = false;
    for (let i = 0; i < parts; i++) {
      for (const axis of ["x", "z"] as const) {
        const d = vel[axis] * h;
        if (!d) continue;
        pos[axis] += d;
        if (collides(pos.x, pos.y, pos.z)) {
          if (lastGround && vel.y <= 0.5 && !collides(pos.x, pos.y + 1.01, pos.z)) pos.y += 1.01;
          else pos[axis] -= d;
        }
      }
      pos.y += vel.y * h;
      if (collides(pos.x, pos.y, pos.z)) {
        if (vel.y < 0) {
          pos.y = Math.floor(pos.y) + 1;
          onGround = true;
        } else pos.y = Math.floor(pos.y + TALL) - TALL - 0.001;
        vel.y = 0;
      }
    }
    lastGround = onGround;
    if (pos.y < -8) teleport(options.spawn);
    me.group.position.copy(pos);
    const diff = Math.atan2(Math.sin(faceYaw - me.group.rotation.y), Math.cos(faceYaw - me.group.rotation.y));
    me.group.rotation.y += diff * Math.min(1, dt * 12);
    return Math.hypot(dx, dz) > 0.05;
  }
  function teleport(p: { x: number; y: number; z: number }) {
    pos.set(p.x, p.y, p.z);
    vel.set(0, 0, 0);
  }

  // ------------------------------------------------------------- camera
  const target = new THREE.Vector3();
  function placeCamera() {
    target.set(pos.x, pos.y + 1.5, pos.z);
    const off = new THREE.Vector3(
      Math.sin(camYaw) * Math.cos(camPitch),
      Math.sin(camPitch),
      Math.cos(camYaw) * Math.cos(camPitch),
    );
    let d = camDist;
    for (let t = 0.6; t <= camDist; t += 0.25) {
      const p = target.clone().addScaledVector(off, t);
      if (isSolid(blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))) {
        d = Math.max(0.6, t - 0.35);
        break;
      }
    }
    camera.position.copy(target).addScaledVector(off, d);
    camera.lookAt(target);
    skyGroup.position.copy(camera.position);
  }

  // -------------------------------------------------------------- build
  let building = false,
    breaking = false,
    selected: number = BLOCK.plank;
  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
    new THREE.LineBasicMaterial({ color: 0x7dffb2 }),
  );
  highlight.visible = false;
  scene.add(highlight);
  const ray = new THREE.Raycaster();
  function pick(clientX: number, clientY: number) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const o = ray.ray.origin,
      d = ray.ray.direction;
    // Voxel DDA.
    let x = Math.floor(o.x),
      y = Math.floor(o.y),
      z = Math.floor(o.z);
    const sx = Math.sign(d.x),
      sy = Math.sign(d.y),
      sz = Math.sign(d.z);
    const tdx = Math.abs(1 / d.x),
      tdy = Math.abs(1 / d.y),
      tdz = Math.abs(1 / d.z);
    let tx = (sx > 0 ? x + 1 - o.x : o.x - x) * tdx,
      ty = (sy > 0 ? y + 1 - o.y : o.y - y) * tdy,
      tz = (sz > 0 ? z + 1 - o.z : o.z - z) * tdz;
    let n: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 160; i++) {
      if (tx < ty && tx < tz) {
        if (tx > 30) break;
        x += sx;
        tx += tdx;
        n = [-sx, 0, 0];
      } else if (ty < tz) {
        if (ty > 30) break;
        y += sy;
        ty += tdy;
        n = [0, -sy, 0];
      } else {
        if (tz > 30) break;
        z += sz;
        tz += tdz;
        n = [0, 0, -sz];
      }
      if (isSolid(blockAt(x, y, z))) return { x, y, z, n };
    }
    return null;
  }
  function buildTarget(clientX: number, clientY: number) {
    const hit = pick(clientX, clientY);
    if (!hit) return null;
    const t = breaking ? { x: hit.x, y: hit.y, z: hit.z } : { x: hit.x + hit.n[0], y: hit.y + hit.n[1], z: hit.z + hit.n[2] };
    let problem: Parameters<EngineOptions["onNotice"]>[0] | null = null;
    if (!inPlot(options.home, t.x, t.z)) problem = "own-plot";
    else if (t.y < MIN_Y || t.y >= HEIGHT) problem = "depth";
    else if (Math.hypot(t.x + 0.5 - pos.x, t.y + 0.5 - pos.y - 0.9, t.z + 0.5 - pos.z) > REACH) problem = "too-far";
    else if (
      !breaking &&
      t.x + 1 > pos.x - HALF && t.x < pos.x + HALF && t.z + 1 > pos.z - HALF && t.z < pos.z + HALF && t.y + 1 > pos.y && t.y < pos.y + TALL
    )
      problem = "occupied";
    return { ...t, problem };
  }
  function showHighlight(clientX: number, clientY: number) {
    const t = building ? buildTarget(clientX, clientY) : null;
    highlight.visible = !!t;
    if (!t) return;
    highlight.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    (highlight.material as THREE.LineBasicMaterial).color.set(t.problem ? 0xff6b8a : breaking ? 0xffb36b : 0x7dffb2);
  }
  function act(clientX: number, clientY: number) {
    const t = buildTarget(clientX, clientY);
    if (!t) return;
    showHighlight(clientX, clientY);
    if (t.problem) return options.onNotice(t.problem);
    const previous = blockAt(t.x, t.y, t.z);
    const block = breaking ? BLOCK.air : selected;
    if (previous === block) return;
    applyLocal(t.x, t.y, t.z, block);
    options.onEdit({ x: t.x, y: t.y, z: t.z, block, previous });
  }
  function applyLocal(x: number, y: number, z: number, b: number) {
    const home = plots.get(options.home.id);
    if (home) {
      if (b === naturalAt(x, y, z)) home.blocks.delete(key(x, y, z));
      else home.blocks.set(key(x, y, z), b);
    }
    setVoxel(x, y, z, b);
  }

  // -------------------------------------------------------------- input
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let pinch = 0;
  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const moveP = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") showHighlight(e.clientX, e.clientY);
      return;
    }
    if (pointers.size === 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) camDist = Math.max(2.5, Math.min(14, camDist * (pinch / d)));
      pinch = d;
      return;
    }
    camYaw -= (e.clientX - p.x) * 0.006;
    camPitch = Math.max(-0.15, Math.min(1.35, camPitch + (e.clientY - p.y) * 0.005));
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!p) return;
    const tap = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10 && performance.now() - p.t < 400;
    if (tap && building && e.button !== 2) act(e.clientX, e.clientY);
  };
  const context = (e: MouseEvent) => {
    e.preventDefault();
    if (!building) return;
    const before = breaking;
    breaking = true;
    act(e.clientX, e.clientY);
    breaking = before;
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    camDist = Math.max(2.5, Math.min(14, camDist * (e.deltaY > 0 ? 1.1 : 0.9)));
  };
  const typing = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey;
  const keydown = (e: KeyboardEvent) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      if (k === " " || k.startsWith("arrow")) e.preventDefault();
      keys.add(k);
      if (k === " ") wantJump = true;
    }
  };
  const keyup = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  const blur = () => keys.clear();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", moveP);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", context);
  canvas.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);

  // -------------------------------------------------------------- peers
  const peers = new Map<string, { avatar: Avatar; tag: THREE.Sprite; target: Peer; outfit: string }>();
  function setPeers(list: Peer[]) {
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      let peer = peers.get(p.id);
      if (!peer) {
        const avatar = createAvatar(outfitById(p.outfit));
        const tag = nameTag(p.name);
        tag.position.y = 2.75;
        avatar.group.add(tag);
        avatar.group.position.set(p.x, p.y, p.z);
        scene.add(avatar.group);
        peer = { avatar, tag, target: p, outfit: p.outfit };
        peers.set(p.id, peer);
      }
      if (peer.outfit !== p.outfit) peer.avatar.setOutfit(outfitById(p.outfit));
      peer.outfit = p.outfit;
      peer.target = p;
    }
    for (const [id, peer] of peers)
      if (!seen.has(id)) {
        scene.remove(peer.avatar.group);
        peer.avatar.dispose();
        disposeSprite(peer.tag);
        peers.delete(id);
      }
  }

  // ------------------------------------------------------------ beacons
  let beacons: Beacon[] = [];
  let activeBeacons = new Set<string>();
  const beams = new THREE.Group();
  scene.add(beams);
  let beaconsAt = new THREE.Vector2(Infinity, Infinity);
  function refreshBeacons() {
    beaconsAt = new THREE.Vector2(pos.x, pos.z);
    beacons = beaconsNear(seed, pos.x, pos.z, 240);
    beams.children.forEach((b) => {
      (b as THREE.Mesh).geometry.dispose();
      ((b as THREE.Mesh).material as THREE.Material).dispose();
    });
    beams.clear();
    for (const b of beacons) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.55, 90, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: activeBeacons.has(b.id) ? 0xffd36e : 0x6ff7ff,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      beam.position.set(b.x + 0.5, b.y + 47, b.z + 0.5);
      beams.add(beam);
    }
  }
  function setActiveBeacons(ids: string[]) {
    const next = new Set(ids);
    if ([...next].some((id) => !activeBeacons.has(id)) || next.size !== activeBeacons.size) {
      activeBeacons = next;
      refreshBeacons();
    }
  }

  // --------------------------------------------------------------- loop
  let raf = 0,
    last = performance.now(),
    disposed = false,
    frames = 0,
    fpsAt = last,
    fps = 0,
    ready = false;
  const resize = () => {
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  function streamChunks(budget: number) {
    const pcx = Math.floor(pos.x / CHUNK),
      pcz = Math.floor(pos.z / CHUNK);
    for (const c of chunks.values())
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > radius + 1) unloadChunk(c);
    let built = 0;
    for (const c of chunks.values())
      if (c.dirty && built < budget + 2) {
        remesh(c);
        built++;
      }
    const wanted: [number, number, number][] = [];
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++)
        if (!chunks.has(ckey(pcx + dx, pcz + dz)) && dx * dx + dz * dz <= (radius + 0.5) ** 2)
          wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of wanted.slice(0, budget)) loadChunk(cx, cz);
    if (!wanted.length) ready = true;
    // Do not let the explorer fall through a chunk that is still missing.
    return chunks.has(ckey(pcx, pcz));
  }
  // Load the spawn area before the first frame.
  for (let i = 0; i < 9 && !chunks.has(ckey(Math.floor(pos.x / CHUNK), Math.floor(pos.z / CHUNK))); i++) streamChunks(1);
  const frame = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const hasGround = streamChunks(phone ? 1 : 2);
    const moving = hasGround ? step(dt) : false;
    me.animate(dt, moving, now / 1000);
    for (const peer of peers.values()) {
      const g = peer.avatar.group,
        t = peer.target;
      const k = Math.min(1, dt * 8);
      const was = g.position.clone();
      g.position.lerp(new THREE.Vector3(t.x, t.y, t.z), k);
      g.rotation.y += Math.atan2(Math.sin(t.yaw - g.rotation.y), Math.cos(t.yaw - g.rotation.y)) * k;
      peer.avatar.animate(dt, was.distanceTo(g.position) > 0.01, now / 1000);
    }
    if (Math.hypot(pos.x - beaconsAt.x, pos.z - beaconsAt.y) > 48) refreshBeacons();
    if (!options.reducedMotion) beams.children.forEach((b, i) => ((b as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.26 + Math.sin(now / 600 + i) * 0.08);
    placeCamera();
    renderer.render(scene, camera);
    frames++;
    if (now - fpsAt > 1000) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
      host.dataset.fps = String(fps);
      host.dataset.chunks = String(chunks.size);
      host.dataset.ready = String(ready);
    }
  };
  raf = requestAnimationFrame(frame);
  const lost = (e: Event) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", lost);

  function getState(): EngineState {
    const fx = Math.floor(pos.x),
      fz = Math.floor(pos.z);
    let plot: EngineState["plot"] = null;
    for (const p of plots.values())
      if (inPlot(p.plot, fx, fz)) plot = { id: p.plot.id, ownerName: p.plot.ownerName, mine: p.plot.id === options.home.id };
    const b = beacons[0] ? beaconsNear(seed, pos.x, pos.z, 240)[0] : null;
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      heading: camYaw,
      biome: biomeAt(seed, pos.x, pos.z),
      plot,
      beacon: b
        ? {
            id: b.id,
            distance: Math.max(0, Math.hypot(b.x + 0.5 - pos.x, b.z + 0.5 - pos.z) - BEACON_REACH + 1),
            // Screen bearing: 0 = straight ahead from the camera.
            bearing: Math.atan2(b.x + 0.5 - pos.x, b.z + 0.5 - pos.z) - (camYaw + Math.PI),
            active: activeBeacons.has(b.id),
          }
        : null,
      ready,
      fps,
    };
  }

  return {
    canvas,
    getState,
    setPlot,
    knownPlots,
    setPeers,
    setActiveBeacons,
    teleport,
    applyLocal,
    setMove: (x: number, y: number) => {
      move.x = x;
      move.y = y;
    },
    jump: () => {
      wantJump = true;
    },
    setBuild: (on: boolean) => {
      building = on;
      if (!on) highlight.visible = false;
    },
    setBreaking: (on: boolean) => {
      breaking = on;
    },
    setBlock: (b: number) => {
      selected = b;
    },
    setOutfit: (o: Outfit, aura?: string) => me.setOutfit(o, aura),
    /** Build at the screen centre (keyboard and accessibility path). */
    actAtCenter: () => {
      const r = canvas.getBoundingClientRect();
      act(r.left + r.width / 2, r.top + r.height * 0.55);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("webglcontextlost", lost);
      for (const c of [...chunks.values()]) unloadChunk(c);
      setPeers([]);
      me.dispose();
      scene.traverse((n) => {
        if (n instanceof THREE.Mesh || n instanceof THREE.Points || n instanceof THREE.Line) {
          n.geometry.dispose();
          const m = n.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
        if (n instanceof THREE.Sprite) disposeSprite(n);
      });
      Object.values(materials).forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
export type LayerEngine = ReturnType<typeof createLayerEngine>;
