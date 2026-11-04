// Test-only clock shift for e2e journeys that must see a daytime world.
// POI quests open 08:00-20:00 local and the NPC cast keeps play hours, so a
// CI run at 02:00 Prague time would see an honest but empty map. Loaded with
// `node --import ./scripts/lib/e2e-clock.mjs server/index.mjs` and
// E2E_CLOCK_OFFSET_MS set; time still flows, it is only moved. Never used by
// the real server: without the variable this module changes nothing.
const offset = Number(process.env.E2E_CLOCK_OFFSET_MS || 0);

if (Number.isFinite(offset) && offset !== 0) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(realNow() + offset);
    }
    static now() {
      return realNow() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
}

/**
 * Offset that moves "now" to 11:00 in `timeZone` on the same local date when
 * the local hour is outside [9, 18); 0 inside that window.
 */
export function daytimeOffset(timeZone = "Europe/Prague", now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  if (hour >= 9 && hour < 18) return 0;
  const sinceMidnight =
    ((hour * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return 11 * 3_600_000 - sinceMidnight;
}
