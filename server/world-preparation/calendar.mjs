import { requireValue } from "./canonical.mjs";

export function utcEpoch(day) {
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(day), "Use a UTC date YYYY-MM-DD.");
  const startsAt = Date.parse(`${day}T00:00:00.000Z`);
  requireValue(
    Number.isFinite(startsAt) &&
      new Date(startsAt).toISOString().slice(0, 10) === day,
    "Invalid UTC date.",
  );
  return { id: `utc:${day}`, day, startsAt, endsAt: startsAt + 86_400_000 };
}

// Scan the UTC timeline, not 'hours after local midnight'. This preserves both
// occurrences of a repeated local hour and never invents a skipped hour.
// Windows are half-open, recurring local wall-clock minutes; overnight windows
// are supplied as two intervals. The financial identity always stays in UTC.
export function localWindows(epoch, timezone, windows) {
  requireValue(
    Array.isArray(windows) && windows.length > 0 && windows.length <= 24,
    "Supply local opening windows.",
  );
  for (const w of windows)
    requireValue(
      Array.isArray(w) &&
        w.length === 2 &&
        w.every(Number.isInteger) &&
        w[0] >= 0 &&
        w[0] < w[1] &&
        w[1] <= 1440,
      "Invalid local minute interval.",
    );
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const result = [];
  for (let t = epoch.startsAt; t < epoch.endsAt; t += 60_000) {
    const parts = Object.fromEntries(
      formatter.formatToParts(t).map((p) => [p.type, p.value]),
    );
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if (!windows.some(([from, to]) => minute >= from && minute < to)) continue;
    const previous = result.at(-1);
    if (previous?.endsAt === t) previous.endsAt = t + 60_000;
    else result.push({ startsAt: t, endsAt: t + 60_000 });
  }
  return result;
}
