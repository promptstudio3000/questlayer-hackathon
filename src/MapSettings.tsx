import { GearSix } from "@phosphor-icons/react";
import { tr } from "./i18n";

/**
 * The gear in the top right corner opens Settings (src/SettingsScreen.tsx),
 * where the map controls are the first part (Lubos, 13 Nov 2026). The class
 * name stays from the old map flyout.
 */
export function MapSettings({ demo, open, onOpen }: {
  /** The city demo is on (shown as a small dot on the gear). */
  demo: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="map-settings">
      <button
        type="button"
        className="map-settings-toggle"
        aria-label={tr("Settings")}
        title={tr("Settings")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <GearSix size={22} weight={open ? "fill" : "regular"} aria-hidden="true" />
        {demo && <span className="map-settings-demo-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
