import { useEffect } from "react";

const CARDS = ".main-panel.explore-panel.sheet-compact:not([hidden]), .nearby-open";

/**
 * Phones: the objective card sits right on the tab bar and the joystick and
 * Actions button ride on top of it. Publishes the card's height (plus a gap)
 * as `--hud-card` on the root, 0px when no card shows, so the controls move
 * back down when the card is closed.
 */
export function useHudCard(active: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.style.removeProperty("--hud-card");
      return;
    }
    let last = "";
    const sizes = new ResizeObserver(() => measure());
    let watched: Element[] = [];
    function measure() {
      const heights = [...document.querySelectorAll(CARDS)]
        .filter((el) => (el as HTMLElement).checkVisibility?.() ?? (el as HTMLElement).offsetParent !== null)
        .map((el) => el.getBoundingClientRect().height);
      const next = heights.length ? `${Math.ceil(Math.max(...heights)) + 8}px` : "0px";
      if (next !== last) root.style.setProperty("--hud-card", (last = next));
    }
    function observe() {
      const now = [...document.querySelectorAll(CARDS)];
      if (now.length === watched.length && now.every((el, i) => el === watched[i])) return;
      sizes.disconnect();
      for (const el of now) sizes.observe(el);
      watched = now;
    }
    const tree = new MutationObserver(() => {
      observe();
      measure();
    });
    tree.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
    observe();
    measure();
    return () => {
      tree.disconnect();
      sizes.disconnect();
      root.style.removeProperty("--hud-card");
    };
  }, [active]);
}
