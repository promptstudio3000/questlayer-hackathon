import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { ghostSvg } from "../src/character-art.ts";
const svg = ghostSvg("#b8a1ed"),
  sha256 = createHash("sha256").update(svg).digest("hex");
mkdirSync("contracts/collectibles/assets", { recursive: true });
writeFileSync("public/explorer.svg", svg);
writeFileSync(
  "contracts/collectibles/assets/explorer-uri.txt",
  "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64") + "\n",
);
writeFileSync(
  "public/explorer-art.json",
  JSON.stringify(
    {
      name: "QuestLayer Explorer",
      version: 1,
      sha256,
      source: "src/character-art.ts",
      media: "data:image/svg+xml;base64",
    },
    null,
    2,
  ) + "\n",
);
console.log("Canonical explorer art generated; SHA-256 " + sha256);
const { auraSvg } = await import("../src/character-art.ts");
// Cover media for every native catalog edition. Covers are the historical
// explorer-with-ring design tinted by the edition color; minted tokens keep
// whatever media they were minted with.
const { default: catalog } = await import("../server/data/aura-catalog.json", {
  with: { type: "json" },
});
for (const [edition, color] of catalog.editions
  .filter((e) => e.native)
  .map((e) => [e.id, e.color])) {
  const art = auraSvg(color);
  writeFileSync(`public/aura-${edition}.svg`, art);
  writeFileSync(
    `contracts/collectibles/assets/aura-${edition}-uri.txt`,
    "data:image/svg+xml;base64," + Buffer.from(art).toString("base64") + "\n",
  );
}
