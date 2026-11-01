import { useEffect, useRef, useState } from "react";
import { gold } from "./api";
import {
  createPickupFeedback,
  emptyPickupTotals,
  type PickupConfirmation,
} from "./pickup-feedback";

export function usePickupFeedback(scope: string, blocked: boolean) {
  const latest = useRef({ scope, blocked });
  latest.current = { scope, blocked };
  const controller = useRef(createPickupFeedback(scope));
  const [view, setView] = useState({
    scope,
    totals: emptyPickupTotals(),
    announcement: "",
  });
  useEffect(() => {
    if (controller.current.scope !== scope)
      controller.current = createPickupFeedback(scope);
    const totals = controller.current.snapshot();
    setView((previous) => ({
      scope,
      totals,
      announcement: previous.scope === scope ? previous.announcement : "",
    }));
  }, [scope]);
  useEffect(() => {
    if (blocked) {
      controller.current.quiet();
      setView((previous) => ({ ...previous, announcement: "" }));
    }
  }, [blocked]);
  useEffect(() => {
    const quiet = () => {
      controller.current.quiet();
      setView((previous) => ({ ...previous, announcement: "" }));
    };
    const timer = setInterval(() => {
      const current = latest.current;
      if (controller.current.scope !== current.scope) return;
      const batch = controller.current.flush(
        Date.now(),
        !current.blocked &&
          !document.hidden &&
          !document.querySelector("dialog[open]") &&
          navigator.onLine,
      );
      if (batch) {
        const total = controller.current.snapshot().count;
        setView((previous) =>
          previous.scope === current.scope
            ? {
                ...previous,
                announcement: `${batch.count} ${batch.count === 1 ? "coin" : "coins"}: ${gold(batch.amount, 6)} practice GOLD and ${batch.xp} XP confirmed. ${total} this session.`,
              }
            : previous,
        );
      }
    }, 300);
    document.addEventListener("visibilitychange", quiet);
    window.addEventListener("offline", quiet);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", quiet);
      window.removeEventListener("offline", quiet);
      controller.current.quiet();
    };
  }, []);
  function confirm(expectedScope: string, receipt: PickupConfirmation) {
    const currentScope = latest.current.scope;
    if (!currentScope || expectedScope !== currentScope) return;
    if (controller.current.scope !== currentScope)
      controller.current = createPickupFeedback(currentScope);
    controller.current.confirm(expectedScope, receipt, Date.now());
    if (latest.current.blocked || document.hidden || !navigator.onLine)
      controller.current.quiet();
    const totals = controller.current.snapshot();
    setView((previous) => ({
      scope: currentScope,
      totals,
      announcement:
        previous.scope === currentScope ? previous.announcement : "",
    }));
  }
  return {
    totals: view.scope === scope ? view.totals : emptyPickupTotals(),
    announcement: view.scope === scope && !blocked ? view.announcement : "",
    confirm,
  };
}
