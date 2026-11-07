import { createHash, randomUUID } from 'node:crypto';

export const GOLD = 1_000_000;
export const COIN_VALUE = 10_000; // 0.01 GOLD; integer micro-GOLD, never floating balances.
// Pickup radii in meters. The arena is a trusted simulation; GPS play allows for fix accuracy.
export const COIN_ARENA_RADIUS_M = 18;
export const COIN_GPS_RADIUS_M = 35;
export const DAY = 86_400_000;
export class GameError extends Error {
  constructor(message, status = 400, code = 'INVALID_ACTION') { super(message); this.status = status; this.code = code; }
}
export function assert(condition, message, status = 400, code) { if (!condition) throw new GameError(message, status, code); }
export function amount(value, { min = 1, max = 1_000_000 * GOLD } = {}) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid amount.'); return value;
}
export function distance(a, b) {
  const r = Math.PI / 180, dlat = (b.lat-a.lat)*r, dlng=(b.lng-a.lng)*r;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2), Math.sqrt(1-(Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2)));
}
export function point(value) {
  assert(value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 85 && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180, 'Invalid location.');
  return { lat: value.lat, lng: value.lng };
}
export function dayKey(now = Date.now(), timezone = 'Europe/Prague') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
}
export function tierFor(weighted) { return weighted >= 100_000 * GOLD ? 3 : weighted >= 50_000 * GOLD ? 2 : 1; }
export function seeded(key) { let i = parseInt(createHash('sha256').update(key).digest('hex').slice(0,8),16); return () => { i = Math.imul(1664525, i) + 1013904223 | 0; return (i >>> 0) / 4294967296; }; }
export function id(prefix) { return `${prefix}_${randomUUID()}`; }
export function hash(value) { return createHash('sha256').update(value).digest('hex'); }
export function levelFor(xp) { return Math.min(50, 1 + Math.floor(Math.sqrt(xp / 100))); }
export function positionTier(position, now = Date.now()) {
  if (!position) return 0;
  const contribution=position.matures_at>now?(position.eligible_contribution||0):position.contribution;
  return Math.floor(position.active_u * contribution / 100);
}
export function splitYield(net) { amount(net, { min:0 }); const coins = Math.floor(net / 2); return { coins, zones: net-coins }; }
export const GPS_MAX_AGE_MS=15_000;
export function validateFix(fix, target, now = Date.now(), radius = COIN_GPS_RADIUS_M) {
  point(fix); assert(Number.isFinite(fix.accuracy) && fix.accuracy <= 35 && fix.accuracy >= 0, 'Your location is not precise enough yet. Step into the open and try again.', 422, 'GPS_ACCURACY');
  assert(Number.isFinite(fix.timestamp) && fix.timestamp <= now+2000 && now-fix.timestamp <= GPS_MAX_AGE_MS, 'Your location is out of date. Wait a moment for a fresh one, then try again.', 422, 'GPS_STALE');
  assert(distance(fix,target) <= radius, 'Get a bit closer, then try again.', 422, 'OUT_OF_RANGE');
}
