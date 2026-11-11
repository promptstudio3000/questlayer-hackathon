import { useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, GlobeHemisphereWest, Cube, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { BrandLogo } from "./Ghost";
import { tr } from "./i18n";
import { REALMS } from "./realms";
import "./world-switcher.css";

export function WorldSwitcher({
  virtual,
  enabled,
  layerName,
  onChoose,
}: {
  virtual: boolean;
  enabled: boolean;
  /** Display name of the virtual voxel layer (docs/LAYER.md). */
  layerName: string;
  onChoose: (virtual: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="world-switcher"
        aria-label={tr("Choose your world")}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        <BrandLogo />
        <span className="world-switcher-name">
          {REALMS.questlayer.name.toUpperCase()}
          <small>
            {virtual ? layerName : REALMS.questlayer.name}
          </small>
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <Dialog
            label={tr("Choose your world")}
            onClose={() => setOpen(false)}
          >
            <section className="world-picker">
              <div className="panel-heading">
                <h2>{tr("One explorer. Two worlds.")}</h2>
                <button
                  className="icon-button"
                  onClick={() => setOpen(false)}
                  aria-label={tr("Close")}
                >
                  <X size={24} />
                </button>
              </div>
              <button
                className="world-choice"
                aria-pressed={!virtual}
                onClick={() => {
                  setOpen(false);
                  onChoose(false);
                }}
              >
                <GlobeHemisphereWest size={32} aria-hidden="true" />
                <span>
                  <strong>{REALMS.questlayer.name}</strong>
                  <small>
                    {tr("Outdoor quests, real places and discoveries.")}
                  </small>
                </span>
              </button>
              <button
                className="world-choice"
                aria-pressed={virtual}
                disabled={!enabled}
                onClick={() => {
                  setOpen(false);
                  onChoose(true);
                }}
              >
                <Cube size={32} aria-hidden="true" />
                <span>
                  <strong>{layerName}</strong>
                  <small>
                    {enabled
                      ? tr(
                          "A shared voxel world in space: build your plot, explore, meet explorers.",
                        )
                      : tr("Create your explorer to enter.")}
                  </small>
                </span>
              </button>
            </section>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
