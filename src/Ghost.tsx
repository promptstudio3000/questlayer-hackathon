import { AuraSprite, auraEdition } from "./aura-art";
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
  name,
  edition,
}: {
  color?: string;
  slot?: string;
  small?: boolean;
  name?: string | null;
  edition?: string | null;
}) {
  // Catalog editions show their authored sprite; anything else keeps the
  // tinted ring so unknown or historical items still render.
  const authored = name || edition ? auraEdition({ name, edition, color }) : null;
  return (
    <div
      className={`aura-art ${small ? "small" : ""} ${authored ? "authored" : ""}`}
      style={{ "--aura-color": color } as React.CSSProperties}
    >
      {authored ? (
        <AuraSprite
          className={`aura-art-sprite ${slot === "below" ? "below" : "above"}`}
          edition={authored}
          slot={slot}
          color={color}
          size={small ? 1 : 2}
        />
      ) : (
        <div className={`aura-ring ${slot}`} />
      )}
      <Ghost color={color} />
      <i />
      <i />
      <i />
    </div>
  );
}
