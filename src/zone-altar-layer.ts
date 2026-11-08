// Real GLBs in MapLibre's existing WebGL context. Event-driven: no idle loop,
// extra canvas, terrain mutation or player/zone-coordinate changes.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MercatorCoordinate,
  type Map as GameMap,
  type CustomLayerInterface,
} from "maplibre-gl";
import type { Quest, Zone } from "./types";
import { altarModelId, mapKitUrl } from "./map-kit";
import { totemHeight, zonePhase, zoneWallFeatures } from "./zone-landmarks";
import { wallRibbonGeometry } from "./zone-aura-geometry";

type Input = {
  zones: readonly Zone[];
  quests: readonly Quest[];
  now: number;
  playerTier?: number;
  visible: boolean;
  selectedQuestId?: string | null;
};
export type ZoneAltarLayer = { update(input: Input): void; destroy(): void };
const ID = "zone-altar-models";
export function attachZoneAltars(map: GameMap): ZoneAltarLayer {
  const scene = new THREE.Scene(),
    camera = new THREE.Camera(),
    loader = new GLTFLoader();
  const cache = new Map<string, Promise<THREE.Group>>();
  let renderer: THREE.WebGLRenderer | null = null,
    gone = false,
    revision = 0;
  let origin = MercatorCoordinate.fromLngLat([0, 0]),
    units = 1,
    visible = false;
  const resources = new Set<THREE.Object3D>();
  const models = new THREE.Group(),
    curtains = new THREE.Group();
  scene.add(
    models,
    curtains,
    new THREE.HemisphereLight(0xffffff, 0x75618f, 2.1),
  );
  const key = new THREE.DirectionalLight(0xfff5eb, 2.7);
  key.position.set(60, 100, 70);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcab1ff, 1.2);
  rim.position.set(-60, 60, -60);
  scene.add(rim);
  const dispose = (object: THREE.Object3D) =>
    object.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const m of Array.isArray(node.material)
        ? node.material
        : [node.material])
        m.dispose();
    });
  const clearCurtains = () => {
    for (const object of curtains.children) dispose(object);
    curtains.clear();
  };
  const curtainMaterial = (color: string, dim: boolean) => {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: dim ? 0.42 : 1 },
      },
      vertexShader: `varying vec2 vCurtain;
        void main(){vCurtain=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vCurtain;
        void main(){
          float h=vCurtain.y;
          float crest=0.86+0.14*sin(vCurtain.x*0.039+0.6);
          float fade=1.0-smoothstep(0.04,crest,h);
          float threads=pow(0.5+0.5*sin(vCurtain.x*0.11+sin(vCurtain.x*0.027)*1.8),5.0);
          float veil=(0.055+0.22*threads)*fade;
          float rim=(1.0-smoothstep(0.0,0.022,h))*0.48;
          float alpha=(veil+rim)*uOpacity;
          if(alpha<0.003)discard;
          gl_FragColor=vec4(uColor,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    material.forceSinglePass = true;
    return material;
  };
  const load = (id: string) => {
    let job = cache.get(id);
    if (!job) {
      job = loader
        .loadAsync(mapKitUrl(`models/${id}.glb`))
        .then(({ scene: source }) => {
          if (gone) {
            dispose(source);
            throw Error("Altar layer removed");
          }
          source.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.frustumCulled = false;
              for (const material of Array.isArray(node.material)
                ? node.material
                : [node.material]) {
                material.side = THREE.FrontSide;
                material.depthTest = true;
              }
            }
          });
          resources.add(source);
          return source;
        });
      cache.set(id, job);
      job.catch(() => cache.delete(id));
    }
    return job;
  };
  const layer: CustomLayerInterface = {
    id: ID,
    type: "custom",
    renderingMode: "3d",
    render(gl, input) {
      if (
        !visible ||
        map.getZoom() < 11.5 ||
        map.getProjection().type !== "mercator"
      )
        return;
      const depthRange = gl.getParameter(gl.DEPTH_RANGE) as Float32Array;
      // Initializing Three also changes GL bindings. Do it inside the custom
      // render callback, where MapLibre invalidates its state cache afterward.
      // Keep initialization in the same guarded state scope as drawing.
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
        });
        renderer.autoClear = false;
      }
      models.visible = map.getZoom() >= 13;
      const local = new THREE.Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new THREE.Vector3(units, -units, units))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix
        .fromArray(input.defaultProjectionData.mainMatrix)
        .multiply(local);
      renderer.resetState();
      // MapLibre resizes this canvas. Update only the viewport, never write
      // canvas.width/height or take ownership of its pixel ratio.
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.depthRange(depthRange[0], depthRange[1]);
      renderer.render(scene, camera);
      map.getContainer().dataset.altarDrawCalls = String(
        renderer.info.render.calls,
      );
      renderer.resetState();
      // MapLibre owns repaint scheduling. Never request a frame here.
    },
    onRemove() {
      gone = true;
      revision++;
      models.clear();
      clearCurtains();
      for (const source of resources) dispose(source);
      resources.clear();
      cache.clear();
      renderer?.dispose();
      renderer = null;
      // Never forceContextLoss: this context belongs to MapLibre.
    },
  };
  // Altars and roofless aura curtains share the existing map context. Only a
  // ground outline remains in MapLibre; there is no enclosing volume/depth cap.
  map.addLayer(layer, map.getLayer("zone-walls") ? "zone-walls" : undefined);
  return {
    update(input) {
      const run = ++revision;
      visible = input.visible;
      models.clear();
      clearCurtains();
      map.getContainer().dataset.zoneAuraWalls = "0";
      map.getContainer().dataset.altarModels = "0";
      map.getContainer().dataset.altarModelIds = "";
      map.getContainer().dataset.altarFallbacks = String(input.zones.length);
      // Native extrusion remains until each corresponding GLB is available.
      const loaded = new Set<string>();
      const fallback = () => {
        if (!gone && map.getLayer("zone-totems"))
          map.setFilter("zone-totems", [
            "!",
            ["in", ["get", "id"], ["literal", [...loaded]]],
          ]);
      };
      fallback();
      if (!visible || !input.zones.length) {
        map.triggerRepaint();
        return;
      }
      origin = MercatorCoordinate.fromLngLat([
        input.zones[0].lng,
        input.zones[0].lat,
      ]);
      units = origin.meterInMercatorCoordinateUnits();
      for (const feature of zoneWallFeatures(
        input.zones,
        input.quests,
        input.now,
      )) {
        if (feature.geometry.type !== "LineString") continue;
        const data = wallRibbonGeometry(
          feature.geometry.coordinates,
          Number(feature.properties.halo),
          ([lng, lat]) => {
            const p = MercatorCoordinate.fromLngLat([lng, lat]);
            return [(p.x - origin.x) / units, (p.y - origin.y) / units];
          },
        );
        if (!data.positions.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(data.positions, 3),
        );
        geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
        const mesh = new THREE.Mesh(
          geometry,
          curtainMaterial(
            String(feature.properties.color),
            feature.properties.dim === true,
          ),
        );
        mesh.frustumCulled = false;
        curtains.add(mesh);
      }
      map.getContainer().dataset.zoneAuraWalls = String(
        curtains.children.length,
      );
      map.triggerRepaint();
      for (const z of input.zones) {
        const id = altarModelId(
          z,
          input.quests,
          input.now,
          input.playerTier,
          input.selectedQuestId,
        );
        void load(id)
          .then((source) => {
            if (gone || run !== revision) return;
            const object = source.clone(true);
            const height = new THREE.Box3()
              .setFromObject(source)
              .getSize(new THREE.Vector3()).y;
            object.scale.setScalar(
              totemHeight(z.tier) / Math.max(height, 0.001),
            );
            const p = MercatorCoordinate.fromLngLat([z.lng, z.lat]);
            object.position.set(
              (p.x - origin.x) / units,
              0,
              (p.y - origin.y) / units,
            );
            const phase = zonePhase(z, input.quests, input.now);
            // No inferred completion/reward animation; spent state stays in the pin/nameplate.
            object.userData.phase = phase;
            object.userData.modelId = id;
            models.add(object);
            loaded.add(z.id);
            map.getContainer().dataset.altarModelIds = models.children
              .map((node) => node.userData.modelId)
              .join(",");
            map.getContainer().dataset.altarModels = String(loaded.size);
            map.getContainer().dataset.altarFallbacks = String(
              input.zones.length - loaded.size,
            );
            fallback();
            map.triggerRepaint();
          })
          .catch((error) => {
            console.warn("Zone altar kept its fallback", id, error);
          });
      }
    },
    destroy() {
      if (gone) return;
      if (map.getLayer(ID)) map.removeLayer(ID);
      if (map.getLayer("zone-totems")) map.setFilter("zone-totems", null);
    },
  };
}
