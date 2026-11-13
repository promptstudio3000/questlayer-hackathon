// Geofabrik's extract index (https://download.geofabrik.de/index-v1.json) for
// demo cities whose source is "geofabrik:auto" (demo-cities.mjs): the worker
// picks the smallest extract whose published polygon contains the whole clip.
// Cached for 7 days next to the other inputs. VPS only (the cloud sandbox
// cannot reach Geofabrik).
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { USER_AGENT } from "./fetch.mjs";

export const GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json";
const WEEK = 7 * 86_400_000;

export async function loadGeofabrikIndex(dir, { log = () => {}, fetcher = fetch, now = Date.now() } = {}) {
  const file = `${dir}/geofabrik-index-v1.json`;
  if (existsSync(file) && now - statSync(file).mtimeMs < WEEK)
    return JSON.parse(readFileSync(file, "utf8"));
  log(`downloading ${GEOFABRIK_INDEX_URL}`);
  const res = await fetcher(GEOFABRIK_INDEX_URL, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${GEOFABRIK_INDEX_URL}: ${res.status}`);
  const text = await res.text();
  const index = JSON.parse(text);
  if (!Array.isArray(index?.features)) throw new Error("Geofabrik index has no features.");
  writeFileSync(`${file}.part`, text);
  renameSync(`${file}.part`, file);
  return index;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function outerRings(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.map((p) => p[0]);
  return [];
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

/** URL of the smallest extract whose polygon holds all four clip corners, or null. */
export function pickGeofabrikExtract(index, [w, s, e, n]) {
  const corners = [[w, s], [w, n], [e, s], [e, n]];
  let best = null;
  for (const f of index.features || []) {
    const url = f?.properties?.urls?.pbf;
    if (typeof url !== "string" || !url.startsWith("https://download.geofabrik.de/")) continue;
    const rings = outerRings(f.geometry);
    if (!corners.every((c) => rings.some((r) => inRing(c, r)))) continue;
    const area = rings.reduce((sum, r) => sum + ringArea(r), 0);
    if (!best || area < best.area) best = { url, area };
  }
  return best?.url || null;
}
