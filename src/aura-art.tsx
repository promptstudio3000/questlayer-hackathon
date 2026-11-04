import {
  AURA_GRIDS,
  auraArtUrl,
  auraRects,
  auraScale,
  auraSlot,
  isAuraEdition,
} from "./aura-art-data";
import "./aura-art.css";
export * from "./aura-art-data";

/**
 * Authored pixel-art Aura sprite. `size` is an integer scale on the 48x24
 * (`above`) or 56x20 (`below`) grid. Unknown editions get the generic design
 * tinted by `color`. Motion is CSS only (transform/opacity) and pauses under
 * prefers-reduced-motion.
 */
export function AuraSprite({
  edition,
  slot = "above",
  color,
  size = 1,
  animated = true,
  label,
  className = "",
}: {
  edition?: string | null;
  slot?: string | null;
  color?: string | null;
  size?: number;
  animated?: boolean;
  label?: string;
  className?: string;
}) {
  const resolvedSlot = auraSlot(slot),
    grid = AURA_GRIDS[resolvedSlot],
    scale = auraScale(size),
    rects = auraRects({ edition, slot: resolvedSlot, color }),
    art = auraArtUrl(edition, resolvedSlot);
  if (art)
    return (
      <img
        className={`aura-sprite aura-sprite-${resolvedSlot} aura-sprite-art ${animated ? "animated" : ""} ${className}`}
        src={art}
        width={grid.width * scale}
        height={grid.height * scale}
        alt={label || ""}
        aria-hidden={label ? undefined : true}
        draggable={false}
        data-aura-edition={edition || "generic"}
        data-aura-slot={resolvedSlot}
      />
    );
  const paint = (frame?: "a" | "b") =>
    rects
      .filter((r) => r.frame === frame)
      .map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={r.color}
          fillOpacity={r.opacity}
        />
      ));
  return (
    <svg
      className={`aura-sprite aura-sprite-${resolvedSlot} ${animated ? "animated" : ""} ${className}`}
      width={grid.width * scale}
      height={grid.height * scale}
      viewBox={`0 0 ${grid.width} ${grid.height}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-aura-edition={isAuraEdition(edition) ? edition : "generic"}
      data-aura-slot={resolvedSlot}
    >
      {paint()}
      <g className="aura-frame aura-frame-a">{paint("a")}</g>
      <g className="aura-frame aura-frame-b">{paint("b")}</g>
    </svg>
  );
}
