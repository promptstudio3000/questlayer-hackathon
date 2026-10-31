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
export function trackDialogHistory(onBack: () => void) {
  const token = crypto.randomUUID();
  let owned = false;
  // StrictMode can mount/clean up/mount in one frame. Only the surviving modal
  // receives a browser entry; a cancelled mount cannot move browser history.
  const frame = requestAnimationFrame(() => {
    const other =
      history.state && typeof history.state === "object" ? history.state : {};
    try {
      history.pushState({ ...other, [KEY]: token }, "");
      owned = true;
    } catch {
      /* Escape and explicit Close still work without browser history. */
    }
  });
  const pop = (event: PopStateEvent) => {
    if (owned && event.state?.[KEY] !== token) onBack();
  };
  window.addEventListener("popstate", pop);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("popstate", pop);
    if (owned && history.state?.[KEY] === token) {
      normalClosePops++;
      try {
        history.back();
      } catch {
        normalClosePops--;
        clearClosedDialogMarker();
      }
    }
  };
}
