import { auraEdition, auraMarkup } from "./aura-art-data.ts";
import { artUrl } from "./art-registry.ts";
// Legacy, self-authored NFT cover art. Never replace minted media with third-party art.
export function ghostSvg(color = "#b6a1df", hat = false) {
  const safe = /^#[a-fA-F0-9]{6}$/.test(color) ? color : "#b6a1df";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56" shape-rendering="crispEdges"><ellipse cx="24" cy="51" rx="15" ry="3" fill="#493d69" opacity=".16"/><path d="M16 7h16v4h7v8h4v22h-4v8h-8v-5h-6v5h-7v-5h-6v5H7V19h4v-8h5z" fill="#4d3d6c"/><path d="M16 11h16v4h7v24h-4v6h-4v-5H15v5h-4V19h5z" fill="#fffaf0"/><path d="M32 15h7v24h-4v6h-4v-5h-7v-5h8z" fill="${safe}" opacity=".42"/><path d="M15 22h6v8h-6zm13 0h6v8h-6z" fill="#493860"/><path d="M17 22h2v3h-2zm13 0h2v3h-2z" fill="white"/><path d="M11 31h6v3h-6zm23 0h5v3h-5z" fill="#efa8bd"/><path d="M21 34h7v3h-7z" fill="${safe}"/>${hat ? `<path d="M10 11h30v5H10zm7-8h17v9H17z" fill="${safe}"/><path d="M17 9h17v3H17z" fill="#e8c864"/>` : ""}</svg>`;
}

export function auraSvg(color: string) {
  const safe = /^#[a-fA-F0-9]{6}$/.test(color) ? color : "#c2a0df";
  return ghostSvg(safe).replace(
    "</svg>",
    `<ellipse cx="24" cy="9" rx="20" ry="4" fill="none" stroke="${safe}" stroke-width="4" opacity=".2"/><ellipse cx="24" cy="9" rx="20" ry="4" fill="none" stroke="${safe}" stroke-width="1.5"/></svg>`,
  );
}

/** Default player look; a dropped-in art/player/explorer.(png|webp|svg) replaces it in 2D (art/README.md). */
export const STARTER_SPRITE = artUrl("player/explorer") || "/assets/aavegotchi-starter-1278fb922f4e.svg";
export const starterMarkerMarkup = () =>
  `<img class="starter-player" src="${STARTER_SPRITE}" alt="Aavegotchi starter appearance" draggable="false"/>`;

const WEARABLE_LAYER = ["body", "face", "eyes", "head", "hand", "pet"];
/** Public, catalogue-checked artwork route for an Aavegotchi wearable. */
export const wearableArtUrl = (id: number) =>
  Number.isSafeInteger(id) && id > 0 && id < 100000
    ? `/api/wearables/art/${id}.svg`
    : "";
/**
 * The starter Aavegotchi with wearable clones layered the way the Aavegotchi
 * contract does it: each item at its own x, y, width, height on the 64×64
 * canvas, in body → face → eyes → head → hand → pet order.
 */
export function wearableStarterMarkup(
  wearables: { id: number; slot: string; dims: number[] }[],
) {
  const layers = [...wearables]
    .filter(
      (w) =>
        wearableArtUrl(w.id) &&
        Array.isArray(w.dims) &&
        w.dims.length === 4 &&
        w.dims.every((n) => Number.isInteger(n) && n >= 0 && n <= 64),
    )
    .sort((a, b) => WEARABLE_LAYER.indexOf(a.slot) - WEARABLE_LAYER.indexOf(b.slot))
    .slice(0, 8)
    .map(
      (w) =>
        `<image href="${wearableArtUrl(w.id)}" x="${w.dims[0]}" y="${w.dims[1]}" width="${w.dims[2]}" height="${w.dims[3]}" preserveAspectRatio="none"/>`,
    )
    .join("");
  return `<svg class="starter-player" viewBox="8 4 48 54" role="img" aria-label="Aavegotchi starter with wearables"><image href="${STARTER_SPRITE}" x="8" y="4" width="48" height="54"/>${layers}</svg>`;
}

export function characterMarkerMarkup({
  above,
  below,
  aboveEdition,
  belowEdition,
  scale = 1,
  skinUrl,
  wearables,
}: {
  color?: string;
  above?: string | null;
  below?: string | null;
  /** Authored edition; known edition colors resolve on their own. */
  aboveEdition?: string | null;
  belowEdition?: string | null;
  /** Integer pixel scale of the Aura sprites (1 for small markers). */
  scale?: number;
  skinUrl?: string;
  /** Aavegotchi wearable clones on the starter (an original skin wears its own). */
  wearables?: { id: number; slot: string; dims: number[] }[];
}) {
  const safe = (value: string | undefined | null) =>
    /^#[a-fA-F0-9]{6}$/.test(value || "") ? value : null;
  const top = safe(above),
    bottom = safe(below),
    skin =
      skinUrl &&
      // &v= is the outfit tag (digits, dots and dashes), so a new outfit skips the cache.
      (/^\/api\/aavegotchi\/skin\?tokenId=\d{1,24}(&v=[0-9.-]{1,80})?$/.test(skinUrl) ||
        /^\/api\/(presence|players)\/skin\?playerId=player_[a-f0-9-]{36}(&v=[0-9.-]{1,80})?$/.test(skinUrl))
        ? skinUrl
        : null;
  const sprite = (slot: "above" | "below", color: string, edition?: string | null) =>
    `<div class="marker-aura ${slot === "above" ? "top" : "bottom"}" style="--aura-color:${color}">${auraMarkup(auraEdition({ edition, color }), slot, color, scale)}</div>`;
  return `${top ? sprite("above", top, aboveEdition) : ""}${skin ? `<img class="origin-player" src="${skin}" alt="Chosen original Aavegotchi appearance"/>` : wearables?.length ? wearableStarterMarkup(wearables) : starterMarkerMarkup()}${bottom ? sprite("below", bottom, belowEdition) : ""}`;
}
