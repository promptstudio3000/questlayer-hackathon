import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { Info } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { usePopover } from "./usePopover";

/**
 * A small "i" button that opens its explanation in a flyout, so screens keep
 * only the essentials visible. The text stays in the page for screen readers
 * once opened; nothing in it may be the only place a required action lives.
 */
export function InfoTip({
  label,
  children,
  align = "end",
}: {
  /** What the explanation is about, read out with the button. */
  label: string;
  children: ReactNode;
  /** Which edge of the button the flyout lines up with. */
  align?: "start" | "end";
}) {
  const { open, setOpen, root, opener } = usePopover<HTMLSpanElement>();
  const id = useId();
  const flyout = useRef<HTMLSpanElement>(null);
  // The flyout must stay inside the dialog (or panel) it belongs to: one that
  // sticks out makes the dialog scroll sideways. Measure it once it is open
  // and slide it back in; flip it above the button when there is no room below.
  useLayoutEffect(() => {
    const el = flyout.current;
    if (!open || !el) return;
    el.style.transform = "";
    el.dataset.side = "below";
    const box = (el.closest("dialog, [role='dialog'], .game-dialog, .main-panel") || document.documentElement).getBoundingClientRect();
    const left = Math.max(box.left, 0) + 8;
    const right = Math.min(box.right, window.innerWidth) - 8;
    const bottom = Math.min(box.bottom, window.innerHeight) - 8;
    let r = el.getBoundingClientRect();
    if (r.bottom > bottom && r.height + 46 < r.top - Math.max(box.top, 0)) {
      el.dataset.side = "above";
      r = el.getBoundingClientRect();
    }
    const dx = r.right > right ? right - r.right : r.left < left ? left - r.left : 0;
    if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
  }, [open]);
  return (
    <span className={`info-tip info-tip-${align}`} ref={root}>
      <button
        ref={opener}
        type="button"
        className="info-tip-button"
        aria-label={tr("About: {0}", { 0: label })}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Info size={18} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <span id={id} ref={flyout} className="info-tip-flyout" role="note">
          {children}
        </span>
      )}
    </span>
  );
}
