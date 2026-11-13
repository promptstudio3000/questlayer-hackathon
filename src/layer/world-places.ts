// Authored props and clearly identified preview actors. Cosmetic actors never
// publish presence, consume ore, modify the world or receive assets.
import * as THREE from "three";
import { WORLD_PLACES, type WorldPlaceId } from "../../server/layer/story-world.mjs";
import { createAvatar, nameTag, disposeSprite } from "./avatar";
import { outfitById } from "./world";
import { placeName } from "./place-ui";
import { tr } from "../i18n";

export function createWorldPlaces(scene: THREE.Scene, demo: boolean, clear: (x: number, z: number) => boolean) {
  const root = new THREE.Group(); scene.add(root);
  const purple = new THREE.MeshLambertMaterial({ color: 0x493164 });
  const pale = new THREE.MeshLambertMaterial({ color: 0xdcc9ef });
  const dark = new THREE.MeshLambertMaterial({ color: 0x241337 });
  const gold = new THREE.MeshLambertMaterial({ color: 0xffd279, emissive: 0x38210a });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x83f5eb });
  const white = new THREE.MeshBasicMaterial({ color: 0xfff1cb });
  const boxes: THREE.Object3D[] = [];
  const tags: { tag: THREE.Sprite; x: number; z: number }[] = [];
  const box = (g: THREE.Group, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), material);
    mesh.position.set(x,y,z); g.add(mesh); return mesh;
  };
  const guide = createAvatar(outfitById("nebula"), "#ffe3a2");
  const coins: THREE.Mesh[] = [];
  for (const place of WORLD_PLACES) {
    const group = new THREE.Group(); group.position.set(place.x, 15, place.z);
    group.userData.place = place.id; root.add(group);
    if (place.kind === "guide") {
      group.add(guide.group); guide.group.rotation.y = Math.PI;
      box(group, .22, .32, .22, gold, -.7, .95);
    } else if (place.kind === "treasury") {
      box(group, 1.7, .7, 1.25, purple, 0, .35);
      box(group, 1.8, .12, 1.3, gold, 0, .75);
      box(group, .3, .35, .1, gold, 0, .4, -.68);
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(.62,.62,.16,8), gold);
      coin.rotation.x = Math.PI/2; coin.position.y = 1.45; group.add(coin); coins.push(coin);
      // The pale centre is an authored pixel cross, not a currency pickup.
      box(group, .18, .58, .05, white, 0, 1.45, -.1);
      box(group, .48, .18, .05, white, 0, 1.45, -.1);
    } else {
      box(group, .17, 1.4, .17, purple, 0, .7);
      box(group, 1.35, .9, .22, pale, 0, 1.55);
      box(group, 1.15, .7, .05, dark, 0, 1.55, -.14);
      const gem = box(group,.29,.29,.08,place.kind === "workshop" ? gold : cyan,0,1.55,-.2);
      gem.rotation.z = Math.PI/4;
      // A double-sided sign stays readable when approached from the other path.
      box(group, .29, .29, .08, cyan, 0, 1.55, .2).rotation.z = Math.PI/4;
    }
    const tag = nameTag(placeName(place.id), place.kind === "treasury" ? "#ffe3a2" : "#e7d6ff", 32);
    tag.position.y = 2.85; tag.scale.set(3.6,.9,1); group.add(tag);
    tags.push({ tag, x: place.x, z: place.z });
    // A generous transparent hit region complements the accessible nearby action.
    const hit = box(group,1.8,2.5,1.5,new THREE.MeshBasicMaterial({visible:false}),0,1.25);
    hit.userData.place = place.id; boxes.push(hit);
  }
  const active = new THREE.Mesh(new THREE.TorusGeometry(1.1,.055,4,32), cyan);
  active.rotation.x = -Math.PI/2; active.visible = false; root.add(active);
  type DemoActor = { avatar: ReturnType<typeof createAvatar>; tag: THREE.Sprite; points: [number,number][]; offset: number };
  const actors: DemoActor[] = [];
  let labels = true;
  if (demo) for (const [name, points, offset] of [
    ["Tavi", [[19.5,-9.5],[23.5,-9.5],[23.5,-13.5],[19.5,-13.5]], 0],
    ["Luma", [[-22.5,30.5],[-21.5,32.5]], 2],
    ["Omi", [[1.5,-51.5],[1.5,-57.5]], 4],
  ] as [string,[number,number][],number][]) {
    const avatar = createAvatar(outfitById("nebula"), name === "Luma" ? "#edabff" : "#83f5eb");
    const tag = nameTag(`${name} · ${tr("Demo")}`, "#e7d6ff");
    tag.position.y=2.75; tag.scale.set(3,.75,1); avatar.group.add(tag); root.add(avatar.group);
    actors.push({avatar,tag,points,offset});
  }
  return {
    setLabelsVisible(value: boolean) { labels=value; },
    setObjective(id: WorldPlaceId | null) {
      const place = WORLD_PLACES.find(place => place.id === id);
      active.visible = !!place;
      if (place) active.position.set(place.x,15.08,place.z);
    },
    pick(ray: THREE.Raycaster, maximum: number) {
      return ray.intersectObjects(boxes).find(hit => hit.distance <= maximum)?.object.userData.place as WorldPlaceId | undefined;
    },
    update(dt: number, time: number, pos: THREE.Vector3, reduced: boolean) {
      guide.animate(dt,false,reduced ? 0 : time);
      for (const {tag,x,z} of tags) {
        const distance=Math.hypot(pos.x-x,pos.z-z);
        tag.visible=labels && distance>2.2 && distance<26;
      }
      for (const coin of coins) if (!reduced) coin.position.y=1.45+Math.sin(time*2)*.08;
      // Reproducible loops pause at each work point. Clear checks prevent a
      // cosmetic actor walking through blocks built by real explorers.
      for (const actor of actors) {
        const phase = ((reduced ? 0 : time) + actor.offset) / 6, n = Math.floor(phase) % actor.points.length;
        const from = actor.points[n], to = actor.points[(n+1)%actor.points.length];
        const amount = Math.min(1,(phase%1)*1.5);
        const x=from[0]+(to[0]-from[0])*amount, z=from[1]+(to[1]-from[1])*amount;
        const steps=Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])*2);
        let safe=true;
        for (let i=0;i<=steps;i++) if (!clear(from[0]+(to[0]-from[0])*i/steps,from[1]+(to[1]-from[1])*i/steps)) {safe=false;break;}
        actor.avatar.group.visible=safe;
        if (safe) actor.avatar.group.position.set(x,15,z);
        actor.avatar.group.rotation.y=Math.atan2(from[0]-to[0],from[1]-to[1]);
        actor.avatar.animate(dt,amount<1,reduced ? 0 : time);
        actor.tag.visible=labels && Math.hypot(pos.x-x,pos.z-z)<26;
      }
    },
    dispose() {
      // Remove avatars before the generic scene cleanup; each owns its texture.
      guide.group.removeFromParent(); guide.dispose();
      for (const actor of actors) { actor.avatar.group.removeFromParent(); actor.avatar.dispose(); disposeSprite(actor.tag); }
    },
  };
}
