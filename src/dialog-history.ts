const KEY = "questlayerDialogV1";
let normalClosePops = 0;
export function dialogHistoryActive() {
  return normalClosePops > 0 || typeof history.state?.[KEY] === "string";
}
export function clearClosedDialogMarker() {
  if (document.querySelector("dialog[open]") || !history.state?.[KEY]) return;
  const state = { ...history.state };
  delete state[KEY];
  try {
    history.replaceState(state, "");
  } catch {
    /* In-memory navigation remains available. */
  }
}
export function consumeNormalDialogClose() {
  if (!normalClosePops) return false;
  normalClosePops--;
  return true;
}
/**
 * Settles once the history.back() of a dialog that just closed has landed
 * (its popstate fired). One dialog handing over to the next (a player card's
 * "Write a message" opening the inbox) must not push its entry while that
 * back is still travelling: the traversal would then land below the new
 * entry, and the new dialog would read the popstate as Back and close at once.
 */
let backInFlight: Promise<void> | null = null;
function awaitBack() {
  const pending = new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener("popstate", done);
      clearTimeout(timer);
      if (backInFlight === pending) backInFlight = null;
      // Resolve after this popstate has reached every listener: a promise
      // callback would run between listeners (microtask checkpoint), push
      // the new entry, and the new dialog's own listener would then take this
      // very popstate for Back.
      setTimeout(resolve, 0);
    };
    window.addEventListener("popstate", done);
    // A browser that never fires popstate must not hold later dialogs back.
    const timer = setTimeout(done, 1000);
  });
  backInFlight = pending;
}
export function trackDialogHistory(onBack: () => void) {
  const token = crypto.randomUUID();
  let owned = false,
    cancelled = false;
  const push = () => {
    if (cancelled) return;
    const other =
      history.state && typeof history.state === "object" ? history.state : {};
    try {
      history.pushState({ ...other, [KEY]: token }, "");
      owned = true;
    } catch {
      /* Escape and explicit Close still work without browser history. */
    }
  };
  // StrictMode can mount/clean up/mount in one frame. Only the surviving modal
  // receives a browser entry; a cancelled mount cannot move browser history.
  const frame = requestAnimationFrame(() => {
    if (backInFlight) void backInFlight.then(push);
    else push();
  });
  const pop = (event: PopStateEvent) => {
    if (owned && event.state?.[KEY] !== token) onBack();
  };
  window.addEventListener("popstate", pop);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("popstate", pop);
    if (owned && history.state?.[KEY] === token) {
      normalClosePops++;
      awaitBack();
      try {
        history.back();
      } catch {
        normalClosePops--;
        clearClosedDialogMarker();
      }
    }
  };
}
