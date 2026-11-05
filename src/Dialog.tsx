import { useEffect, useRef, type ReactNode } from "react";
import { trackDialogHistory } from "./dialog-history";
import { dialogTabBoundary, dialogTabStops } from "./dialog-focus";
export function Dialog({
  label,
  presentation,
  open = true,
  onClose,
  children,
}: {
  label: string;
  presentation?: "screen";
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(
    () => (open ? trackDialogHistory(() => close.current()) : undefined),
    [open],
  );
  useEffect(() => {
    const d = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      d?.close();
      previous?.focus();
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
      className={`game-dialog${presentation === "screen" ? " game-dialog-screen" : ""}`}
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
        if (e.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
