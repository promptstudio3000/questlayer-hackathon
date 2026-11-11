// Play where you are (docs/DEMO-ZONES.md, wiki "Map and movement").
//
// The game starts in the world around the player: once an explorer is
// signed in, the app asks for location and loads the quests, zones and coins
// of the player's own street cell. The Plzeň city demo is the fallback when
// location is refused or unavailable, and it stays chosen when the player
// switches to Demo in Map settings (remembered until they pick GPS again).
const MODE_KEY = "questlayer.playMode";

/** True when the player last chose the city demo themselves. */
export function demoChosen(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === "demo";
  } catch {
    return false;
  }
}

export function rememberMode(mode: "gps" | "demo") {
  try {
    localStorage.setItem(MODE_KEY, mode);
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

/** Start in GPS unless location is refused or the player picked the demo. */
export function shouldStartWithGps(permission: PermissionState | "unavailable", chosenDemo = demoChosen()) {
  return !chosenDemo && (permission === "granted" || permission === "prompt");
}
