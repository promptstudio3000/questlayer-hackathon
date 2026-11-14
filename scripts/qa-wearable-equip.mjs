// Visual QA: an explorer who found a wearable puts it on from Inventory
// (no reload) and it must show on the map avatar, the HUD pill and the
// own profile. Usage: npm run build && node scripts/qa-wearable-equip.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(process.argv[2] || join(ROOT, "output/qa/wearable-equip"));
mkdirSync(OUT, { recursive: true });
const port = await new Promise((done) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => done(port));
  });
});
const dir = mkdtempSync(join(tmpdir(), "questlayer-wear-equip-"));
const url = `http://127.0.0.1:${port}`;
const dbPath = join(dir, "qa.sqlite");
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", APP_ORIGIN: url, DATABASE_PATH: dbPath, DISABLE_RELAYER: "1" },
  stdio: ["ignore", "ignore", "inherit"],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; ; i++) {
    try {
      const h = await (await fetch(`${url}/api/health`)).json();
      if (h.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (i > 120) throw Error("server not ready");
    await sleep(500);
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", locale: "en-GB" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").fill("Lena");
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.locator(".maplibregl-canvas").waitFor();
  const intro = page.getByRole("dialog", { name: "How to play", exact: true });
  await intro.getByRole("button", { name: "Let's explore", exact: true }).click({ timeout: 15000 }).catch(() => {});
  await intro.waitFor({ state: "hidden" }).catch(() => {});
  const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()));
  const id = me.player?.id || me.id;
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT OR IGNORE INTO wearable_clones VALUES (?,?,?,?,?)").run(id, 74, "find", 0, Date.now());
  db.close();
  await sleep(3000);
  await page.screenshot({ path: join(OUT, "00-map-before.png") });
  await page.getByRole("button", { name: "Inventory" }).first().click();
  await page.locator(".inv-chips").getByRole("button", { name: /^Wearables/ }).click();
  await page.locator(".inv-grid .inv-cell").first().click();
  await page.getByRole("button", { name: "Try it on" }).click();
  await page.getByRole("button", { name: "Take it off" }).waitFor();
  await sleep(800);
  await page.screenshot({ path: join(OUT, "01-inventory-worn.png") });
  const after = await page.evaluate(async () => (await (await fetch("/api/me")).json()));
  console.log("server worn:", JSON.stringify((after.player || after).wearables));
  // Close the item sheet, then the Inventory (no reload, like a player).
  for (let i = 0; i < 3 && !(await page.locator(".app-shell[data-screen=explore]").count()); i++) {
    await page.keyboard.press("Escape");
    await sleep(500);
    if (!(await page.locator(".app-shell[data-screen=explore]").count()))
      await page.getByRole("button", { name: /^Close/ }).last().click({ timeout: 3000 }).catch(() => {});
    await sleep(500);
  }
  await sleep(4000);
  const marker = await page.evaluate(() => {
    const el = document.querySelector(".player-marker, .you-marker, [data-character-renderer]");
    return el ? { cls: el.className, renderer: el.getAttribute("data-character-renderer"), imgs: [...el.querySelectorAll("img,image")].map((i) => i.getAttribute("src") || i.getAttribute("href")).slice(0, 6), wear: el.innerHTML.includes("/api/wearables/art") } : null;
  });
  console.log("map marker:", JSON.stringify(marker));
  await page.screenshot({ path: join(OUT, "02-map-after.png") });
  await page.locator(".you-label").first().click({ force: true }).catch((e) => console.error("profile open", e.message));
  await sleep(2000);
  await page.screenshot({ path: join(OUT, "03-profile-after.png") });
  await browser.close();
  console.log("shots in", OUT);
} finally {
  child.kill("SIGTERM");
}
