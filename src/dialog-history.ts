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
 * history.back() calls of closed dialogs still travelling. One dialog handing
 * over to the next (a player card's "Message" opening the inbox) must not push
 * its entry before that back lands: the traversal would land below the new
 * entry, and the new dialog would read the popstate as Back and close at once.
 * A back counts as landed a task after its popstate, once every listener has
 * seen it, or after 1 s in a browser that never fires one.
 */
let backs = 0;
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
  const go = (): unknown => (backs ? setTimeout(go, 20) : push());
  const frame = requestAnimationFrame(go);
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
      backs++;
      const land = () => owned && ((owned = false), setTimeout(() => backs--));
      window.addEventListener("popstate", land, { once: true });
      setTimeout(land, 1000);
      try {
        history.back();
      } catch {
        land();
        normalClosePops--;
        clearClosedDialogMarker();
      }
    }
  };
}
