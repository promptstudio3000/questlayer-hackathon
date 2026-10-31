import { useEffect, useState } from "react";
import { Ghost } from "./Ghost";
import { AuraSprite, auraEdition } from "./aura-art";
import type { Item } from "./types";
export function Character({
  items,
  originTokenId,
  compact = false,
  preview = false,
}: {
  items: Item[];
  originTokenId?: string;
  compact?: boolean;
  preview?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [originTokenId]);
  const top = items.find((i) => i.equipped && i.slot === "above"),
    bottom = items.find((i) => i.equipped && i.slot === "below"),
    avatar = items.find((i) => i.kind === "avatar");
  return (
    <div
      className={`character-composition ${compact ? "compact" : ""}`}
      aria-label={
        preview
          ? "Preview of explorer appearance"
          : "Equipped character appearance"
      }
    >
      {bottom && (
        <i
          className="character-aura below"
          style={{ "--aura-color": bottom.color } as React.CSSProperties}
        >
          <AuraSprite
            edition={auraEdition(bottom)}
            slot="below"
            color={bottom.color}
            size={compact ? 1 : 2}
          />
        </i>
      )}
      {originTokenId && !failed ? (
        <img
          src={`/api/aavegotchi/skin?tokenId=${encodeURIComponent(originTokenId)}`}
          alt="Verified original Aavegotchi"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ghost color={avatar?.color} />
      )}
      {top && (
        <i
          className="character-aura above"
          style={{ "--aura-color": top.color } as React.CSSProperties}
        >
          <AuraSprite
            edition={auraEdition(top)}
            slot="above"
            color={top.color}
            size={compact ? 1 : 2}
          />
        </i>
      )}
      {failed && !compact && <small>Original appearance unavailable</small>}
    </div>
  );
}
