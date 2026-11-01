// Share card PNG for an earned Aura: the explorer's ghost wearing both Aura
// slots, the Aura name and its edition line. Drawn on a canvas from the
// game's own self-authored art (ghostSvg + auraRects); no dependency, no
// third-party media.
import { STARTER_SPRITE, ghostSvg } from "./character-art.ts";
import {
  AURA_EDITION_NAMES,
  AURA_GRIDS,
  auraEdition,
  auraRects,
  type AuraSlot,
} from "./aura-art-data.ts";
import type { Item } from "./types.ts";

export const SHARE_CARD = { width: 1080, height: 1350 } as const;

export type ShareCardInput = {
  explorer: string;
  item: Pick<Item, "name" | "slot" | "color" | "serial"> &
    Partial<Pick<Item, "native_claim_state">>;
  /** Items worn with it; the new Aura replaces whatever was in its slot. */
  outfit: Item[];
  ghostColor?: string;
  place?: string | null;
  secured: boolean;
};

/** "Northern Lights edition · #12 · worn above". Pure, for tests and alt text. */
export function editionLine(item: ShareCardInput["item"]): string {
  const edition = auraEdition(item);
  const parts = [
    edition
      ? AURA_EDITION_NAMES[edition] === item.name
        ? "Limited edition"
        : `${AURA_EDITION_NAMES[edition]} edition`
      : "Explorer Aura",
    item.serial === null || item.serial === undefined ? null : `#${item.serial}`,
    item.slot === "below" ? "worn below" : "worn above",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function shareText(input: ShareCardInput): string {
  return `${input.explorer} found ${input.item.name} on a QuestLayer walk${
    input.place ? ` in ${input.place}` : ""
  }.`;
}

export function shareFileName(item: { name: string; serial: number | null }) {
  const slug = item.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `questlayer-${slug || "aura"}${item.serial == null ? "" : `-${item.serial}`}.png`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error("The card art could not be drawn."));
    img.src = src;
  });
}
// The same explorer sprite the map and the reward sheet show; the
// self-authored ghost is the fallback when the sprite cannot load.
async function explorerImage(color?: string) {
  try {
    return await loadImage(STARTER_SPRITE);
  } catch {
    return loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ghostSvg(color))}`,
    );
  }
}

function drawAura(
  ctx: CanvasRenderingContext2D,
  item: { name: string; color: string },
  slot: AuraSlot,
  cx: number,
  top: number,
  scale: number,
) {
  const grid = AURA_GRIDS[slot];
  const left = Math.round(cx - (grid.width * scale) / 2);
  for (const r of auraRects({
    edition: auraEdition(item),
    slot,
    color: item.color,
  })) {
    if (r.frame === "b") continue; // one still frame of the twinkle
    ctx.globalAlpha = r.opacity ?? 1;
    ctx.fillStyle = r.color;
    ctx.fillRect(left + r.x * scale, top + r.y * scale, r.width * scale, scale);
  }
  ctx.globalAlpha = 1;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight = 700,
) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px Kanit, system-ui, sans-serif`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 20);
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const { width: W, height: H } = SHARE_CARD;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  try {
    await document.fonts?.load("700 64px Kanit");
  } catch {}

  // Paper background with a soft discovery glow.
  ctx.fillStyle = "#fcfaff";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 560, 40, W / 2, 560, 520);
  glow.addColorStop(0, "#f2ebff");
  glow.addColorStop(1, "#fcfaff");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#d7cbe9";
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  // Wordmark.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 44px Kanit, system-ui, sans-serif";
  ctx.fillStyle = "#1a0335";
  ctx.fillText("QUEST", 84, 130);
  const questW = ctx.measureText("QUEST").width;
  ctx.font = "400 44px Kanit, system-ui, sans-serif";
  ctx.fillStyle = "#806a99";
  ctx.fillText("LAYER", 84 + questW, 130);

  // Explorer: the new Aura goes into its slot, the other slot keeps what is worn.
  const slot: AuraSlot = input.item.slot === "below" ? "below" : "above";
  const other = input.outfit.find(
    (i) => i.equipped && i.kind === "aura" && i.slot !== slot,
  );
  const above = slot === "above" ? input.item : other?.slot === "above" ? other : null;
  const below = slot === "below" ? input.item : other?.slot === "below" ? other : null;
  const scale = 10,
    ghostW = 48 * scale,
    ghostH = 54 * scale,
    cx = W / 2,
    ghostTop = 330;
  if (below) drawAura(ctx, below, "below", cx, ghostTop + ghostH - 140, scale);
  const ghost = await explorerImage(input.ghostColor);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ghost, cx - ghostW / 2, ghostTop, ghostW, ghostH);
  if (above) drawAura(ctx, above, "above", cx, ghostTop - 165, scale);

  // Text block.
  ctx.textAlign = "center";
  ctx.fillStyle = "#1a0335";
  fitText(ctx, input.item.name, W - 200, 84);
  ctx.fillText(input.item.name, cx, 1000);
  ctx.font = "400 38px Kanit, system-ui, sans-serif";
  ctx.fillStyle = "#665577";
  ctx.fillText(editionLine(input.item), cx, 1060);
  fitText(ctx, `Found by ${input.explorer}${input.place ? ` in ${input.place}` : ""}`, W - 200, 40, 500);
  ctx.fillStyle = "#1a0335";
  ctx.fillText(
    `Found by ${input.explorer}${input.place ? ` in ${input.place}` : ""}`,
    cx,
    1130,
  );

  // Status pill.
  const pill = input.secured ? "Secured · yours outside the game" : "Earned on a real walk";
  ctx.font = "600 32px Kanit, system-ui, sans-serif";
  const pw = ctx.measureText(pill).width + 64;
  ctx.fillStyle = input.secured ? "#e3f6ee" : "#f2ebff";
  ctx.beginPath();
  ctx.roundRect(cx - pw / 2, 1170, pw, 64, 32);
  ctx.fill();
  ctx.fillStyle = input.secured ? "#176553" : "#672eeb";
  ctx.fillText(pill, cx, 1213);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("The card could not be saved."))),
      "image/png",
    ),
  );
}

/** Native share sheet with the PNG when the device supports it, download otherwise. */
export async function shareCard(input: ShareCardInput): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await renderShareCard(input);
  const name = shareFileName(input.item);
  const file = new File([blob], name, { type: "image/png" });
  const data = { files: [file], title: input.item.name, text: shareText(input) };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
