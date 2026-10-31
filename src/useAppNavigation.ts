import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  createAppNavigationHistory,
  initialAppNavigation,
  parseAppNavigation,
  type AppNavigation,
} from "./app-navigation";
import {
  clearClosedDialogMarker,
  consumeNormalDialogClose,
  dialogHistoryActive,
} from "./dialog-history";

export function useAppNavigation(playerId: string | undefined) {
  const [state, setState] = useState({
    owner: "",
    value: initialAppNavigation(),
    restored: false,
    restoreRevision: 0,
  });
  const journal = useRef<ReturnType<typeof createAppNavigationHistory> | null>(
    null,
  );
  const latest = useRef(state);
  latest.current = state;
  const mode = useRef<"push" | "replace">("push");
  useEffect(() => {
    if (!playerId) {
      journal.current = null;
      return;
    }
    const j = createAppNavigationHistory(history, playerId);
    journal.current = j;
    setState((previous) => ({
      owner: playerId,
      value: j.initial || initialAppNavigation(),
      restored: !!j.initial,
      restoreRevision: previous.restoreRevision + 1,
    }));
    const pop = (event: PopStateEvent) => {
      if (journal.current !== j) return;
      const value = j.restore(event.state);
      if (consumeNormalDialogClose()) {
        clearClosedDialogMarker();
        const current =
          latest.current.owner === playerId ? latest.current.value : value;
        j.write(
          current,
          JSON.stringify(current) === JSON.stringify(value)
            ? "replace"
            : "push",
        );
        return;
      }
      const returningFromModal =
        !!document.querySelector("dialog[open]") &&
        JSON.stringify(latest.current.value) === JSON.stringify(value);
      setState((previous) => ({
        owner: playerId,
        value,
        restored: true,
        restoreRevision: previous.restoreRevision + 1,
      }));
      requestAnimationFrame(() => {
        if (returningFromModal) return;
        if (document.querySelector("dialog[open]")) return;
        clearClosedDialogMarker();
        const focus =
          [...document.querySelectorAll<HTMLElement>("main h1")].find(
            (heading) => heading.getClientRects().length > 0,
          ) || document.querySelector<HTMLElement>("main");
        focus?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (journal.current === j) journal.current = null;
    };
  }, [playerId]);
  const ready = !!playerId && state.owner === playerId;
  const value = ready ? state.value : initialAppNavigation();
  const signature = JSON.stringify(value);
  useEffect(() => {
    if (!ready || !journal.current || dialogHistoryActive()) return;
    journal.current.write(value, mode.current);
    mode.current = "push";
  }, [ready, signature]);
  function update(
    patch: Partial<AppNavigation>,
    writeMode: "push" | "replace" = "push",
  ) {
    if (!playerId) return;
    mode.current = writeMode;
    setState((previous) => {
      const base =
        previous.owner === playerId ? previous.value : initialAppNavigation();
      const next = parseAppNavigation({ ...base, ...patch }, playerId);
      return next ? { ...previous, owner: playerId, value: next } : previous;
    });
  }
  function setter<K extends keyof AppNavigation>(name: K) {
    return (next: SetStateAction<AppNavigation[K]>) => {
      if (!playerId) return;
      mode.current = "push";
      setState((previous) => {
        const base =
          previous.owner === playerId ? previous.value : initialAppNavigation();
        const field =
          typeof next === "function"
            ? (next as (value: AppNavigation[K]) => AppNavigation[K])(
                base[name],
              )
            : next;
        const parsed = parseAppNavigation({ ...base, [name]: field }, playerId);
        return parsed
          ? { ...previous, owner: playerId, value: parsed }
          : previous;
      });
    };
  }
  return {
    ...value,
    ready,
    restored: state.restored,
    restoreRevision: state.restoreRevision,
    update,
    setter,
  };
}
