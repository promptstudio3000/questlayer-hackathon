import { lazy, Suspense, useState } from "react";
import { MapPin } from "@phosphor-icons/react";
import { meters } from "./api";
import { distanceLabel } from "./app-bits";
import { tr } from "./i18n";
import type { Point } from "./types";
import "./local-chat.css";

const MapPeek = lazy(() => import("./MapPeek").then((m) => ({ default: m.MapPeek })));

/**
 * The GPS line under a note, topic or place (Lubos, 10 Nov 2026): the pin's
 * distance and coordinates in one small row; the distance reads first. Tapping it shows the spot on a
 * plain map; its X comes back here.
 */
export function PinLine({ at, you, title }: { at: Point; you?: Point | null; title: string }) {
  const [open, setOpen] = useState(false);
  const away = you ? distanceLabel(meters(you, at)) : "";
  return (
    <>
      <button
        type="button"
        className="pin-line"
        title={tr("Show on the map: {0}", { 0: title })}
        onClick={() => setOpen(true)}
      >
        <MapPin size={16} weight="fill" aria-hidden="true" />
        <span className="sr-only">{tr("Show on the map:")} </span>
        {away && <span className="pin-line-away">{away}</span>}
        <span className="pin-line-gps">
          {away ? "· " : ""}{at.lat.toFixed(5)}, {at.lng.toFixed(5)}
        </span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <MapPeek target={at} you={you} title={title} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
