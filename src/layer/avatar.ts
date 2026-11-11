// Blocky space explorer (original design): helmet with visor, suit, backpack
// and an antenna lamp. Outfits are colours only (docs/LAYER.md).
import * as THREE from "three";
import type { Outfit } from "./world";

export type Avatar = {
  group: THREE.Group;
  setOutfit: (o: Outfit, aura?: string) => void;
  animate: (dt: number, moving: boolean, t: number) => void;
  dispose: () => void;
};

export function createAvatar(outfit: Outfit, aura?: string): Avatar {
  const group = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial(),
    trim = new THREE.MeshLambertMaterial(),
    visor = new THREE.MeshBasicMaterial(),
    lamp = new THREE.MeshBasicMaterial({ color: 0xffd36e });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // Limbs pivot at the hip/shoulder.
  const limb = (x: number, y: number, w: number, h: number, m: THREE.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    box(w, h, w, m, 0, -h / 2, 0, pivot);
    group.add(pivot);
    return pivot;
  };
  const legL = limb(-0.15, 0.72, 0.24, 0.72, suit),
    legR = limb(0.15, 0.72, 0.24, 0.72, suit);
  box(0.62, 0.7, 0.36, suit, 0, 1.07, 0);
  box(0.64, 0.12, 0.38, trim, 0, 0.78, 0); // belt
  box(0.42, 0.48, 0.2, trim, 0, 1.1, 0.27); // backpack
  const armL = limb(-0.42, 1.38, 0.2, 0.66, suit),
    armR = limb(0.42, 1.38, 0.2, 0.66, suit);
  box(0.58, 0.56, 0.58, trim, 0, 1.72, 0); // helmet
  box(0.44, 0.24, 0.04, visor, 0, 1.74, -0.3);
  box(0.05, 0.22, 0.05, trim, 0.2, 2.1, 0.1);
  box(0.1, 0.1, 0.1, lamp, 0.2, 2.25, 0.1);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.035, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 2.42;
  group.add(halo);
  const setOutfit = (o: Outfit, ring?: string) => {
    suit.color.set(o.suit);
    trim.color.set(o.trim);
    visor.color.set(o.visor);
    halo.visible = !!ring && /^#[0-9a-f]{6}$/i.test(ring);
    if (halo.visible) (halo.material as THREE.MeshBasicMaterial).color.set(ring!);
  };
  setOutfit(outfit, aura);
  let phase = 0;
  return {
    group,
    setOutfit,
    animate(dt, moving, t) {
      phase = moving ? phase + dt * 9 : phase * Math.max(0, 1 - dt * 10);
      const swing = Math.sin(phase) * (moving ? 0.7 : 0);
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
      halo.rotation.z = t * 0.8;
      halo.position.y = 2.42 + Math.sin(t * 2) * 0.04;
    },
    dispose() {
      group.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.geometry.dispose();
          (n.material as THREE.Material).dispose();
        }
      });
    },
  };
}

/** Name tag sprite drawn on a canvas. */
export function nameTag(text: string, accent = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(14,10,36,0.78)";
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 22);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 18), 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true }));
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}
export function disposeSprite(sprite: THREE.Sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
