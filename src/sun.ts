// Browser copy of server/sun.mjs (the VPS ships only server/, and server code
// never reads src/). tests/day-night.test.mjs checks that both give the same
// sunrise, sunset and phase. Local daylight from the sun's real position (NOAA
// solar equations, accurate to about a minute).
//
// Phases: "day" while the sun is above the horizon (refraction-corrected
// -0.833°), "dusk"/"dawn" during civil twilight (down to -6°), "night" below.

export type SkyPhase = "day" | "dusk" | "dawn" | "night";
export type SunTimes =
  | { noon: number; sunrise: number; sunset: number; polar?: undefined }
  | { noon: number; polar: "day" | "night"; sunrise?: undefined; sunset?: undefined };
export type Sky = { phase: SkyPhase; sunrise?: number; sunset?: number; polar?: "day" | "night" };

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
export const SUNRISE_ALTITUDE = -0.833;
export const CIVIL_ALTITUDE = -6;

function julianCentury(t: number) {
  return (t / DAY_MS + 2440587.5 - 2451545) / 36525;
}

// Declination (radians) and the equation of time (minutes) at time t.
function solar(t: number) {
  const T = julianCentury(t);
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    4 /
    RAD *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eot };
}

/** Sun altitude above the horizon in degrees at time t (ms) and place. */
export function sunAltitude(t: number, lat: number, lng: number) {
  const { decl, eot } = solar(t);
  const minutes = ((t % DAY_MS) + DAY_MS) % DAY_MS / 60_000;
  const trueSolar = (((minutes + eot + 4 * lng) % 1440) + 1440) % 1440;
  const hourAngle = (trueSolar / 4 - 180) * RAD;
  const phi = lat * RAD;
  const cosZenith =
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
}

/**
 * Sunrise and sunset (ms) of the solar day around `t` at a place.
 * `{ sunrise, sunset }`, or `{ polar: "day" | "night" }` when the sun never
 * crosses the horizon that day (far north or south).
 */
export function sunTimes(t: number, lat: number, lng: number, altitude = SUNRISE_ALTITUDE): SunTimes {
  // Solar noon nearest to t, iterated once for the equation of time.
  const lngMs = (lng / 360) * DAY_MS;
  let noon = Math.round((t + lngMs) / DAY_MS) * DAY_MS + DAY_MS / 2 - lngMs;
  if (noon - t > DAY_MS / 2) noon -= DAY_MS;
  if (t - noon > DAY_MS / 2) noon += DAY_MS;
  noon -= solar(noon).eot * 60_000;
  const { decl } = solar(noon);
  const phi = lat * RAD;
  const cosH =
    (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(decl)) /
    (Math.cos(phi) * Math.cos(decl));
  if (cosH <= -1) return { polar: "day", noon };
  if (cosH >= 1) return { polar: "night", noon };
  const half = (Math.acos(cosH) / RAD / 360) * DAY_MS;
  // One refinement pass with the declination at each event.
  const refine = (guess: number, sign: number) => {
    const s = solar(guess);
    const c =
      (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(s.decl)) /
      (Math.cos(phi) * Math.cos(s.decl));
    if (Math.abs(c) >= 1) return guess;
    return noon + sign * (Math.acos(c) / RAD / 360) * DAY_MS;
  };
  return {
    noon,
    sunrise: Math.round(refine(noon - half, -1)),
    sunset: Math.round(refine(noon + half, 1)),
  };
}

/** "day" | "dusk" | "dawn" | "night" at time t and place. */
export function skyPhase(t: number, lat: number, lng: number): SkyPhase {
  const alt = sunAltitude(t, lat, lng);
  if (alt > SUNRISE_ALTITUDE) return "day";
  if (alt > CIVIL_ALTITUDE)
    return sunAltitude(t + 600_000, lat, lng) > alt ? "dawn" : "dusk";
  return "night";
}

/** Day or night only (twilight counts as night for spawns). */
export const isDaylight = (t: number, lat: number, lng: number) => sunAltitude(t, lat, lng) > SUNRISE_ALTITUDE;

/**
 * Daylight spans [[from, to]] intersecting [start, end] (ms), at a place.
 * Night spans are the gaps. Used by the actor planner, so a "day" creature
 * walks only in sunlight and a "night" one only after sunset.
 */
export function daylightSpans(start: number, end: number, lat: number, lng: number) {
  const out: [number, number][] = [];
  // Solar days touching the window: one before, through one after.
  for (let t = start - DAY_MS; t <= end + DAY_MS; t += DAY_MS) {
    const s = sunTimes(t, lat, lng);
    let from: number, to: number;
    if (s.polar === "day") [from, to] = [s.noon - DAY_MS / 2, s.noon + DAY_MS / 2];
    else if (s.polar === "night") continue;
    else [from, to] = [s.sunrise!, s.sunset!];
    from = Math.max(from, start);
    to = Math.min(to, end);
    if (to > from) out.push([from, to]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of out) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** Complement of daylightSpans inside [start, end]. */
export function nightSpans(start: number, end: number, lat: number, lng: number) {
  const out: [number, number][] = [];
  let t = start;
  for (const [from, to] of daylightSpans(start, end, lat, lng)) {
    if (from > t) out.push([t, from]);
    t = Math.max(t, to);
  }
  if (end > t) out.push([t, end]);
  return out;
}

/**
 * What the map shows at a place: { phase, sunrise?, sunset?, polar? }.
 * sunrise/sunset are those of the local solar day around `t`.
 */
export function skyAt(t: number, { lat, lng }: { lat: number; lng: number }): Sky {
  const times = sunTimes(t, lat, lng);
  return times.polar
    ? { phase: skyPhase(t, lat, lng), polar: times.polar }
    : { phase: skyPhase(t, lat, lng), sunrise: times.sunrise, sunset: times.sunset };
}
