import {
  gameObjectRects,
  GAME_OBJECT_GRID,
  type GameObjectOptions,
} from "./game-object-art-data";
import { artUrl } from "./art-registry";
import "./game-object-art.css";
export * from "./game-object-art-data";

export function GameObjectArt({
  kind,
  state = "ready",
  selected = false,
  size = 32,
  label,
  className = "",
}: GameObjectOptions & { size?: number; label?: string; className?: string }) {
  const art = gameObjectArtUrl(kind, state);
  if (art)
    return (
      <img
        className={`game-object-art game-object-art-img${sharedArt(kind, state) ? " shared-state" : ""} ${className}`}
        src={art}
        width={size}
        height={size}
        alt={label || ""}
        aria-hidden={label ? undefined : true}
        draggable={false}
        data-object-kind={kind}
        data-object-state={state}
        data-object-selected={selected || undefined}
      />
    );
  return (
    <svg
      className={`game-object-art ${className}`}
      width={size}
      height={size}
      viewBox={`0 0 ${GAME_OBJECT_GRID} ${GAME_OBJECT_GRID}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-object-kind={kind}
      data-object-state={state}
      data-object-selected={selected || undefined}
    >
      {gameObjectRects({ kind, state, selected }).map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={r.color}
        />
      ))}
    </svg>
  );
}
/** A dropped-in object image (art/objects/<kind>-<state> or art/objects/<kind>), or null for the pixel art. */
export function gameObjectArtUrl(kind: string, state = "ready") {
  return artUrl(`objects/${kind}-${state}`, `objects/${kind}`);
}
/** True when only the kind's base image exists, so CSS dims it for the locked/completed states. */
const sharedArt = (kind: string, state: string) => !artUrl(`objects/${kind}-${state}`);
export function gameObjectMarkup(options: GameObjectOptions) {
  const { kind, state = "ready", selected = false } = options;
  const art = gameObjectArtUrl(kind, state);
  if (art)
    return `<img class="game-object-art game-object-art-img${sharedArt(kind, state) ? " shared-state" : ""}" src="${art}" width="32" height="32" alt="" aria-hidden="true" draggable="false" data-object-kind="${kind}" data-object-state="${state}" data-object-selected="${selected}"/>`;
  const rects = gameObjectRects(options)
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${r.color}"/>`,
    )
    .join("");
  return `<svg class="game-object-art" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true" focusable="false" data-object-kind="${kind}" data-object-state="${state}" data-object-selected="${selected}">${rects}</svg>`;
}
