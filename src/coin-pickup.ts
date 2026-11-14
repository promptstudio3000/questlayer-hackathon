// Mirrors coinPickupRadius in server/domain.mjs (tests/coin-pickup.test.mjs
// keeps them equal): GPS coin reach grows with the reported accuracy.
export const COIN_GPS_RADIUS_M = 35;
export const COIN_GPS_SLACK_M = 25;
export const COIN_GPS_MAX_RADIUS_M = 60;
export const COIN_GPS_MAX_ACCURACY_M = 65;
export const COIN_GPS_MAX_AGE_MS = 30_000;

export function coinPickupRadius(accuracy: number | null | undefined) {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0)
    return COIN_GPS_RADIUS_M;
  return Math.min(COIN_GPS_MAX_RADIUS_M, Math.max(COIN_GPS_RADIUS_M, COIN_GPS_SLACK_M + accuracy));
}

type Fix = { accuracy: number; timestamp: number };

/** Client reach for auto-collect, 1 m inside the server check. Null = no usable fix. */
export function clientCoinReach(arena: boolean, worldRadius: number | undefined, fix: Fix | null, now: number) {
  if (arena) return (worldRadius ?? 18) - 1;
  if (!fix || !(fix.accuracy <= COIN_GPS_MAX_ACCURACY_M) || now - fix.timestamp > COIN_GPS_MAX_AGE_MS) return null;
  return coinPickupRadius(fix.accuracy) - 1;
}
