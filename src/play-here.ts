// Play where you are (docs/DEMO-ZONES.md, wiki "Map and movement").
//
// The game starts in the world around the player: once an explorer is
// signed in, the app asks for location and loads the quests, zones and coins
// of the player's own street cell. The Plzeň city demo is the fallback when
// location is refused or unavailable, and it stays chosen when the player
// switches to Demo in Map settings (remembered until they pick GPS again).
// The Test Layer is the Plzeň demo (docs/TEST-LAYER.md): it opens in the demo
// wherever the visitor is, and uses GPS only after they tap Use GPS themselves.
const MODE_KEY = "questlayer.playMode";
const GPS_CHOSEN_KEY = "questlayer.gpsChosen";
const TEST_LAYER = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_QL_LAYER === "test";

/** True when the player last chose the city demo themselves. */
export function demoChosen(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === "demo";
  } catch {
    return false;
  }
}

/** True when the player tapped Use GPS themselves (not the automatic start). */
export function gpsChosen(): boolean {
  try {
    return localStorage.getItem(GPS_CHOSEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** `chosen` marks a GPS start the player asked for; the demo clears it. */
export function rememberMode(mode: "gps" | "demo", chosen = false) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    if (mode === "demo") localStorage.removeItem(GPS_CHOSEN_KEY);
    else if (chosen) localStorage.setItem(GPS_CHOSEN_KEY, "1");
  } catch {}
}

/** Browser location permission, or "unavailable" without the API. */
export async function locationPermission(): Promise<PermissionState | "unavailable"> {
  try {
    if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";
    if (!navigator.permissions?.query) return "prompt";
    return (await navigator.permissions.query({ name: "geolocation" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}

/**
 * Start in GPS unless location is refused or the player picked the demo.
 * The Test Layer starts in GPS only when the player chose GPS there before.
 */
export function shouldStartWithGps(
  permission: PermissionState | "unavailable",
  chosenDemo = demoChosen(),
  testLayer = TEST_LAYER,
  chosenGps = gpsChosen(),
) {
  if (testLayer && !chosenGps) return false;
  return !chosenDemo && (permission === "granted" || permission === "prompt");
}
