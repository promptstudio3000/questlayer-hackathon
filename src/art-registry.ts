// Drop-in art overrides (docs/ART-LIST.md, art/README.md).
//
// Files in the repo's top-level art/ folder are picked up at build time by
// src/art-overrides.ts and registered here under their path without the
// extension, e.g. art/actors/merchant.png -> "actors/merchant". Every place
// that draws a placeholder asks artUrl() first and keeps its own placeholder
// when nothing is registered. Dependency-free, so Node tests can import the
// modules that use it (the registry is simply empty there).

const urls = new Map<string, string>();

/** Registers build-time art files ({ "actors/merchant": "/assets/merchant-1a2b.png" }). */
export function registerArt(entries: Record<string, string>) {
  for (const [key, url] of Object.entries(entries)) if (key && url) urls.set(key, url);
}

/** The URL of the first key that has a dropped-in file, or null to keep the placeholder. */
export function artUrl(...keys: string[]): string | null {
  for (const key of keys) {
    const url = urls.get(key);
    if (url) return url;
  }
  return null;
}

/** All registered keys (for the dev check page and tests). */
export function artKeys() {
  return [...urls.keys()].sort();
}

/** Turns "./art/actors/merchant.png" or "/art/actors/merchant.webp" into "actors/merchant". */
export function artKeyFromPath(path: string) {
  const m = /(?:^|\/)art\/(.+)\.(?:png|webp|svg)$/i.exec(path);
  return m ? m[1].toLowerCase() : null;
}
