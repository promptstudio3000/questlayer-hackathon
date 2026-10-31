import { useEffect, useState } from "react";
import type { World, Zone } from "./types";
import {
  adventureStorageKey,
  parseAdventureSelection,
  resolveAdventureSelection,
  type AdventureSelection,
} from "./adventure-selection";

export function useAdventureSelection(
  playerId: string | undefined,
  world: World | null,
  arena: boolean,
  nativePlay: boolean,
  now: number,
) {
  const key = playerId ? adventureStorageKey(playerId, arena) : "";
  const [saved, setSaved] = useState<{
    key: string;
    reference: AdventureSelection | null;
  }>({ key: "", reference: null });
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let reference: AdventureSelection | null = null;
    if (key && playerId) {
      try {
        reference = parseAdventureSelection(
          localStorage.getItem(key),
          playerId,
          arena,
        );
      } catch {
        /* Navigation remains usable when browser storage is unavailable. */
      }
    }
    setSaved({ key, reference });
    setNotice("");
  }, [key, playerId, arena]);
  const reference = saved.key === key ? saved.reference : null;
  const resolved = resolveAdventureSelection(
    reference,
    world,
    playerId || "",
    arena,
    now,
  );
  useEffect(() => {
    if (saved.key !== key || !key) return;
    try {
      if (saved.reference)
        localStorage.setItem(key, JSON.stringify(saved.reference));
      else localStorage.removeItem(key);
    } catch {
      /* A storage failure must not block an adventure. */
    }
  }, [key, saved]);
  useEffect(() => {
    if (resolved.status !== "unavailable" || nativePlay) return;
    setSaved({ key, reference: null });
    setNotice("Your previous adventure is no longer available.");
  }, [key, resolved.status, nativePlay]);
  function select(zone: Zone | null, questId: string | null = null) {
    if (!zone) {
      setSaved({ key, reference: null });
      setNotice("");
      return;
    }
    if (!key || !playerId || !world || world.arena !== arena || nativePlay)
      return;
    const next: AdventureSelection = {
      version: 1,
      playerId,
      realm: arena ? "arena" : "gps",
      worldId: world.id,
      zoneId: zone.id,
      questId,
    };
    if (
      resolveAdventureSelection(next, world, playerId, arena, now).status !==
      "ready"
    )
      return;
    setSaved({ key, reference: next });
    setNotice("");
  }
  return {
    ready: !!key && saved.key === key,
    reference,
    selected: nativePlay ? null : resolved.zone,
    selectedQuestId: nativePlay ? null : resolved.quest?.id || null,
    select,
    notice: nativePlay ? "" : notice,
    dismissNotice: () => setNotice(""),
  };
}
