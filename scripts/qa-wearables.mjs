// Visual QA for Aavegotchi wearable clones and explorer cards
// (docs/PLAYER-CARDS.md). Starts a throwaway server, makes two explorers,
// gives one of them wearables (one verified through a fake ownership
// snapshot written straight into the throwaway database), shares both
// positions and captures the map, the explorer card and the wardrobe.
// Usage: npm run build && node scripts/qa-wearables.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(process.argv[2] || join(ROOT, "output/qa/wearables"));
mkdirSync(OUT, { recursive: true });
const port = await new Promise((done) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => done(port));
  });
});
const dir = mkdtempSync(join(tmpdir(), "questlayer-wearables-"));
const url = `http://127.0.0.1:${port}`;
const dbPath = join(dir, "qa.sqlite");
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", APP_ORIGIN: url, DATABASE_PATH: dbPath, DISABLE_RELAYER: "1" },
  stdio: ["ignore", "inherit", "inherit"],
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
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", locale: "en-GB" };
  async function explorer(name, profile = phone) {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error(name, "page error:", e.message));
    await page.goto(url);
    await page.getByPlaceholder("Your explorer name").fill(name);
    await page.getByRole("button", { name: "Start exploring" }).click();
    await page.locator(".maplibregl-canvas").waitFor();
    const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()));
    return { page, context, id: me.player?.id || me.id };
  }
  const mira = await explorer("Mira");
  const tomas = await explorer("Tomas");
  // Mira gets three wearables; the hat is a verified original.
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  db.prepare("INSERT OR REPLACE INTO external_links VALUES (?,?,?,?)").run(
    "0x" + "b".repeat(40), mira.id,
    JSON.stringify({ gotchis: [], wearables: [{ itemId: "10", quantity: "1" }], verifiedAt: now }), now,
  );
  for (const id of [74, 3])
    db.prepare("INSERT OR IGNORE INTO wearable_clones VALUES (?,?,?,?,?)").run(mira.id, id, "find", 0, now);
  db.close();
  for (const id of [10, 74, 3])
    console.log("equip", id, await mira.page.evaluate(async (itemId) => (await fetch("/api/wearables/equip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, equipped: true }) })).status, id));
  const shareFrom = (page, lat, lng) =>
    page.evaluate(([lat, lng]) => {
      const send = (renew) => fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, renew, leaseId: "qa", lat, lng, arena: true }) });
      void send(true);
      setInterval(() => void send(false), 5000);
    }, [lat, lng]);
  await shareFrom(mira.page, 49.74765, 13.3776);
  await shareFrom(tomas.page, 49.74745, 13.3774);
  await mira.page.reload();
  await mira.page.locator(".maplibregl-canvas").waitFor();
  await sleep(3000);
  await mira.page.screenshot({ path: join(OUT, "00-own-character-wearables-390.png") });
  await tomas.page.reload();
  await tomas.page.locator(".maplibregl-canvas").waitFor();
  await tomas.page.locator(".other-player-marker").first().waitFor({ timeout: 20000 });
  await sleep(2500);
  await tomas.page.screenshot({ path: join(OUT, "01-map-other-explorer-390.png") });
  // Zoom to the wearable finds.
  const find = await tomas.page.locator(".wearable-find-marker").count();
  console.log("wearable find markers:", find);
  await tomas.page.locator(".other-player-marker").first().click();
  await tomas.page.locator(".player-card h3").first().waitFor();
  await sleep(800);
  await tomas.page.screenshot({ path: join(OUT, "02-explorer-card-390.png") });
  await tomas.page.getByRole("button", { name: "Hello!" }).click();
  await tomas.page.getByText(/Sent:/).waitFor();
  await tomas.page.screenshot({ path: join(OUT, "03-wave-sent-390.png") });
  await mira.page.getByText(/Tomas waves/).waitFor({ timeout: 20000 });
  await mira.page.screenshot({ path: join(OUT, "04-wave-received-390.png") });
  // Wardrobe.
  await mira.page.goto(`${url}/?tab=inventory`);
  const bag = mira.page.getByRole("button", { name: "Inventory" }).first();
  if (await bag.isVisible().catch(() => false)) await bag.click();
  const wardrobeTab = mira.page.getByRole("button", { name: "Wardrobe" }).first();
  await wardrobeTab.click();
  await mira.page.locator(".gotchi-wardrobe .wearable-tile").first().waitFor();
  await sleep(1500);
  await mira.page.locator(".gotchi-wardrobe").screenshot({ path: join(OUT, "05-wardrobe-390.png") });
  // Wearable finds on the map, zoomed in on the nearest one.
  const desk = await explorer("Desk", { viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", locale: "en-GB" });
  await desk.page.locator(".wearable-find-marker").first().waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(2500);
  await desk.page.screenshot({ path: join(OUT, "06-map-desktop.png") });
  const marker = desk.page.locator(".wearable-find-marker:not(.is-far)").first();
  if (await marker.count()) {
    await marker.evaluate((el) => el.click());
    await sleep(2000);
    await desk.page.screenshot({ path: join(OUT, "07-wearable-find-desktop.png") });
  }
  await browser.close();
  console.log("shots in", OUT);
} finally {
  child.kill("SIGTERM");
}
