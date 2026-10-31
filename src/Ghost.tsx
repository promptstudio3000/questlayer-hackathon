import { ghostSvg } from "./character-art";
export { ghostSvg } from "./character-art";
export function Ghost({
  color,
  hat = false,
  className = "",
}: {
  color?: string;
  hat?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`ghost-art ${className}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ghostSvg(color, hat) }}
    />
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
