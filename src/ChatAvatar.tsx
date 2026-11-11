import { tr } from "./i18n";

// Local chat avatars (Lubos, 11 Nov 2026): a round initial in a colour that
// stays the same for the same name, so a feed reads like people talking.
const HUES = [268, 312, 200, 160, 28, 345, 225, 95, 180, 48, 290, 130];

export function avatarHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return HUES[h % HUES.length];
}

export function ChatAvatar({ name, own = false, size = 36 }: { name: string; own?: boolean; size?: number }) {
  const initial = [...(name.trim() || "?")][0].toUpperCase();
  return (
    <span
      className={`chat-avatar${own ? " is-own" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.44, ["--hue" as string]: own ? 262 : avatarHue(name) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

/** "350 m" close by, "12 km" further away. */
export function distanceLabel(m: number) {
  return m < 1000 ? tr("{0} m", { 0: Math.max(10, Math.round(m / 10) * 10) }) : tr("{0} km", { 0: m < 10_000 ? (m / 1000).toFixed(1) : Math.round(m / 1000) });
}

/** Chat time: "now", "5 min", "3 h", then the date. */
export function timeAgo(at: number, now = Date.now()) {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return tr("now");
  if (min < 60) return tr("{0} min", { 0: min });
  if (min < 24 * 60) return tr("{0} h", { 0: Math.floor(min / 60) });
  return new Date(at).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
