// Map layer for roaming NPCs and monsters (docs/NPC-PLAN.md §9, §14).
// Loaded on demand by GameMap, so it never enters the first-load bundle.
// The server sends each actor's deterministic segments for the next 2 h; the
// layer interpolates positions locally once a second and refetches every
// minute or after the player moves 120 m.
import * as maplibregl from "maplibre-gl";
import type { ActorSegment, ActorView, ActorsResponse } from "./actor-types";
import { api, meters } from "./api";
import "./actors.css";

type LngLat = { lng: number; lat: number };

/** Same interpolation as server/actors/schedule.mjs positionAt. */
export function actorPositionAt(
  segments: ActorSegment[],
  t: number,
): (LngLat & { dwell: boolean; heading: number | null }) | null {
  const s = segments.find((x) => t >= x.from && t < x.to);
  if (!s) return null;
  if (s.dwell || s.path.length === 1)
    return { lng: s.path[0][0], lat: s.path[0][1], dwell: true, heading: null };
  const pt = (p: [number, number]) => ({ lng: p[0], lat: p[1] });
  const lengths = [0];
  for (let i = 1; i < s.path.length; i++)
    lengths.push(lengths[i - 1] + meters(pt(s.path[i - 1]), pt(s.path[i])));
  const total = lengths[lengths.length - 1],
    want = (total * (t - s.from)) / (s.to - s.from);
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < want) i++;
  const span = lengths[i] - lengths[i - 1] || 1,
    f = Math.max(0, Math.min(1, (want - lengths[i - 1]) / span)),
    [a, b] = [s.path[i - 1], s.path[i]];
  return {
    lng: a[0] + (b[0] - a[0]) * f,
    lat: a[1] + (b[1] - a[1]) * f,
    dwell: false,
    heading: b[0] >= a[0] ? 1 : -1,
  };
}

// Original low-poly 3D models (src/actor-models.ts) are rendered once per
// model into a cached sprite. three.js loads only with this chunk.
export async function loadActorArt() {
  return import("./actor-models").catch(() => null);
}

const ARCHETYPE_LABEL: Record<string, string> = {
  storyteller: "Storyteller",
  trader: "Trader",
  keeper: "Keeper",
  quest_giver: "Quest giver",
  wandering_rare: "Rare sighting",
  roamer: "Roaming monster",
  guardian: "Guardian",
  lurker: "Lurker",
  boss: "Boss",
};
export const actorRoleLabel = (a: Pick<ActorView, "archetype">) =>
  ARCHETYPE_LABEL[a.archetype] || "Character";

function markerNode(actor: ActorView, onSelect: (a: ActorView) => void) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `actor-marker actor-${actor.kind} actor-${actor.archetype}`;
  node.dataset.actorId = actor.id;
  node.setAttribute(
    "aria-label",
    `${actor.name}, ${actorRoleLabel(actor)}${actor.state === "defeated" ? ", beaten today" : ""}`,
  );
  const badge = document.createElement("span");
  badge.className = "actor-badge";
  badge.textContent = actor.name.slice(0, 1);
  const label = document.createElement("span");
  label.className = "actor-label";
  label.textContent = actor.name;
  node.append(badge, label);
  node.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(actor);
  });
  return node;
}

export type ActorsLayer = {
  update(input: { worldId: string | null; position: LngLat; visible: boolean }): void;
  destroy(): void;
};

export function attachActorsLayer(
  map: maplibregl.Map,
  { onSelect }: { onSelect: (actor: ActorView) => void },
): ActorsLayer {
  const markers = new Map<string, { marker: maplibregl.Marker; actor: ActorView; node: HTMLElement }>();
  let actors: ActorView[] = [],
    skew = 0,
    worldId: string | null = null,
    position: LngLat | null = null,
    fetchedAt = 0,
    fetchedFrom: LngLat | null = null,
    visible = true,
    loading: AbortController | null = null,
    gone = false;
  // Static props under an actor, e.g. the Great Portal at the boss's square.
  const arenas = new Map<string, { marker: maplibregl.Marker; node: HTMLElement; model: string }>();
  const select = (a: ActorView) => onSelect(markers.get(a.id)?.actor || a);
  let art: Awaited<ReturnType<typeof loadActorArt>> = null;
  loadActorArt().then((m) => {
    art = m;
    for (const { actor, node } of markers.values()) paint(actor, node);
    for (const { node, model } of arenas.values()) paintArena(node, model);
  });
  function paint(actor: ActorView, node: HTMLElement) {
    if (!art?.actorSprite || node.querySelector("img")) return;
    art
      .actorSprite(actor.model, 96)
      .then((url) => {
        if (gone || !url || node.querySelector("img")) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.className = "actor-sprite";
        node.querySelector(".actor-badge")?.replaceWith(img);
      })
      .catch(() => {});
  }
  async function refresh() {
    if (!worldId || !position) return;
    loading?.abort();
    const controller = (loading = new AbortController());
    const at = position;
    try {
      const r = await api<ActorsResponse>(
        `/actors?worldId=${encodeURIComponent(worldId)}&lat=${at.lat.toFixed(5)}&lng=${at.lng.toFixed(5)}`,
        undefined,
        { signal: controller.signal },
      );
      if (gone || controller.signal.aborted) return;
      skew = r.now - Date.now();
      actors = r.enabled ? r.actors : [];
      fetchedAt = Date.now();
      fetchedFrom = at;
      sync();
    } catch {
      fetchedAt = Date.now(); // back off for a minute on errors
    }
  }
  function syncArenas() {
    const want = new Map(actors.filter((a) => a.arena).map((a) => [a.id, a.arena!]));
    for (const [id, a] of arenas)
      if (!want.has(id)) {
        a.marker.remove();
        arenas.delete(id);
      }
    for (const [id, arena] of want) {
      if (arenas.has(id)) continue;
      const node = document.createElement("div");
      node.className = "actor-arena";
      node.setAttribute("aria-hidden", "true");
      const marker = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([arena.lng, arena.lat]);
      arenas.set(id, { marker, node, model: arena.model });
      paintArena(node, arena.model);
    }
  }
  function paintArena(node: HTMLElement, model: string) {
    if (!art?.actorSprite || node.querySelector("img")) return;
    art
      .actorSprite(model, 128)
      .then((url) => {
        if (gone || !url || node.querySelector("img")) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.className = "actor-sprite";
        node.append(img);
      })
      .catch(() => {});
  }
  function sync() {
    syncArenas();
    const keep = new Set(actors.map((a) => a.id));
    for (const [id, m] of markers)
      if (!keep.has(id)) {
        m.marker.remove();
        markers.delete(id);
      }
    for (const actor of actors) {
      const existing = markers.get(actor.id);
      if (existing) {
        existing.actor = actor;
        existing.node.classList.toggle("actor-defeated", actor.state === "defeated");
        continue;
      }
      const node = markerNode(actor, select);
      const marker = new maplibregl.Marker({ element: node, anchor: "bottom" });
      markers.set(actor.id, { marker, actor, node });
      paint(actor, node);
    }
    tick();
  }
  function tick() {
    const now = Date.now() + skew;
    for (const { marker } of arenas.values()) {
      if (!visible) marker.remove();
      else if (!(marker as unknown as { _map?: unknown })._map) marker.addTo(map);
    }
    for (const { marker, actor, node } of markers.values()) {
      const p = visible ? actorPositionAt(actor.segments, now) : null;
      const hidden =
        !p ||
        (actor.revealRadiusM !== undefined &&
          (!position || meters(position, p) > actor.revealRadiusM));
      if (hidden) {
        marker.remove();
        continue;
      }
      marker.setLngLat([p.lng, p.lat]);
      if (!(marker as unknown as { _map?: unknown })._map) marker.addTo(map);
      node.classList.toggle("actor-walking", !p.dwell);
      if (p.heading) node.style.setProperty("--actor-facing", String(p.heading));
    }
    if (
      Date.now() - fetchedAt > 60_000 ||
      (position && fetchedFrom && meters(position, fetchedFrom) > 120)
    )
      void refresh();
  }
  const timer = window.setInterval(tick, 1000);
  return {
    update(input) {
      visible = input.visible;
      position = input.position;
      if (input.worldId !== worldId) {
        worldId = input.worldId;
        actors = [];
        fetchedAt = 0;
        sync();
      }
      if (!fetchedAt) void refresh();
      else tick();
    },
    destroy() {
      gone = true;
      loading?.abort();
      window.clearInterval(timer);
      for (const m of markers.values()) m.marker.remove();
      markers.clear();
      for (const a of arenas.values()) a.marker.remove();
      arenas.clear();
    },
  };
}
