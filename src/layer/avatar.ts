// Blocky space explorer (original design): helmet with visor, suit, backpack
// and an antenna lamp. Outfits are colours only (docs/LAYER.md).
import * as THREE from "three";
import { STARTER_SPRITE } from "../character-art";
import type { Outfit } from "./world";

export type Avatar = {
  group: THREE.Group;
  setOutfit: (o: Outfit, aura?: string) => void;
  /** swing: the explorer is digging, so the pickaxe arm chops. */
  animate: (dt: number, moving: boolean, t: number, swing?: boolean) => void;
  dispose: () => void;
};

export function createAvatar(outfit: Outfit, aura?: string): Avatar {
  const group = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xfffbff });
  const shade = new THREE.MeshLambertMaterial({ color: 0xded3ff });
  const trim = new THREE.MeshLambertMaterial({ color: outfit.trim });
  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent = group,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // Stepped ghost silhouette, floating hands and scalloped hem. The face uses
  // QuestLayer's existing official starter artwork with nearest-neighbour sampling.
  const ghost = new THREE.Group();
  group.add(ghost);
  box(0.94, 0.9, 0.54, body, 0, 1.04, 0, ghost);
  box(0.7, 0.27, 0.46, body, 0, 1.61, 0, ghost);
  box(0.44, 0.14, 0.36, body, 0, 1.81, 0, ghost);
  box(0.14, 0.72, 0.5, shade, 0.45, 1.04, 0.02, ghost);
  for (const x of [-0.34, 0, 0.34])
    box(0.22, 0.2, 0.45, body, x, 0.51, -0.01, ghost);
  const left = box(0.22, 0.27, 0.32, body, -0.62, 0.88, -0.04, ghost);
  const right = box(0.22, 0.27, 0.32, body, 0.62, 0.88, -0.04, ghost);
  const faceMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
  });
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 1.12),
    faceMaterial,
  );
  face.position.set(0, 1.17, -0.285);
  face.rotation.y = Math.PI;
  ghost.add(face);
  // Small solid pixel features keep the starter readable while its SVG texture
  // loads and from the low-resolution peer view.
  const eyes = new THREE.MeshBasicMaterial({ color: 0x5f2ea0 });
  const cheeks = new THREE.MeshBasicMaterial({ color: 0xf592cd });
  for (const x of [-0.22, 0.22]) {
    box(0.15, 0.22, 0.035, eyes, x, 1.32, -0.325, ghost);
    box(0.045, 0.065, 0.045, body, x + 0.03, 1.38, -0.35, ghost);
    box(0.14, 0.065, 0.035, cheeks, x * 1.5, 1.12, -0.325, ghost);
  }
  box(0.12, 0.045, 0.035, eyes, 0, 1.06, -0.325, ghost);

  let disposed = false;
  new THREE.TextureLoader().load(STARTER_SPRITE, (texture) => {
    if (disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    faceMaterial.map = texture;
    faceMaterial.needsUpdate = true;
  });
  // A small voxel pickaxe makes the active mining action readable to neighbours.
  const tool = new THREE.Group();
  box(0.08, 0.66, 0.08, trim, 0, 0, 0, tool);
  box(0.48, 0.09, 0.1, shade, -0.12, 0.28, 0, tool);
  tool.position.set(0.68, 0.93, -0.2);
  tool.rotation.z = -0.45;
  ghost.add(tool);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.035, 6, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 2.02;
  group.add(halo);
  const setOutfit = (o: Outfit, ring?: string) => {
    trim.color.set(o.trim);
    halo.visible = !!ring && /^#[0-9a-f]{6}$/i.test(ring);
    if (halo.visible)
      (halo.material as THREE.MeshBasicMaterial).color.set(ring!);
  };
  setOutfit(outfit, aura);
  return {
    group,
    setOutfit,
    animate(_dt, moving, t, swing = false) {
      ghost.position.y =
        Math.sin(t * (moving ? 7 : 2.2)) * (moving ? 0.07 : 0.035);
      left.rotation.x = Math.sin(t * 7) * (moving ? 0.3 : 0.03);
      if (swing) {
        // A quick chop about three times a second: wind up behind, strike forward.
        const chop = Math.abs(Math.sin(t * 9.5));
        right.rotation.x = -0.9 * chop;
        tool.rotation.x = -1.6 * chop + 0.5;
        tool.position.set(0.68, 0.93 + 0.18 * chop, -0.2 - 0.22 * (1 - chop));
      } else {
        right.rotation.x = -left.rotation.x;
        tool.rotation.x = 0;
        tool.position.set(0.68, 0.93, -0.2);
      }
    },
    dispose() {
      disposed = true;
      const materials = new Set<THREE.Material>();
      group.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          materials.add(node.material as THREE.Material);
        }
      });
      faceMaterial.map?.dispose();
      materials.forEach((material) => material.dispose());
    },
  };
}

/** Name tag sprite drawn on a canvas. */
export function nameTag(text: string, accent = "#ffffff", limit = 18) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(14,10,36,0.78)";
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 22);
  ctx.fill();
  ctx.fillStyle = accent;
  const label = text.slice(0,limit);
  let size = 26;
  do { ctx.font = `600 ${size}px system-ui, sans-serif`; size--; }
  while (ctx.measureText(label).width > 230 && size >= 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 128, 33, 230);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthWrite: false,
      transparent: true,
    }),
  );
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}
export function disposeSprite(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
