import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { trackDialogHistory } from "./dialog-history";
import { dialogTabBoundary, dialogTabStops } from "./dialog-focus";
import "./dialog-polish.css";
export function Dialog({
  label,
  presentation,
  history = true,
  open = true,
  onClose,
  fallbackFocus,
  children,
}: {
  label: string;
  presentation?: "encounter" | "map";
  history?: boolean;
  open?: boolean;
  onClose: () => void;
  /** Resolve a replacement trigger when an item action recreated its original button. */
  fallbackFocus?: () => HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const focusFallback = useRef(fallbackFocus);
  focusFallback.current = fallbackFocus;
  useEffect(
    () => (open && history ? trackDialogHistory(() => close.current()) : undefined),
    [open, history],
  );
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      d?.close();
      requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        const target = previous?.isConnected && previous.checkVisibility()
          ? previous
          : focusFallback.current?.() || document.querySelector<HTMLElement>(".map-recenter, .main-panel");
        target?.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    else if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`game-dialog${presentation ? ` game-dialog-${presentation}` : ""}`}
      aria-label={label}
      onKeyDown={(event) => {
        if (
          event.key !== "Tab" ||
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const dialog = event.currentTarget;
        const stops = dialogTabStops(dialog);
        const target = dialogTabBoundary(
          stops,
          document.activeElement as HTMLElement | null,
          event.shiftKey,
        );
        if (target || !stops.length) {
          event.preventDefault();
          (target || dialog).focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const dialog = ref.current;
        if (!dialog || e.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (!presentation || e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
      }}
    >
      {presentation === "encounter" && <div className="dialog-dismiss-bar">
        <button type="button" className="dialog-dismiss" aria-label={tr("Close")} onClick={onClose}><X size={22} aria-hidden="true" /></button>
      </div>}
      {children}
    </dialog>
  );
}
