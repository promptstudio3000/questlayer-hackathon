export function dialogTabBoundary<T>(
  stops: T[],
  active: T | null,
  backward: boolean,
): T | null {
  if (!stops.length) return null;
  const index = active === null ? -1 : stops.indexOf(active);
  if (index === -1 || (backward ? index === 0 : index === stops.length - 1))
    return backward ? stops[stops.length - 1] : stops[0];
  return null;
}

export function dialogTabStops(dialog: HTMLDialogElement): HTMLElement[] {
  const stops = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href],area[href],button,input,select,textarea,summary,iframe,object,embed,audio[controls],video[controls],[tabindex],[contenteditable]:not([contenteditable="false"])',
    ),
  ).filter(
    (node) =>
      (node.tabIndex >= 0 ||
        (node.isContentEditable && !node.hasAttribute("tabindex"))) &&
      !node.matches(":disabled") &&
      !node.closest("[inert],[hidden]") &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== "hidden",
  );
  const enabled = stops.filter((node) => {
    if (
      !(node instanceof HTMLInputElement) ||
      node.type !== "radio" ||
      !node.name
    )
      return true;
    const group = stops.filter(
      (candidate): candidate is HTMLInputElement =>
        candidate instanceof HTMLInputElement &&
        candidate.type === "radio" &&
        candidate.name === node.name &&
        candidate.form === node.form,
    );
    return node === (group.find((candidate) => candidate.checked) || group[0]);
  });
  return enabled
    .map((node, order) => ({ node, order }))
    .sort((a, b) => {
      const aIndex = a.node.tabIndex > 0 ? a.node.tabIndex : Infinity;
      const bIndex = b.node.tabIndex > 0 ? b.node.tabIndex : Infinity;
      return aIndex - bIndex || a.order - b.order;
    })
    .map(({ node }) => node);
}
