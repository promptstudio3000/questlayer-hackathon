import type { KeyboardEvent } from "react";

/** Native overflow remains draggable; focused regions also scroll consistently in WebKit. */
export function scrollRegionKeys(event: KeyboardEvent<HTMLElement>) {
  const region = event.currentTarget;
  if (event.target !== region || event.altKey || event.ctrlKey || event.metaKey) return;
  const extent = region.scrollWidth - region.clientWidth;
  if (extent <= 1) return;
  const rtl = getComputedStyle(region).direction === "rtl";
  const end = rtl ? -extent : extent;
  const next = event.key === "ArrowRight" ? region.scrollLeft + 120
    : event.key === "ArrowLeft" ? region.scrollLeft - 120
    : event.key === "Home" ? 0
    : event.key === "End" ? end : null;
  if (next === null) return;
  event.preventDefault();
  region.scrollTo({ left: Math.max(rtl ? end : 0, Math.min(rtl ? 0 : end, next)), behavior: "auto" });
}
