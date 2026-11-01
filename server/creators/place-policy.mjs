import { creatorAssert as fail, creatorFields } from "./operations.mjs";

// Author templates the creator flow offers. A place is public map data the
// author deliberately pins; it never comes from another player's location.
export const CREATOR_PLACE_TEMPLATES = Object.freeze({
  visit: { minPoints: 1, maxPoints: 1 },
  trail: { minPoints: 2, maxPoints: 6 },
  chest: { minPoints: 1, maxPoints: 1 },
});
const MAX_TRAIL_METERS = 5000;

const meters = (a, b) => {
  const r = 6371000,
    rad = Math.PI / 180,
    dLat = (b.lat - a.lat) * rad,
    dLng = (b.lng - a.lng) * rad,
    h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};
const point = (value) => {
  creatorFields(value, ["lat", "lng"]);
  fail(
    Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      Math.abs(value.lat) <= 85 &&
      Math.abs(value.lng) <= 180,
    "Choose a valid place on the map.",
    "CREATOR_INPUT",
    400,
  );
  // About 1 m precision is enough for a public pin.
  return {
    lat: Math.round(value.lat * 1e5) / 1e5,
    lng: Math.round(value.lng * 1e5) / 1e5,
  };
};
export function creatorPlace(value) {
  creatorFields(value, ["template", "points"]);
  const rule = Object.hasOwn(CREATOR_PLACE_TEMPLATES, value.template)
    ? CREATOR_PLACE_TEMPLATES[value.template]
    : null;
  fail(rule, "Choose a visit, trail or chest template.", "CREATOR_INPUT", 400);
  fail(
    Array.isArray(value.points) &&
      value.points.length >= rule.minPoints &&
      value.points.length <= rule.maxPoints,
    value.template === "trail"
      ? "A trail needs 2 to 6 stops."
      : "Pin exactly one place.",
    "CREATOR_INPUT",
    400,
  );
  const points = value.points.map(point);
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += meters(points[i - 1], points[i]);
  fail(
    length <= MAX_TRAIL_METERS,
    "Keep a trail under 5 km.",
    "CREATOR_INPUT",
    400,
  );
  return { template: value.template, points };
}

// Paid access price in yoctoNEAR, reviewed with the revision and registered on
// the creators contract by the publisher. "0" means free.
export const CREATOR_PRICE_BOUNDS = Object.freeze({
  min: 10n ** 22n, // 0.01 NEAR
  max: 10n * 10n ** 24n, // 10 NEAR
});
export function creatorPrice(value) {
  fail(
    typeof value === "string" && /^(0|[1-9]\d{0,30})$/.test(value),
    "Enter the access price as a whole yoctoNEAR amount.",
    "CREATOR_INPUT",
    400,
  );
  const price = BigInt(value);
  fail(
    price === 0n ||
      (price >= CREATOR_PRICE_BOUNDS.min && price <= CREATOR_PRICE_BOUNDS.max),
    "Choose a price between 0.01 and 10 NEAR, or keep it free.",
    "CREATOR_INPUT",
    400,
  );
  return price.toString();
}
