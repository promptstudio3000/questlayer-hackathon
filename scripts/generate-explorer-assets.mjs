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
for (const [edition, color] of Object.entries({
  polar: "#9edfc5",
  moon: "#c2a0df",
  gold: "#e7c35f",
})) {
  const art = auraSvg(color);
  writeFileSync(`public/aura-${edition}.svg`, art);
  writeFileSync(
    `contracts/collectibles/assets/aura-${edition}-uri.txt`,
    "data:image/svg+xml;base64," + Buffer.from(art).toString("base64") + "\n",
  );
}
