// Build-time loader for the drop-in art folder (art/README.md). Import this
// first in main.tsx, before any module that reads artUrl() while it loads
// (character-art.ts resolves the player sprite at import time).
import { artKeyFromPath, registerArt } from "./art-registry";

// Only what the welcome screen shows (logo, coin, player); the rest is in
// src/art-world.ts, so the first-load JS budget holds.
const files = import.meta.glob(["/art/brand/logo.*", "/art/objects/coin.*", "/art/player/**/*.{png,webp,svg}"], {
  eager: true,
  // no-inline: even tiny files stay separate so the JS bundle budget does not grow.
  query: "?no-inline",
  import: "default",
}) as Record<string, string>;

registerArt(
  Object.fromEntries(
    Object.entries(files)
      .map(([path, url]) => [artKeyFromPath(path), url] as const)
      .filter((e): e is readonly [string, string] => !!e[0]),
  ),
);
