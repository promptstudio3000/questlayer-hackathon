import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { Dialog } from "./Dialog";
import { tr } from "./i18n";
import { prefersReducedMotion } from "./feedback";
import type { Point } from "./types";
import "./map-peek.css";
maplibregl.setWorkerUrl(mapWorkerUrl);

/**
 * Where is it? (Lubos, 10 Nov 2026): tapping the GPS line of a note, topic or
 * place shows a plain map with just its pin and your own position. No map
 * controls; the X goes back to the list it came from.
 */
export function MapPeek({
  target,
  you,
  title,
  onClose,
}: {
  target: Point;
  you?: Point | null;
  title: string;
  onClose: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      // The canvas label a screen reader announces, in the player's language.
      locale: { "Map.Title": tr("Map") },
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [target.lng, target.lat],
      zoom: 17,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-left");
    const pin = document.createElement("div");
    pin.className = "map-peek-pin";
    pin.innerHTML = '<span class="map-peek-pin-head"></span><span class="map-peek-pin-stake"></span>';
    new maplibregl.Marker({ element: pin, anchor: "bottom" }).setLngLat([target.lng, target.lat]).addTo(map);
    if (you && Number.isFinite(you.lat) && Number.isFinite(you.lng)) {
      const me = document.createElement("div");
      me.className = "map-peek-you";
      me.title = tr("You");
      new maplibregl.Marker({ element: me }).setLngLat([you.lng, you.lat]).addTo(map);
      const far = Math.abs(you.lat - target.lat) + Math.abs(you.lng - target.lng);
      if (far > 0.0004 && far < 0.4)
        map.once("load", () =>
          map.fitBounds(
            [
              [Math.min(you.lng, target.lng), Math.min(you.lat, target.lat)],
              [Math.max(you.lng, target.lng), Math.max(you.lat, target.lat)],
            ],
            { padding: 72, maxZoom: 17, duration: prefersReducedMotion() ? 0 : 400 },
          ),
        );
    }
    return () => map.remove();
  }, [target.lat, target.lng, you?.lat, you?.lng]);
  return (
    <Dialog label={title} onClose={onClose}>
      <div className="map-peek">
        <div className="map-peek-map" ref={el} aria-hidden="true" />
        <p className="map-peek-caption">
          <b>{title}</b>
          <span>
            {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
          </span>
        </p>
        <button type="button" className="map-peek-close" aria-label={tr("Back to the list")} title={tr("Back to the list")} onClick={onClose} autoFocus>
          <X size={24} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
