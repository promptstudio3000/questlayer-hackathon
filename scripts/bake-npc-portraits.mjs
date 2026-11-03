// Bakes the NPC dialog portraits (public/art/npc/<model>.png) from the original
// three.js models in src/actor-models.ts. Needs the Vite dev server running:
//   npx vite --port 5179 &  node scripts/bake-npc-portraits.mjs [http://127.0.0.1:5179]
// The PNGs are committed so the dialog shows a portrait instantly, before WebGL starts.
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:5179";
const MODELS = ["chronicler", "merchant", "keeper", "pilgrim", "wisp"];
const out = new URL("../public/art/npc/", import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.goto(`${base}/dev/actor-models.html`);
await page.waitForSelector("body[data-ready='1']", { timeout: 60000 });
for (const model of MODELS) {
  const url = await page.evaluate(async (m) => (await import("/src/actor-models.ts")).actorSprite(m, 384), model);
  if (!url.startsWith("data:image/png;base64,")) throw new Error(`${model}: no WebGL render`);
  writeFileSync(new URL(`${model}.png`, out), Buffer.from(url.split(",")[1], "base64"));
  console.log(`baked ${model}.png`);
}
await browser.close();
