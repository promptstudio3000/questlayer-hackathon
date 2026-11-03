import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Point } from "./types";
import type { NativeGameState } from "./native-game-types";
import { createNativeRefreshQueue } from "./native-refresh-queue";
import { tr } from "./i18n.ts";
export function useNativeGame(
  enabled: boolean,
  playerId: string | undefined,
  account: string,
  position: Point,
) {
  const [snapshot, setSnapshot] = useState<{
      owner: string;
      data: NativeGameState;
    } | null>(null),
    [failure, setFailure] = useState<{ owner: string; message: string } | null>(
      null,
    );
  const key = `${playerId || ""}:${account}`;
  const latest = useRef({ key, playerId, account, position, enabled });
  latest.current = { key, playerId, account, position, enabled };
  const generation = useRef(0);
  const queue = useRef<ReturnType<typeof createNativeRefreshQueue> | null>(
    null,
  );
  if (!queue.current) {
    queue.current = createNativeRefreshQueue(async (context, fresh) => {
      const current = latest.current;
      const run = generation.current;
      if (
        !current.enabled ||
        !current.playerId ||
        context !== `${run}:${current.key}`
      )
        return;
      try {
        const data = await api<NativeGameState>("/native/rewards/nearby", {
          accountId: current.account || undefined,
          location: current.position,
          fresh,
        });
        if (
          run === generation.current &&
          latest.current.key === current.key &&
          latest.current.enabled
        ) {
          setSnapshot({ owner: current.key, data });
          setFailure(null);
        }
      } catch (error) {
        if (
          run === generation.current &&
          latest.current.key === current.key &&
          latest.current.enabled
        ) {
          setFailure({
            owner: current.key,
            message:
              error instanceof Error
                ? error.message
                : tr("Native adventures could not be refreshed."),
          });
          setSnapshot(null);
        }
      }
    });
  }
  const refresh = useCallback((fresh = false): Promise<void> => {
    const current = latest.current;
    if (!current.enabled || !current.playerId) return Promise.resolve();
    return queue.current!.request(
      `${generation.current}:${current.key}`,
      fresh,
    );
  }, []);
  useEffect(() => {
    generation.current++;
    setSnapshot(null);
    setFailure(null);
    if (!enabled || !playerId) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10000);
    const show = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", show);
    return () => {
      generation.current++;
      queue.current?.cancelPending();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", show);
    };
  }, [enabled, playerId, account, refresh]);
  return {
    state: enabled && snapshot?.owner === key ? snapshot.data : null,
    error: enabled && failure?.owner === key ? failure.message : "",
    refresh,
  };
}
