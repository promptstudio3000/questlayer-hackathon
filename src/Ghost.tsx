import { STARTER_SPRITE } from "./character-art";
export { ghostSvg } from "./character-art";
export function Ghost({
  className = "",
}: {
  color?: string;
  hat?: boolean;
  className?: string;
}) {
  return (
    <span className={`ghost-art ${className}`} aria-hidden="true">
      <img src={STARTER_SPRITE} alt="" draggable={false} />
    </span>
  );
}
export function AuraArt({
  color = "#9edfc5",
  slot = "above",
  small = false,
}: {
  color?: string;
  slot?: string;
  small?: boolean;
}) {
  return (
    <div
      className={`aura-art ${small ? "small" : ""}`}
      style={{ "--aura-color": color } as React.CSSProperties}
    >
      <div className={`aura-ring ${slot}`} />
      <Ghost color={color} />
      <i />
      <i />
      <i />
    </div>
  );
}
