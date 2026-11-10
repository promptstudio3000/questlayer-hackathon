import {
  ArrowsOut,
  Crosshair,
  GearSix,
  GlobeHemisphereWest,
  MapTrifold,
  NavigationArrow,
  ArrowCounterClockwise,
  Compass,
} from "@phosphor-icons/react";
import { tr } from "./i18n";
import { usePopover } from "./usePopover";

/**
 * Map settings in the top right corner (Lubos, 10 Nov 2026): play mode
 * (city demo or GPS), centre on me, the camera turning with the explorer and
 * the map views. Folded behind one gear so the map stays clear.
 */
export function MapSettings({
  demo,
  status,
  onModeSwitch,
  modeLabel,
  modeAria,
  onLocate,
  rotate,
  onRotate,
  onFull,
  fullAvailable,
  onOverview,
  overview,
  globe,
  onGlobe,
}: {
  /** The city demo is on (shown as a small dot on the gear). */
  demo: boolean;
  status: string;
  onModeSwitch: () => void;
  modeLabel: string;
  modeAria: string;
  onLocate: () => void;
  rotate: boolean;
  onRotate: (next: boolean) => void;
  onFull: () => void;
  fullAvailable: boolean;
  onOverview: () => void;
  overview: boolean;
  globe: boolean;
  onGlobe: () => void;
}) {
  const { open, setOpen, root, opener } = usePopover();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div className="map-settings" ref={root}>
      <button
        ref={opener}
        type="button"
        className="map-settings-toggle"
        aria-label={tr("Map settings")}
        title={tr("Map settings")}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <GearSix size={22} weight={open ? "fill" : "regular"} aria-hidden="true" />
        {demo && <span className="map-settings-demo-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="map-settings-flyout" role="group" aria-label={tr("Map settings")}>
          <div className={`map-settings-mode${demo ? " demo" : ""}`}>
            <span className="status-dot" aria-hidden="true" />
            <span className="map-settings-status">{status}</span>
            <button type="button" aria-label={modeAria} onClick={run(onModeSwitch)}>
              {demo ? <NavigationArrow size={16} weight="fill" aria-hidden="true" /> : <ArrowCounterClockwise size={16} aria-hidden="true" />}
              {modeLabel}
            </button>
          </div>
          <button type="button" className="map-settings-row map-recenter" onClick={run(onLocate)}>
            <Crosshair size={20} aria-hidden="true" />
            <span>{tr("My location")}</span>
          </button>
          <button
            type="button"
            className="map-settings-row"
            role="switch"
            aria-checked={rotate}
            onClick={() => onRotate(!rotate)}
          >
            <Compass size={20} aria-hidden="true" />
            <span>{tr("Turn the map with me")}</span>
            <span className="map-settings-switch" aria-hidden="true" />
          </button>
          {fullAvailable && (
            <button type="button" className="map-settings-row map-full-toggle" onClick={run(onFull)}>
              <ArrowsOut size={20} aria-hidden="true" />
              <span>{tr("Full map")}</span>
            </button>
          )}
          <button type="button" className="map-settings-row" aria-pressed={overview} onClick={run(onOverview)}>
            <MapTrifold size={20} aria-hidden="true" />
            <span>{tr("City overview")}</span>
          </button>
          <button type="button" className="map-settings-row" aria-pressed={globe} onClick={run(onGlobe)}>
            <GlobeHemisphereWest size={20} aria-hidden="true" />
            <span>{tr("Globe")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
