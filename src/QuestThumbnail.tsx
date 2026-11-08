import { useState } from "react";
import type { Quest } from "./types";
import { GameObjectArt, questObjectPresentation } from "./game-object-art";
import { mapKitUrl, questPinKind } from "./map-kit";

/** Shared activity artwork; a missing file falls back to the existing game art. */
export function QuestThumbnail({
  quest,
  now,
  playerTier,
  size = 48,
}: {
  quest?: Quest;
  now: number;
  playerTier: number;
  size?: number;
}) {
  const src = mapKitUrl(`quests/${questPinKind(quest)}.png`);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className="quest-thumbnail"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {failed === src ? (
        <GameObjectArt
          {...(quest
            ? questObjectPresentation(quest, { now, playerTier })
            : { kind: "discovery" as const })}
          size={size}
        />
      ) : (
        <img
          src={src}
          width={size}
          height={size}
          alt=""
          draggable={false}
          onError={() => setFailed(src)}
        />
      )}
    </span>
  );
}
