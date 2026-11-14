// One way for any dialog to start map guidance (14 Nov 2026): App
// listens for this event, switches to the map, marks the point and draws the
// same direction line with the "Guiding you to" chip as path tasks do.
export const GUIDE_EVENT = "questlayer:navigate";
export type GuidePoint = { lat: number; lng: number; label: string };
export function guideTo(point: GuidePoint) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: point }));
}
