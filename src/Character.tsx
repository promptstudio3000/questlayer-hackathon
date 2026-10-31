import { useEffect, useState } from "react";
import { Ghost } from "./Ghost";
import type { Item } from "./types";
export function Character({
  items,
  originTokenId,
  compact = false,
}: {
  items: Item[];
  originTokenId?: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [originTokenId]);
  const top = items.find((i) => i.equipped && i.slot === "above"),
    bottom = items.find((i) => i.equipped && i.slot === "below"),
    avatar = items.find((i) => i.kind === "avatar");
  return (
    <div
      className={`character-composition ${compact ? "compact" : ""}`}
      aria-label="Equipped character appearance"
    >
      {bottom && (
        <i
          className="character-aura below"
          style={{ "--aura-color": bottom.color } as React.CSSProperties}
        />
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
        />
      )}
      {failed && !compact && <small>Original appearance unavailable</small>}
    </div>
  );
}
