// Lures and place messages on the map (QGOLD stream 4). Loaded on demand by
// GameMap once the gold map data arrives: lures as light pillars with a
// countdown, shouts as speech bubbles, topics as chat pins (tap opens them).
import * as maplibregl from "maplibre-gl";
import { tr } from "./i18n";
import type { GoldMap } from "./gold-spend-client";

export function attachGoldLayer(map: maplibregl.Map, onPlace: (id: string) => void) {
  const markers = new Map<string, { marker: maplibregl.Marker; key: string }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lures: GoldMap["lures"] = [];
  const minutesLeft = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000));
  function tick() {
    for (const l of lures) {
      const label = markers.get(`lure:${l.id}`)?.marker.getElement().querySelector("span");
      if (label) label.textContent = `${l.actorName || (l.kind === "beacon" ? tr("Beacon") : tr("Lure"))} · ${tr("{0} min", { 0: minutesLeft(l.endsAt) })}`;
    }
  }
  function update(data: GoldMap) {
    lures = data.lures.filter((l) => l.endsAt > Date.now());
    const wanted = new Map<string, { key: string; make: () => maplibregl.Marker }>();
    for (const l of lures)
      wanted.set(`lure:${l.id}`, {
        key: `${l.endsAt}`,
        make: () => {
          const node = document.createElement("div");
          node.className = `gold-lure-marker kind-${l.kind}`;
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", l.kind === "beacon" ? tr("Beacon") : tr("Lure"));
          node.innerHTML = `<div class="gold-lure-pillar"></div><span></span>`;
          return new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([l.lng, l.lat]);
        },
      });
    for (const p of data.places)
      wanted.set(`place:${p.id}`, {
        key: `${p.text}|${p.posts}`,
        make: () => {
          const node = document.createElement("button");
          node.type = "button";
          node.className = `gold-place-pin kind-${p.kind}`;
          node.textContent = p.text;
          node.setAttribute("aria-label", p.kind === "shout" ? tr("Shout: {0}", { 0: p.text }) : tr("Topic: {0}", { 0: p.text }));
          node.addEventListener("click", (e) => {
            e.stopPropagation();
            onPlace(p.id);
          });
          return new maplibregl.Marker({ element: node, anchor: "bottom-left" }).setLngLat([p.lng, p.lat]);
        },
      });
    for (const [id, m] of markers)
      if (wanted.get(id)?.key !== m.key) {
        m.marker.remove();
        markers.delete(id);
      }
    for (const [id, w] of wanted) if (!markers.has(id)) markers.set(id, { marker: w.make().addTo(map), key: w.key });
    tick();
    clearInterval(timer);
    if (lures.length) timer = setInterval(tick, 20_000);
  }
  function remove() {
    clearInterval(timer);
    for (const m of markers.values()) m.marker.remove();
    markers.clear();
  }
  return { update, remove };
}
