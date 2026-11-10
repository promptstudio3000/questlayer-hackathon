import { useId, type ReactNode } from "react";
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
        <span id={id} className="info-tip-flyout" role="note">
          {children}
        </span>
      )}
    </span>
  );
}
