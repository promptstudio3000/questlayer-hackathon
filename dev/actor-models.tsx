// Dev preview for src/actor-models.ts: every NPC and monster as an animated 3D view plus its baked map sprite.
import { ACTOR_MODELS, ACTOR_MODEL_INFO, actorSprite, createActorScene } from "../src/actor-models";

const root = document.getElementById("root")!;
root.innerHTML = `<h1>NPCs and monsters</h1><p>Original low-poly models built from three.js primitives (no third-party art). Drag a model to rotate it. The row below shows the baked map-marker sprites.</p><div class="sprites" id="sprites"></div><div class="grid" id="grid"></div>`;
const grid = document.getElementById("grid")!, sprites = document.getElementById("sprites")!;
for (const model of ACTOR_MODELS) {
  const info = ACTOR_MODEL_INFO[model];
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.model = model;
  card.innerHTML = `<div class="stage"></div><b>${info.label}</b><span>${info.role} · <code>${model}</code></span>`;
  grid.append(card);
  createActorScene(card.querySelector(".stage") as HTMLElement, model, { label: info.label });
}
Promise.all(ACTOR_MODELS.map((m) => actorSprite(m, 96))).then((urls) => {
  urls.forEach((url, i) => {
    const f = document.createElement("figure");
    f.innerHTML = `<img src="${url}" width="64" height="64" alt="${ACTOR_MODEL_INFO[ACTOR_MODELS[i]].label}"><figcaption>${ACTOR_MODELS[i]}</figcaption>`;
    sprites.append(f);
  });
  document.body.dataset.ready = "1";
});
