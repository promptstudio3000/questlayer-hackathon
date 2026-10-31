import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { createNativeAutoCollector } from "./native-autocollect";
import type {
  NativeAutoConfirmed,
  NativeAutoInput,
  NativeAutoView,
} from "./native-autocollect";
import type { NativeReceipt } from "./native-game-types";

type Input = Omit<NativeAutoInput, "visible" | "online"> & {
  refresh: (fresh?: boolean) => Promise<void>;
  onConfirmed?: (delta: NativeAutoConfirmed) => void;
};

/** No GPS request and no wallet operation is started by this hook. */
export function useNativeAutoCollect(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const controller = useRef<ReturnType<
    typeof createNativeAutoCollector
  > | null>(null);
  const [view, setView] = useState<NativeAutoView>({
    enabled: false,
    status: "off",
    message: "Collect as you walk is off",
    pending: 0,
    retryAt: null,
    confirmed: { count: 0, amount: "0", xp: 0 },
  });
  const sync = useCallback(() => {
    controller.current?.update({
      ...latest.current,
      visible: !document.hidden,
      online: navigator.onLine,
    });
  }, []);
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      /* The manual collect action remains available. */
    }
    const instance = createNativeAutoCollector({
      storage,
      submit: async (request): Promise<NativeReceipt> => {
        const abort = new AbortController();
        const timeout = window.setTimeout(() => abort.abort(), 20000);
        try {
          const response = await fetch("/api/native/rewards/visit", {
            method: "POST",
            credentials: "same-origin",
            signal: abort.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          });
          const result = await response.json();
          if (!response.ok)
            throw new ApiError(
              result.error || "The native visit could not be recorded.",
              result.code,
              response.status,
            );
          return result as NativeReceipt;
        } finally {
          window.clearTimeout(timeout);
        }
      },
      refresh: () => latest.current.refresh(true),
      onChange: setView,
      onConfirmed: (delta) => latest.current.onConfirmed?.(delta),
    });
    controller.current = instance;
    const run = () => {
      sync();
      void instance.tick();
    };
    sync();
    const timer = window.setInterval(run, 1000);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("online", run);
    window.addEventListener("offline", run);
    return () => {
      instance.dispose();
      controller.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", run);
    };
  }, [sync]);
  useEffect(sync);
  const setEnabled = useCallback(
    (enabled: boolean) => {
      sync();
      controller.current?.setEnabled(enabled);
      void controller.current?.tick();
    },
    [sync],
  );
  return { ...view, setEnabled };
}
