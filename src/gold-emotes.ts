import "./gold-map.css";
// Emotes shown above a character on the map (QGOLD stream 4). Basic emotes
// are free for everyone; premium ones are unlocked once for GOLD in the shop.
// Kept tiny: the map marker code imports it on the first screen.
export const EMOTE_GLYPH: Record<string, string> = {
  wave: "👋",
  smile: "😄",
  thumbs: "👍",
  heart: "❤️",
  party: "🎉",
  question: "❓",
  fire: "🔥",
  crown: "👑",
  gem: "💎",
  ghost: "👻",
  dragon: "🐉",
  rocket: "🚀",
  bolt: "⚡",
  clover: "🍀",
  rainbow: "🌈",
  unicorn: "🦄",
};
export const emoteGlyph = (id?: string | null) => (id && EMOTE_GLYPH[id]) || "";
/** Marker frames (cosmetics): a ring colour around the explorer marker. */
export const FRAME_COLOR: Record<string, string> = {
  "frame-ember": "#ff7a3d",
  "frame-frost": "#5cc8ff",
  "frame-storm": "#8b5cff",
  "frame-void": "#2b1240",
  "frame-gold": "#f2c230",
};

/** Put an emote bubble and a frame colour on a map marker element. */
export function applyGoldLook(element: HTMLElement, look?: { emote?: string | null; frame?: string | null } | null) {
  element.querySelector(":scope > .gold-emote-bubble")?.remove();
  const glyph = emoteGlyph(look?.emote);
  if (glyph) {
    const bubble = document.createElement("div");
    bubble.className = "gold-emote-bubble";
    bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = glyph;
    element.append(bubble);
  }
  const color = look?.frame ? FRAME_COLOR[look.frame] : "";
  element.classList.toggle("gold-framed", !!color);
  if (color) element.style.setProperty("--gold-frame", color);
  else element.style.removeProperty("--gold-frame");
}
