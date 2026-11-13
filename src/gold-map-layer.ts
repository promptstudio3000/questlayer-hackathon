// Lures and place messages on the map (QGOLD stream 4). Loaded on demand by
// GameMap once the gold map data arrives: lures as light pillars with a
// countdown, shouts as speech bubbles, topics as chat pins (tap opens them).
import * as maplibregl from "maplibre-gl";
import { tr } from "./i18n";
import { mapKitUrl } from "./map-kit";
import type { GoldMap } from "./gold-spend-client";
import "./gold-map.css";

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
          const img = document.createElement("img"); img.src = mapKitUrl("pins/note.png"); img.alt = ""; img.className = "map-kit-note"; img.onerror = () => img.remove();
          const text = document.createElement("span"); text.textContent = p.text;
          node.append(img, text);
          node.setAttribute("aria-label", p.kind === "shout" ? tr("Shout: {0}", { 0: p.text }) : tr("Topic: {0}", { 0: p.text }));
          foldable(node, () => onPlace(p.id));
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

/** Messages on the map stay closed as small icons. The first tap opens the
 *  text, a tap on the open text goes to the thread, and the X (or Escape, or
 *  opening another one) folds it back to the icon. */
function foldable(node: HTMLButtonElement, onOpen: () => void) {
  const close = document.createElement("i");
  close.className = "pin-close";
  close.setAttribute("aria-hidden", "true");
  close.textContent = "×";
  node.append(close);
  node.setAttribute("aria-expanded", "false");
  const fold = () => { delete node.dataset.open; node.setAttribute("aria-expanded", "false"); };
  node.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!node.dataset.open) {
      document.querySelectorAll<HTMLElement>(".gold-place-pin[data-open]").forEach((other) => { delete other.dataset.open; other.setAttribute("aria-expanded", "false"); });
      node.dataset.open = "true";
      node.setAttribute("aria-expanded", "true");
    } else if (e.target === close) fold();
    else onOpen();
  });
  node.addEventListener("keydown", (e) => { if (e.key === "Escape" && node.dataset.open) { e.stopPropagation(); fold(); } });
}

/** Free map notes (Local chat · Notes) as small paper pins; tap opens the note. */
export type NotePin = { id: string; text: string; lat: number; lng: number; own: boolean };
export function attachNoteLayer(map: maplibregl.Map, onNote: (id: string) => void) {
  const markers = new Map<string, { marker: maplibregl.Marker; key: string }>();
  function update(notes: readonly NotePin[]) {
    const wanted = new Map(notes.map((n) => [n.id, n]));
    for (const [id, m] of markers) {
      const n = wanted.get(id);
      if (!n || m.key !== `${n.text}|${n.lat}|${n.lng}|${n.own}`) {
        m.marker.remove();
        markers.delete(id);
      }
    }
    for (const n of notes) {
      if (markers.has(n.id)) continue;
      const node = document.createElement("button");
      node.type = "button";
      node.className = `gold-place-pin kind-note${n.own ? " is-own" : ""}`;
      const img = document.createElement("img"); img.src = mapKitUrl("pins/note.png"); img.alt = ""; img.className = "map-kit-note"; img.onerror = () => img.remove();
      const text = document.createElement("span"); text.textContent = n.text;
      node.append(img, text);
      node.setAttribute("aria-label", n.own ? tr("Your note: {0}", { 0: n.text }) : tr("Note: {0}", { 0: n.text }));
      foldable(node, () => onNote(n.id));
      const marker = new maplibregl.Marker({ element: node, anchor: "bottom-left" }).setLngLat([n.lng, n.lat]).addTo(map);
      markers.set(n.id, { marker, key: `${n.text}|${n.lat}|${n.lng}|${n.own}` });
    }
  }
  function remove() {
    for (const m of markers.values()) m.marker.remove();
    markers.clear();
  }
  return { update, remove };
}
