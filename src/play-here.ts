// "Play where you are" (docs/DEMO-ZONES.md, wiki "Demo and GPS").
//
// The app opens in the Plzeň city demo. Two small helpers join the demo with
// the real world everywhere else in Czechia:
//   - once a player switches to GPS, the choice is remembered and the next
//     launch resumes the world around them (when location is still allowed);
//   - a player in the demo whose browser already allows location and who is
//     far from Plzeň gets a "Play here" card instead of an empty map.
// Nothing here asks for location by itself: without an existing permission
// the demo stays exactly as before.

// Same equirectangular distance as meters() in src/api.ts (kept local so this
// file loads without the API client).
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180,
    x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) * r) / 2),
    y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371000;
}

const GPS_KEY = "questlayer.gpsMode";
/** Centre of the Plzeň city demo (same point as the app's HOME). */
export const DEMO_CENTER = Object.freeze({ lat: 49.74745, lng: 13.3774 });
/** Beyond this straight-line distance a player is outside the Plzeň demo. */
export const DEMO_AREA_M = 12_000;

export function gpsRemembered(): boolean {
  try {
    return localStorage.getItem(GPS_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberGps(on: boolean) {
  try {
    if (on) localStorage.setItem(GPS_KEY, "1");
    else localStorage.removeItem(GPS_KEY);
  } catch {}
}

/** True only when the browser already granted location; never prompts. */
export async function locationGranted(): Promise<boolean> {
  try {
    if (!navigator.geolocation || !navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export function awayFromDemo(at: { lat: number; lng: number }, center = DEMO_CENTER, radiusM = DEMO_AREA_M) {
  return meters(center, at) > radiusM;
}
