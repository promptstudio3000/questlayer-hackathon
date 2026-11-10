import type { ComponentType, ReactNode } from "react";
import { Lightning, X } from "@phosphor-icons/react";
import { tr } from "./i18n";
import { usePopover } from "./usePopover";

export type MapAction = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean | "true" }>;
  onSelect: () => void;
};

/**
 * Actions button in the bottom right corner (Lubos, 10 Nov 2026): one tap
 * fans out round buttons to leave a note, change mood, post a task, hide a
 * Secret or create a quest, so these never crowd the map or the sheets.
 */
export function MapActions({ actions, children }: { actions: MapAction[]; children?: ReactNode }) {
  const { open, setOpen, root, opener } = usePopover();
  return (
    <div className={`map-actions${open ? " open" : ""}`} ref={root}>
      {open && (
        <ul className="map-actions-list" aria-label={tr("Actions")}>
          {actions.map((a, i) => (
            <li key={a.id} style={{ ["--i" as string]: actions.length - 1 - i }}>
              <button
                type="button"
                className={`map-action map-action-${a.id}`}
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
              >
                <span className="map-action-label">{a.label}</span>
                <span className="map-action-icon" aria-hidden="true">
                  <a.icon size={22} weight="bold" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        ref={opener}
        type="button"
        className="map-actions-toggle"
        aria-label={tr("Actions")}
        title={tr("Actions")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={24} weight="bold" aria-hidden="true" /> : <Lightning size={24} weight="fill" aria-hidden="true" />}
      </button>
      {children}
    </div>
  );
}
