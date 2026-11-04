import React from "react";
import { createRoot } from "react-dom/client";
import {
  AuraSprite,
  AURA_EDITIONS,
  AURA_EDITION_NAMES,
  AURA_GRIDS,
} from "../src/aura-art";
import { Character } from "../src/Character";
import { characterMarkerMarkup } from "../src/character-art";
import type { Item } from "../src/types";
import "../src/style.css";

const editions: { edition: string | null; color: string; title: string }[] = [
  ...AURA_EDITIONS.map((edition) => ({
    edition,
    color: { polar: "#9edfc5", moon: "#c2a0df", gold: "#e7c35f" }[edition],
    title: AURA_EDITION_NAMES[edition],
  })),
  { edition: null, color: "#ff6fb0", title: "Unknown edition (demo-only)" },
];
const item = (
  id: string,
  name: string,
  slot: "above" | "below",
  color: string,
  rarity = "rare",
): Item => ({ id, kind: "aura", name, rarity, slot, color, equipped: 1, serial: 12 });
const outfits: { title: string; items: Item[] }[] = [
  {
    title: "Northern Lights + Moonwake",
    items: [
      item("a", "Northern Lights", "above", "#9edfc5"),
      item("b", "Moonwake Aura", "below", "#c2a0df", "epic"),
    ],
  },
  {
    title: "Sunlit + demo Moon Ring",
    items: [
      item("c", "Sunlit Aura", "above", "#e7c35f", "legendary"),
      item("d", "Moon Ring", "below", "#b49beb", "epic"),
    ],
  },
  {
    title: "Unknown colours (generic)",
    items: [
      item("e", "Festival Aura", "above", "#ff6fb0", "common"),
      item("f", "Festival Glow", "below", "#51b4ba", "common"),
    ],
  },
];
function Gallery({ animated }: { animated: boolean }) {
  return (
    <>
      {editions.map((e) => (
        <div className="aura-row" key={e.title}>
          <b>{e.title}</b>
          {(["above", "below"] as const).map((slot) =>
            [1, 2, 3].map((size) => (
              <div className="aura-cell" key={slot + size}>
                <AuraSprite
                  edition={e.edition}
                  slot={slot}
                  color={e.color}
                  size={size}
                  animated={animated}
                  label={`${e.title}, ${slot}, ${size}x`}
                />
                <small>
                  {slot} {size}× · {AURA_GRIDS[slot].width * size}×
                  {AURA_GRIDS[slot].height * size}
                </small>
              </div>
            )),
          )}
        </div>
      ))}
    </>
  );
}
function Marker({
  className,
  outfit,
  scale,
}: {
  className: string;
  outfit: Item[];
  scale: number;
}) {
  const top = outfit.find((i) => i.slot === "above"),
    bottom = outfit.find((i) => i.slot === "below");
  return (
    <div className="marker-stage">
      <div
        className={className}
        role="img"
        aria-label="Map marker sample"
        dangerouslySetInnerHTML={{
          __html:
            characterMarkerMarkup({
              above: top?.color,
              below: bottom?.color,
              scale,
            }) + (className === "player-marker" ? '<span class="you-label">YOU</span>' : ""),
        }}
      />
    </div>
  );
}
function Kit() {
  return (
    <main className="aura-kit">
      <header>
        <p className="kit-eyebrow">QUESTLAYER · AURA SPRITES</p>
        <h1>Collectible Auras, pixel by pixel.</h1>
        <p>
          Authored 48×24 (above) and 56×20 (below) sprites at integer scales,
          one upper-left light, a 40% ink outline and a two-frame sparkle idle.
          This fixture uses made-up items; it requests no GPS, wallet or server
          data.
        </p>
      </header>
      <h2>Editions × slots on a light sheet (static frames)</h2>
      <section className="aura-sheet light aura-static">
        <Gallery animated={false} />
      </section>
      <h2>On the dark shell (animated)</h2>
      <section className="aura-sheet dark">
        <Gallery animated />
      </section>
      <h2>Composed character, static and animated</h2>
      <section className="aura-sheet light">
        <div className="aura-composed">
          {outfits.map((o) => (
            <figure key={o.title} className="aura-static">
              <Character items={o.items} preview />
              <figcaption>{o.title} · static</figcaption>
            </figure>
          ))}
          {outfits.map((o) => (
            <figure key={o.title + "a"}>
              <Character items={o.items} preview />
              <figcaption>{o.title} · animated</figcaption>
            </figure>
          ))}
          {outfits.map((o) => (
            <figure key={o.title + "c"}>
              <Character items={o.items} compact preview />
              <figcaption>compact 1×</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <h2>Map marker markup (static strings)</h2>
      <section className="aura-sheet light">
        <div className="aura-composed">
          {outfits.map((o) => (
            <figure key={o.title}>
              <Marker className="player-marker" outfit={o.items} scale={2} />
              <figcaption>You · 2×</figcaption>
            </figure>
          ))}
          {outfits.map((o) => (
            <figure key={o.title + "o"}>
              <Marker className="other-player-marker" outfit={o.items} scale={1} />
              <figcaption>Nearby explorer · 1×</figcaption>
            </figure>
          ))}
          {outfits.map((o) => (
            <figure key={o.title + "v"}>
              <Marker
                className="player-marker map-overview-player"
                outfit={o.items}
                scale={2}
              />
              <figcaption>Overview · follows the 78px starter box</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <footer>
        <p>
          Northern Lights: mint crest, teal body, violet hem with hanging
          curtains. Moonwake: crescent lit from the upper left with a star-dust
          wake. Sunlit: halo with rays and amber shade. Unknown editions reuse
          the halo design tinted by the item colour.
        </p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Kit />);
