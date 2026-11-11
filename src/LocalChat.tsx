import { useCallback, useState, type ComponentProps } from "react";
import { MapPin } from "@phosphor-icons/react";
import { MapNotes } from "./MapNotes";
import { PlaceMessages } from "./PlaceMessages";
import { tr } from "./i18n";
import "./local-chat.css";

/** How far Local chat reaches (Lubos, 11 Nov 2026: "filter by distance up to 100 km"). */
export const CHAT_RADII = [1, 3, 10, 25, 50, 100] as const;
const KEY = "questlayer:local-chat-km";
function savedRadius() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (CHAT_RADII as readonly number[]).includes(v) ? v : 10;
  } catch {
    return 10;
  }
}

/**
 * Community · Local chat (Lubos, 11 Nov 2026): one distance filter at the top,
 * the most active shouts and topics around you, then the chat itself (free
 * messages pinned where they were written, newest at the bottom).
 */
export function LocalChat({
  places,
  chat,
}: {
  places: Omit<ComponentProps<typeof PlaceMessages>, "radiusKm" | "onOpenChange">;
  chat: Omit<ComponentProps<typeof MapNotes>, "radiusKm" | "quick">;
}) {
  const [radiusKm, setRadiusState] = useState(savedRadius);
  const [focused, setFocused] = useState(false);
  const setRadius = (km: number) => {
    setRadiusState(km);
    try {
      localStorage.setItem(KEY, String(km));
    } catch {
      /* The choice lasts for this visit only. */
    }
  };
  const onOpenChange = useCallback((open: boolean) => setFocused(open), []);
  return (
    <div className="local-chat">
      <div className="local-chat-range" role="radiogroup" aria-label={tr("Show posts within")}>
        <MapPin size={18} weight="fill" aria-hidden="true" />
        {CHAT_RADII.map((km) => (
          <button
            type="button"
            key={km}
            role="radio"
            aria-checked={radiusKm === km}
            onClick={() => setRadius(km)}
          >
            {tr("{0} km", { 0: km })}
          </button>
        ))}
      </div>
      <PlaceMessages {...places} radiusKm={radiusKm} onOpenChange={onOpenChange} />
      <div hidden={focused}>
        <MapNotes {...chat} radiusKm={radiusKm} />
      </div>
    </div>
  );
}
