import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  X,
} from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { Character } from "./Character";
import type { Item } from "./types";
import {
  loadCharacterModel,
  type CharacterModelDescriptor as Descriptor,
} from "./character-model-client";
type Scene = ReturnType<
  typeof import("./character-3d-scene").createCharacterScene
>;
export function Character3D({
  items,
  originTokenId,
  onClose,
}: {
  items: Item[];
  originTokenId?: string;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<Scene | null>(null);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [descriptor, setDescriptor] = useState<Descriptor | null>(null);
  const above = items.find((i) => i.equipped && i.slot === "above")?.color,
    below = items.find((i) => i.equipped && i.slot === "below")?.color;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoaded(false);
    setError("");
    setDescriptor(null);
    const fail = (message: string) => {
      if (active) {
        scene.current?.dispose();
        scene.current = null;
        setError(message);
        setLoaded(false);
      }
    };
    void (async () => {
      const [{ descriptor: data, bytes }, module] = await Promise.all([
        loadCharacterModel(originTokenId, controller.signal),
        import("./character-3d-scene"),
      ]);
      if (!active || !host.current) return;
      setDescriptor(data);
      const view = module.createCharacterScene(host.current, bytes, {
        starter: data.source === "starter",
        above,
        below,
        onError: () =>
          fail("3D is unavailable on this device. Your 2D look still works."),
      });
      scene.current = view;
      await view.ready;
      if (active && scene.current === view) setLoaded(true);
    })().catch((e) => {
      if (active)
        fail(
          e.message ||
            "3D is temporarily unavailable. Your 2D look still works.",
        );
    });
    return () => {
      active = false;
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [originTokenId, above, below, attempt]);
  return (
    <Dialog label="Your character in 3D" onClose={onClose}>
      <section className="character-room">
        <header>
          <div>
            <h2>Your look, in 3D</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close 3D preview"
            onClick={onClose}
            autoFocus
          >
            <X />
          </button>
        </header>
        <div className="model-stage" ref={host} aria-busy={!loaded && !error}>
          {!loaded && (
            <div className="model-fallback">
              <Character items={items} originTokenId={originTokenId} />
              {!error && <p role="status">Preparing your 3D look…</p>}
            </div>
          )}
        </div>
        {error ? (
          <>
            <p className="inline-error" role="alert">
              {error}
            </p>
            <p>Your equipped items and 2D appearance are unchanged.</p>
            <button
              className="secondary-button"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Try 3D again
            </button>
          </>
        ) : (
          <>
            <div className="model-controls" aria-label="3D view controls">
              <button
                disabled={!loaded}
                aria-label="Rotate left"
                onClick={() => scene.current?.rotate(-1)}
              >
                <ArrowLeft />
              </button>
              <button
                disabled={!loaded}
                aria-label="Zoom out"
                onClick={() => scene.current?.zoom(-1)}
              >
                <MagnifyingGlassMinus />
              </button>
              <button
                disabled={!loaded}
                aria-label="Reset 3D view"
                onClick={() => scene.current?.reset()}
              >
                <ArrowCounterClockwise />
              </button>
              <button
                disabled={!loaded}
                aria-label="Zoom in"
                onClick={() => scene.current?.zoom(1)}
              >
                <MagnifyingGlassPlus />
              </button>
              <button
                disabled={!loaded}
                aria-label="Rotate right"
                onClick={() => scene.current?.rotate(1)}
              >
                <ArrowRight />
              </button>
            </div>
            <p className="model-instructions">
              Drag to turn, pinch to zoom, or use the buttons.
            </p>
            {descriptor && !descriptor.complete && (
              <p className="model-coverage">
                {descriptor.mapCompatible && descriptor.backgroundOmitted
                  ? "Your original background stays in 2D. Your character and equipped wearables are shown in 3D."
                  : "Some original wardrobe slots are not available in 3D. Your verified 2D appearance remains the complete view."}
              </p>
            )}
          </>
        )}
        <p className="model-attribution">
          <a
            href="https://www.aavegotchi.com/sdk"
            target="_blank"
            rel="noreferrer"
          >
            Aavegotchi SDK artwork
          </a>{" "}
          ·{" "}
          {originTokenId
            ? `Original #${originTokenId}`
            : "Starter body preview"}
          . QuestLayer Auras are separate game items.
        </p>
        {descriptor?.optimized && (
          <p className="model-coverage">
            Optimized for a lighter mobile preview.
          </p>
        )}
      </section>
    </Dialog>
  );
}
