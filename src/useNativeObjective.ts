import { useEffect, useMemo, useState } from "react";
import type { Player } from "./types";
import type { NativeGameState } from "./native-game-types";
import {
  makeNativeObjective,
  nativeAccountKey,
  nativeObjectiveKey,
  parseNativeObjective,
  resolveNativeObjective,
  restoreNativeAccount,
  type NativeObjective,
} from "./native-objective";

export function useNativePlayAccount(player: Player | null) {
  const playerId = player?.id || "";
  const linked = player?.wallets.map((w) => w.account_id) || [];
  const linkedIdentity = JSON.stringify(linked);
  const [choice, setChoice] = useState({ playerId: "", account: "" });
  useEffect(() => {
    let raw: string | null = null;
    try {
      if (playerId) raw = localStorage.getItem(nativeAccountKey(playerId));
    } catch {
      /* A session can still choose a linked account. */
    }
    setChoice({
      playerId,
      account: restoreNativeAccount(raw, JSON.parse(linkedIdentity)),
    });
  }, [playerId, linkedIdentity]);
  const ready =
    !!playerId &&
    choice.playerId === playerId &&
    (choice.account ? linked.includes(choice.account) : linked.length === 0);
  const account = ready ? choice.account : "";
  const select = (next: string) => {
    if (!playerId || !linked.includes(next)) return;
    setChoice({ playerId, account: next });
    try {
      localStorage.setItem(nativeAccountKey(playerId), next);
    } catch {
      /* Persistence is optional for manual play. */
    }
  };
  return { ready, account, select };
}

export function useNativeObjective(
  playerId: string | undefined,
  accountId: string,
  accountReady: boolean,
  state: NativeGameState | null,
  error: string,
  now: number,
) {
  const owner =
    playerId && accountReady
      ? nativeObjectiveKey(playerId, accountId || null)
      : "";
  const [saved, setSaved] = useState<{
    owner: string;
    reference: NativeObjective | null;
  }>({ owner: "", reference: null });
  useEffect(() => {
    let reference: NativeObjective | null = null;
    try {
      if (owner && playerId)
        reference = parseNativeObjective(
          localStorage.getItem(owner),
          playerId,
          accountId || null,
        );
    } catch {
      /* Keep in-memory navigation usable. */
    }
    setSaved({ owner, reference });
  }, [owner, playerId, accountId]);
  const reference = saved.owner === owner && owner ? saved.reference : null;
  useEffect(() => {
    if (!owner || saved.owner !== owner) return;
    try {
      if (saved.reference)
        localStorage.setItem(owner, JSON.stringify(saved.reference));
      else localStorage.removeItem(owner);
    } catch {
      /* A bookmark never gates a manually requested visit. */
    }
  }, [owner, saved]);
  const view = resolveNativeObjective(
    reference,
    playerId || "",
    accountId || null,
    state,
    error,
    now,
  );
  // A clock tick or unchanged refresh must not recreate the map marker or start
  // another camera movement. Only changed authoritative coordinates/text do so.
  const target = useMemo(
    () => view.target,
    [view.target?.lat, view.target?.lng, view.target?.label],
  );
  function select(kind: "coin" | "quest", index: number) {
    if (!owner || !playerId) return;
    const next = makeNativeObjective(
      playerId,
      accountId || null,
      state,
      kind,
      index,
      now,
    );
    if (next) setSaved({ owner, reference: next });
  }
  return {
    ready: !!owner && saved.owner === owner,
    reference,
    view: { ...view, target },
    select,
    restore: (value: NativeObjective) => {
      if (!owner || !playerId) return;
      const parsed = parseNativeObjective(
        JSON.stringify(value),
        playerId,
        accountId || null,
      );
      if (parsed) setSaved({ owner, reference: parsed });
    },
    canSelect: (kind: "coin" | "quest", index: number) =>
      !!owner &&
      !!playerId &&
      !!makeNativeObjective(
        playerId,
        accountId || null,
        state,
        kind,
        index,
        now,
      ),
    clear: () => setSaved({ owner, reference: null }),
  };
}
