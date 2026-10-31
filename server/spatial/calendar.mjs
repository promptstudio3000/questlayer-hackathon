import { dayKey, assert } from "../domain.mjs";
const DAY = 86400000;
export function shiftDate(day, delta = 1) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day), "Invalid local date.");
  return new Date(Date.parse(day + "T12:00:00Z") + delta * DAY)
    .toISOString()
    .slice(0, 10);
}
export function localDateStart(day, timezone) {
  const base = Date.parse(day + "T00:00:00Z");
  assert(Number.isFinite(base), "Invalid local date.");
  let low = base - 36 * 3600000,
    high = base + 36 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dayKey(mid, timezone) < day) low = mid;
    else high = mid;
  }
  assert(dayKey(high, timezone) === day, "This local date does not exist.");
  return high;
}
export function localDateBounds(day, timezone) {
  return {
    startsAt: localDateStart(day, timezone),
    endsAt: localDateStart(shiftDate(day), timezone),
  };
}
