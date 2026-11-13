// Same gear/flyout and controls as QuestLayer's map, with only virtual-world
// actions. GPS, city overview and globe modes never apply to voxel positions.
import { ArrowLeft, Crosshair, GearSix, House, MapTrifold, Question } from "@phosphor-icons/react";
import { usePopover } from "../usePopover";
import { tr } from "../i18n";

export function LayerSettings({ mapShown, onMap, onLocate, onSquare, onGuide, onExit }: {
  mapShown: boolean; onMap: () => void; onLocate: () => void;
  onSquare: () => void; onGuide: () => void; onExit: () => void;
}) {
  const { open, setOpen, root, opener } = usePopover();
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return <div className="map-settings" ref={root}>
    <button ref={opener} type="button" className="map-settings-toggle" aria-label={tr("Map settings")} aria-expanded={open} onClick={() => setOpen(v => !v)}><GearSix size={22} weight={open ? "fill" : "regular"} aria-hidden="true" /></button>
    {open && <div className="map-settings-flyout" role="group" aria-label={tr("Map settings")}>
      <button type="button" className="map-settings-row map-recenter" onClick={run(onLocate)}><Crosshair size={20} /><span>{tr("My location")}</span></button>
      <button type="button" className="map-settings-row" aria-pressed={mapShown} onClick={run(onMap)}><MapTrifold size={20} /><span>{tr("Shared atlas")}</span></button>
      <button type="button" className="map-settings-row" onClick={run(onSquare)}><House size={20} /><span>{tr("Return to the central square")}</span></button>
      <button type="button" className="map-settings-row" onClick={run(onGuide)}><Question size={20} /><span>{tr("Open MetaLayer field guide")}</span></button>
      <button type="button" className="map-settings-row" onClick={run(onExit)}><ArrowLeft size={20} /><span>{tr("Back to QuestLayer")}</span></button>
    </div>}
  </div>;
}
