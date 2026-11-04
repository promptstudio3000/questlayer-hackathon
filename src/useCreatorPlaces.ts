import { useEffect, useState } from "react";
import type { CreatorMapPlace } from "./GameMap";
import type {
  CreatorPage,
  PublicCreatorQuest,
} from "./creator-community-types";

const REFRESH_MS = 120_000;

/** Published creator places for the map; empty when creator quests are off. */
export function creatorMapPlaces(
  quests: PublicCreatorQuest[],
): CreatorMapPlace[] {
  return quests.flatMap((q) => {
    const first = q.place?.points[0];
    if (!q.place || !first) return [];
    return [
      {
        questId: q.id,
        title: q.title,
        template: q.place.template,
        lat: first.lat,
        lng: first.lng,
      },
    ];
  });
}

export function useCreatorPlaces(playerId: string | null): CreatorMapPlace[] {
  const [places, setPlaces] = useState<CreatorMapPlace[]>([]);
  useEffect(() => {
    setPlaces([]);
    if (!playerId) return;
    let controller = new AbortController();
    const load = async () => {
      controller.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/creator-community/quests?limit=50", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const page = (await response.json()) as CreatorPage<PublicCreatorQuest>;
        if (Array.isArray(page?.items)) setPlaces(creatorMapPlaces(page.items));
      } catch {
        // Off, offline or aborted: keep the last known places.
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [playerId]);
  return places;
}
