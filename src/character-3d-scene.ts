import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((t) => {
    const data = t.source?.data;
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap)
      data.close();
    t.dispose();
  });
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}
export function createCharacterScene(
  host: HTMLElement,
  bytes: ArrayBuffer,
  options: {
    starter: boolean;
    above?: string;
    below?: string;
    onError: () => void;
  },
) {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(32, 1, 0.001, 1000);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "Your 3D appearance. Use left and right arrows to rotate, plus and minus to zoom, or Home to reset.",
  );
  host.append(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI * 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x817498, 2));
  const key = new THREE.DirectionalLight(0xfff6ed, 3);
  key.position.set(2, 4, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd5c2ff, 1.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);
  let disposed = false,
    loaded = false,
    height = 1;
  const render = () => {
    if (!disposed && loaded) {
      try {
        renderer.render(scene, camera);
      } catch {
        options.onError();
      }
    }
  };
  controls.addEventListener("change", render);
  const resize = () => {
    if (disposed) return;
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const reset = () => {
    camera.position.set(0, height * 0.35, height * 2.9);
    controls.target.set(0, 0, 0);
    controls.update();
    render();
  };
  const rotate = (direction: number) => {
    camera.position
      .sub(controls.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), (direction * Math.PI) / 6)
      .add(controls.target);
    controls.update();
    render();
  };
  const zoom = (direction: number) => {
    const offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(direction > 0 ? 0.8 : 1.25);
    offset.clampLength(controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    render();
  };
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      rotate(e.key === "ArrowLeft" ? -1 : 1);
    } else if (["+", "=", "-"].includes(e.key)) {
      e.preventDefault();
      zoom(e.key === "-" ? -1 : 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      reset();
    }
  };
  canvas.addEventListener("keydown", keyboard);
  const lost = (event: Event) => {
    event.preventDefault();
    if (!disposed) options.onError();
  };
  canvas.addEventListener("webglcontextlost", lost);
  const ready = (async () => {
    const gltf = await new GLTFLoader().parseAsync(bytes, "");
    if (disposed) {
      disposeObject(gltf.scene);
      return;
    }
    // This generic preview is not an Ethereum asset. Original owners keep their full model.
    if (options.starter)
      gltf.scene.traverse((node) => {
        if (/^ETH_collateral(?:_|$)/.test(node.name)) node.visible = false;
      });
    const idle = gltf.animations.find((clip) => /idle/i.test(clip.name));
    if (idle) {
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const action = mixer.clipAction(idle).play();
      mixer.setTime(0.3);
      action.paused = true;
    }
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    height = Math.max(size.y, size.x * 0.8, size.z * 0.8);
    if (!Number.isFinite(height) || height <= 0) {
      disposeObject(gltf.scene);
      throw Error("The model has invalid bounds.");
    }
    gltf.scene.position.sub(center);
    scene.add(gltf.scene);
    for (const [slot, color] of [
      ["above", options.above],
      ["below", options.below],
    ] as const) {
      if (!color || !/^#[0-9a-f]{6}$/i.test(color)) continue;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(height * 0.39, height * 0.012, 8, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = height * (slot === "above" ? 0.6 : -0.53);
      scene.add(ring);
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(height * 0.39, height * 0.04, 8, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
        }),
      );
      glow.rotation.copy(ring.rotation);
      glow.position.copy(ring.position);
      scene.add(glow);
    }
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(height * 0.43, 48),
      new THREE.MeshBasicMaterial({
        color: 0x5d447d,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -height * 0.56;
    scene.add(floor);
    controls.minDistance = height * 1.6;
    controls.maxDistance = height * 5;
    camera.near = height * 0.01;
    camera.far = height * 20;
    camera.updateProjectionMatrix();
    loaded = true;
    resize();
    reset();
  })();
  return {
    ready,
    rotate,
    zoom,
    reset,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      canvas.removeEventListener("keydown", keyboard);
      canvas.removeEventListener("webglcontextlost", lost);
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
