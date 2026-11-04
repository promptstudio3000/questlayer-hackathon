// Dev preview for src/actor-models.ts: every NPC and monster as an animated 3D view plus its baked map sprite.
import { ACTOR_MODELS, ACTOR_MODEL_INFO, actorSprite, createActorScene, setUpstreamModelBase } from "../src/actor-models";

// The official Gotchiverse models come from the authenticated, digest-checked server route. For an offline preview,
// pass ?upstream=/some/local/dir/ that holds the same pinned files (never committed).
const upstream = new URLSearchParams(location.search).get("upstream");
if (upstream && /^\/[a-z0-9_\/-]+\/$/i.test(upstream)) setUpstreamModelBase(upstream);

const root = document.getElementById("root")!;
root.innerHTML = `<h1>NPCs and monsters</h1><p>Original low-poly models built from three.js primitives, plus official Gotchiverse models loaded at runtime from a pinned, digest-checked source. Click a model for a live, draggable view. The row below shows the baked map-marker sprites.</p><div class="sprites" id="sprites"></div><div id="live" class="card stage" style="height:360px;margin-bottom:12px" hidden></div><div class="grid" id="grid"></div>`;
const grid = document.getElementById("grid")!, sprites = document.getElementById("sprites")!;
for (const model of ACTOR_MODELS) {
  const info = ACTOR_MODEL_INFO[model];
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.model = model;
  card.innerHTML = `<div class="stage"></div><b>${info.label}</b><span>${info.role} · <code>${model}</code></span>`;
  grid.append(card);
  // Browsers cap live WebGL contexts (~16), so the grid shows large baked renders; click one for the live view.
  const stage = card.querySelector(".stage") as HTMLElement;
  void actorSprite(model, 320).then((url) => (stage.innerHTML = `<img src="${url}" alt="${info.label}">`));
  card.addEventListener("click", () => openLive(model));
}
let live: { dispose(): void } | null = null;
function openLive(model: (typeof ACTOR_MODELS)[number]) {
  live?.dispose();
  const host = document.getElementById("live")!;
  host.hidden = false;
  live = createActorScene(host, model, { label: ACTOR_MODEL_INFO[model].label });
}
Promise.all(ACTOR_MODELS.map((m) => actorSprite(m, 96))).then((urls) => {
  urls.forEach((url, i) => {
    const f = document.createElement("figure");
    f.innerHTML = `<img src="${url}" width="64" height="64" alt="${ACTOR_MODEL_INFO[ACTOR_MODELS[i]].label}"><figcaption>${ACTOR_MODELS[i]}</figcaption>`;
    sprites.append(f);
  });
  document.body.dataset.ready = "1";
});
