import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  GameObjectArt,
  drawGameObject,
  GAME_OBJECT_KINDS,
  type GameObjectOptions,
  type GameObjectKind,
} from "../src/game-object-art";
import "../src/style.css";
import "./game-objects.css";
const examples: (GameObjectOptions & { title: string; description: string })[] =
  [
    {
      kind: "coin",
      title: "Street coin",
      description:
        "The same sprite supplies map and amount illustrations. Read the currency label.",
    },
    {
      kind: "chest",
      title: "Chest activity",
      description:
        "Only shown when current data establishes an item is available.",
    },
    {
      kind: "chest",
      state: "open",
      title: "Opened chest",
      description:
        "An empty interior does not invent a reward or its contents.",
    },
    {
      kind: "discovery",
      title: "Discovery",
      description: "A place to read an activity's actual requirement.",
    },
    {
      kind: "route",
      title: "Ordered walk",
      description:
        "An authored map object, not a verified walking-route distance.",
    },
    {
      kind: "place",
      title: "Place details",
      description:
        "Generic place when activity or item availability is unknown.",
    },
    {
      kind: "place",
      state: "completed",
      title: "Visited place",
      description: "A visible check accompanies confirmed personal completion.",
    },
    {
      kind: "route",
      state: "locked",
      title: "Tier 2 required",
      description:
        "A padlock differs by shape; closed and upcoming activities also explain their restriction.",
    },
  ];
function CoinRaster() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) drawGameObject(context, { kind: "coin" }, 2);
  }, []);
  return (
    <canvas
      ref={canvas}
      width={64}
      height={64}
      role="img"
      aria-label="Map coin raster from the shared pixel data"
    />
  );
}
function FieldKit() {
  const [selected, setSelected] = useState<GameObjectKind>("discovery");
  const [pressed, setPressed] = useState(false);
  const large = new URLSearchParams(location.search).get("text") === "large";
  return (
    <main className={`object-field-kit ${large ? "large-text" : ""}`}>
      <header>
        <p className="kit-eyebrow">QUESTLAYER · OBJECT FIELD KIT</p>
        <h1>Small objects. Clear discoveries.</h1>
        <p>
          Authored 32-pixel illustrations for the map and adventure list. This
          fixture uses made-up states; it requests no GPS, wallet or server
          data.
        </p>
      </header>
      <section aria-label="Game object family" className="object-gallery">
        {examples.map((example, i) => (
          <article key={i}>
            <GameObjectArt {...example} size={64} label={example.title} />
            <h2>{example.title}</h2>
            <p>{example.description}</p>
          </article>
        ))}
      </section>
      <section
        className="object-comparison"
        aria-label="Shared map and interface coin"
      >
        <div>
          <CoinRaster />
          <p>Map raster · 2× grid</p>
        </div>
        <div>
          <GameObjectArt kind="coin" size={64} label="Shared vector coin" />
          <p>Interface SVG · 2× grid</p>
        </div>
        <div>
          <GameObjectArt kind="coin" size={32} label="Phone-scale coin" />
          <p>Phone size · 32px</p>
        </div>
      </section>
      <section className="object-controls">
        <h2>Choose a marker</h2>
        <p>
          Every marker has a 48px target. Selection adds corner brackets;
          completion and lock shapes stay visible.
        </p>
        <div className="object-marker-row">
          {GAME_OBJECT_KINDS.map((kind) => (
            <button
              key={kind}
              className="zone-map-pin game-object-map-pin"
              aria-label={`Select ${kind} illustration`}
              aria-pressed={selected === kind}
              onClick={() => {
                setSelected(kind);
                setPressed(true);
              }}
            >
              <GameObjectArt kind={kind} selected={selected === kind} />
            </button>
          ))}
        </div>
        <p role="status">
          {pressed
            ? `${selected[0].toUpperCase() + selected.slice(1)} illustration selected. No activity was completed.`
            : "Discovery illustration selected. This is a visual sample, not a reward."}
        </p>
        <div className="object-state-row">
          <div>
            <GameObjectArt
              kind={selected}
              selected
              size={64}
              label="Selected activity"
            />
            <p>Selected</p>
          </div>
          <div>
            <GameObjectArt
              kind={selected}
              state="completed"
              selected
              size={64}
              label="Selected and visited"
            />
            <p>Selected + visited</p>
          </div>
          <div>
            <GameObjectArt
              kind={selected}
              state="locked"
              selected
              size={64}
              label="Selected and locked"
            />
            <p>Selected + locked</p>
          </div>
        </div>
      </section>
      <footer>
        <p>
          Grid: 32×32. Lighting: upper left. Purple outlines, pale gold faces,
          pink discovery facets. New repository-authored object art; verified
          Aavegotchi starter and equipped Auras are unchanged.
        </p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<FieldKit />);
