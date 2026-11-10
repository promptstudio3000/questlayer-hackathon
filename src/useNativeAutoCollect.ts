import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type {
  createNativeAutoCollector,
  NativeAutoConfirmed,
  NativeAutoInput,
  NativeAutoView,
} from "./native-autocollect";
import type { NativeReceipt } from "./native-game-types";
import { tr } from "./i18n.ts";

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
    message: tr("Collect as you walk is off"),
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
  // The collector loads once there is an explorer, never on the welcome
  // screen (phone budget); a switch made before it arrives is applied then.
  const wanted = useRef<boolean | null>(null);
  const ready = !!input.playerId;
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let stop = () => {};
    void import("./native-autocollect").then(({ createNativeAutoCollector }) => {
      if (!disposed) stop = start(createNativeAutoCollector);
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [sync, ready]);
  function start(create: typeof createNativeAutoCollector) {
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      /* The manual collect action remains available. */
    }
    const instance = create({
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
    if (wanted.current !== null) instance.setEnabled(wanted.current);
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
  }
  useEffect(sync);
  const setEnabled = useCallback(
    (enabled: boolean) => {
      sync();
      wanted.current = enabled;
      controller.current?.setEnabled(enabled);
      void controller.current?.tick();
    },
    [sync],
  );
  return { ...view, setEnabled };
}
