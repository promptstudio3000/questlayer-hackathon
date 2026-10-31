import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../public/art/aavegotchi/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("provenance.json", root)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const layers = provenance.sources.map(({ filename, sha256 }) => {
  const svg = readFileSync(new URL(`layers/${filename}`, root), "utf8");
  if (sha(svg) !== sha256) throw Error(`Upstream layer changed: ${filename}`);
  const opening = svg.match(/^<svg\b([^>]*)>/)?.[1];
  if (!opening) throw Error("Invalid template layer");
  const fill = opening.match(/\bfill="(#[a-f0-9]{6})"/i)?.[1];
  // Preserve the upstream root fill when composing separate SVG documents.
  return `<g${fill ? ` fill="${fill}"` : ""}>${svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</g>`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 4 48 54" shape-rendering="crispEdges" role="img" aria-label="Aavegotchi starter">${layers.join("")}</svg>`;
writeFileSync(new URL("starter.svg", root), svg);
provenance.composition =
  "Unmodified body, cheeks, eyes, mouth and closed hands with original root fills; cropped viewport 8 4 48 54. No collateral badge or premium wearable.";
provenance.starterSha256 = sha(svg);
provenance.assetPath = `/assets/aavegotchi-starter-${provenance.starterSha256.slice(0, 12)}.svg`;
mkdirSync(new URL("../../assets/", root), { recursive: true });
writeFileSync(new URL(`../../${provenance.assetPath.slice(1)}`, root), svg);
const artModule = new URL("../src/character-art.ts", import.meta.url);
writeFileSync(
  artModule,
  readFileSync(artModule, "utf8").replace(
    /export const STARTER_SPRITE\s*=\s*"[^"]+";/,
    `export const STARTER_SPRITE = "${provenance.assetPath}";`,
  ),
);
writeFileSync(
  new URL("provenance.json", root),
  JSON.stringify(provenance, null, 2) + "\n",
);
console.log(
  `Composed ${layers.length} verified official layers: ${svg.length} bytes.`,
);
