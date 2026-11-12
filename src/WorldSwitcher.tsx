import { useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, GlobeHemisphereWest, Cube, Flask, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { BrandLogo } from "./Ghost";
import { tr } from "./i18n";
import { REALMS } from "./realms";
import "./world-switcher.css";

export type GameLayerConfig = {
  id: "world" | "test";
  test: boolean;
  tour?: boolean;
  testLayerUrl: string | null;
  worldUrl: string | null;
};

export function WorldSwitcher({
  virtual,
  enabled,
  layerName,
  onChoose,
  gameLayer,
}: {
  virtual: boolean;
  enabled: boolean;
  /** Display name of the virtual voxel layer (docs/LAYER.md). */
  layerName: string;
  onChoose: (virtual: boolean) => void;
  /** Test Layer or QuestLayer World (docs/TEST-LAYER.md), from /api/config. */
  gameLayer?: GameLayerConfig | null;
}) {
  const test = !!gameLayer?.test;
  const outdoorName = test ? tr("Test Layer") : REALMS.questlayer.name;
  // The other server: the Test Layer from World (testnet only), World from the Test Layer.
  const other = test
    ? gameLayer?.worldUrl
      ? { url: gameLayer.worldUrl, name: REALMS.questlayer.name, text: tr("The real game.") }
      : null
    : gameLayer?.testLayerUrl
      ? { url: gameLayer.testLayerUrl, name: tr("Test Layer"), text: tr("Every feature with test coins. Nothing here is real money.") }
      : null;
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
            {virtual ? layerName : outdoorName}
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
                {test ? <Flask size={32} aria-hidden="true" /> : <GlobeHemisphereWest size={32} aria-hidden="true" />}
                <span>
                  <strong>{outdoorName}</strong>
                  <small>
                    {test
                      ? tr("Every feature with test coins. Nothing here is real money.")
                      : tr("Outdoor quests, real places and discoveries.")}
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
              {other && (
                <a className="world-choice" href={other.url}>
                  {test ? <GlobeHemisphereWest size={32} aria-hidden="true" /> : <Flask size={32} aria-hidden="true" />}
                  <span>
                    <strong>{other.name}</strong>
                    <small>{other.text}</small>
                  </span>
                </a>
              )}
            </section>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
