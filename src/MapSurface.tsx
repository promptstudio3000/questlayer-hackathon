import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/** Browse/detail overlays use the existing app history; they never resize the map. */
export function MapSurface({ overlay, label, onClose, children }: {
  overlay: boolean; label: string; onClose: () => void; children: ReactNode;
}) {
  return overlay
    ? <Dialog presentation="map" history={false} label={label} onClose={onClose}>{children}</Dialog>
    : <>{children}</>;
}
