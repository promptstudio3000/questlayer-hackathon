import { assert } from "../domain.mjs";

export function worldQuery({ bounds, limit, cursor } = {}) {
  if (bounds === null) bounds = undefined;
  if (cursor === null) cursor = undefined;
  const paged =
    bounds !== undefined || limit !== undefined || cursor !== undefined;
  if (!paged) return {};
  if (typeof bounds === "string") bounds = bounds.split(",").map(Number);
  if (bounds !== undefined)
    assert(
      Array.isArray(bounds) &&
        bounds.length === 4 &&
        bounds.every(Number.isFinite) &&
        bounds[0] >= -180 &&
        bounds[2] <= 180 &&
        bounds[1] >= -85 &&
        bounds[3] <= 85 &&
        bounds[0] < bounds[2] &&
        bounds[1] < bounds[3],
      "Use bounds west,south,east,north without antimeridian wrapping.",
    );
  if (typeof limit === "string") {
    assert(/^[1-9]\d{0,3}$/.test(limit), "Invalid map page limit.");
    limit = Number(limit);
  }
  limit ??= 256;
  assert(
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000,
    "Map page limit must be between 1 and 1000.",
  );
  assert(
    cursor === undefined ||
      (typeof cursor === "string" &&
        cursor.length <= 2048 &&
        /^[A-Za-z0-9_-]+$/.test(cursor)),
    "Invalid map cursor.",
  );
  return { bounds: bounds || null, limit, cursor: cursor || null };
}
export function queryCursor(worldId, query, after) {
  return Buffer.from(
    JSON.stringify({ version: 1, worldId, bounds: query.bounds, after }),
  ).toString("base64url");
}
export function readQueryCursor(worldId, query) {
  if (!query.cursor) return "";
  let c;
  try {
    c = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
  } catch {
    assert(false, "Invalid map cursor.");
  }
  assert(
    c.version === 1 &&
      c.worldId === worldId &&
      JSON.stringify(c.bounds) === JSON.stringify(query.bounds) &&
      typeof c.after === "string" &&
      c.after.length <= 400 &&
      c.after.startsWith(`${worldId}:coin:`),
    "The map cursor belongs to another world or viewport.",
  );
  return c.after;
}
export function inBounds(p, bounds) {
  return (
    !bounds ||
    (p.lng >= bounds[0] &&
      p.lat >= bounds[1] &&
      p.lng <= bounds[2] &&
      p.lat <= bounds[3])
  );
}
export function zoneInBounds(zone, bounds) {
  if (!bounds) return true;
  if (!zone.geometry) return inBounds(zone, bounds);
  const points = zone.geometry.coordinates.flat(
    zone.geometry.type === "MultiPolygon" ? 2 : 1,
  );
  return (
    Math.max(...points.map((p) => p[0])) >= bounds[0] &&
    Math.min(...points.map((p) => p[0])) <= bounds[2] &&
    Math.max(...points.map((p) => p[1])) >= bounds[1] &&
    Math.min(...points.map((p) => p[1])) <= bounds[3]
  );
}

// Coins near the player (docs/PERFORMANCE-BUDGET.md). A demo arena holds
// about 6000 coins over 6 km; a phone needs only the ones it can reach or see
// at street zoom. Zones and quests are never cut, only coins.
export const NEAR_RADIUS_M = 1500;
export const NEAR_COIN_LIMIT = 1200;
export function nearQuery(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const [lat, lng] = value.split(",").map(Number);
    value = { lat, lng };
  }
  assert(
    value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      Math.abs(value.lat) <= 85 &&
      Math.abs(value.lng) <= 180,
    "Use near=lat,lng for nearby coins.",
  );
  return { lat: Number(value.lat), lng: Number(value.lng) };
}
export function nearBox({ lat, lng }, radiusM = NEAR_RADIUS_M) {
  const dLat = radiusM / 111320,
    dLng = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}
