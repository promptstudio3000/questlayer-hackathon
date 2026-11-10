import { useEffect, useState } from "react";
import { Ghost } from "./Ghost";
import { AuraSprite, auraEdition } from "./aura-art";
import { activeAuraSet } from "./aura-catalog.ts";
import type { Item } from "./types";
import { tr } from "./i18n";
export function Character({
  items,
  originTokenId,
  look,
  compact = false,
  preview = false,
}: {
  items: Item[];
  originTokenId?: string;
  /** Outfit tag of the worn gotchi (Player.appearance.look). */
  look?: string;
  compact?: boolean;
  preview?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [originTokenId]);
  const top = items.find((i) => i.equipped && i.slot === "above"),
    bottom = items.find((i) => i.equipped && i.slot === "below"),
    avatar = items.find((i) => i.kind === "avatar"),
    // Cosmetic only: a matching pair adds a set glow, nothing else.
    set = activeAuraSet(
      top && { edition: auraEdition(top) },
      bottom && { edition: auraEdition(bottom) },
    );
  return (
    <div
      className={`character-composition ${compact ? "compact" : ""} ${set ? `aura-set aura-set-${set.id}` : ""}`}
      style={
        set ? ({ "--aura-set-glow": set.glow } as React.CSSProperties) : undefined
      }
      data-aura-set={set?.id}
      role="img"
      aria-label={
        preview
          ? tr("Preview of explorer appearance")
          : tr("Equipped character appearance")
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
          src={`/api/aavegotchi/skin?tokenId=${encodeURIComponent(originTokenId)}${look ? `&v=${encodeURIComponent(look)}` : ""}`}
          alt={tr("Verified original Aavegotchi")}
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
      {failed && !compact && <small>{tr("Original appearance unavailable")}</small>}
    </div>
  );
}
