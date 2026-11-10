// Visual QA for a wallet that owns Aavegotchis (docs/PLAYER-CARDS.md).
// Starts a throwaway server, makes an explorer, links a real Base address the
// way ETH wallet sign-in does (empty snapshot, never checked) and captures the
// inventory. Needs Base RPC. Usage: npm run build && node scripts/qa-gotchi-owner.mjs [outDir] [address]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(process.argv[2] || join(ROOT, "output/qa/gotchi-owner"));
const ADDRESS = process.argv[3] || "0xf5Fe364D18F4a5A53BADCe9a046ba74cfC97f6Fb";
mkdirSync(OUT, { recursive: true });
const port = await new Promise((done) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => done(port));
  });
});
const dir = mkdtempSync(join(tmpdir(), "questlayer-gotchi-owner-"));
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", locale: "en-GB" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").fill("Owner");
  await page.getByRole("button", { name: "Start exploring" }).click();
  await page.locator(".maplibregl-canvas").waitFor();
  const me = await page.evaluate(async () => (await (await fetch("/api/me")).json()));
  const id = me.player?.id || me.id;
  // What ETH wallet sign-in writes (server/index.mjs /api/auth/evm/verify).
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT OR IGNORE INTO external_links VALUES (?,?,?,?)").run(ADDRESS, id, "{}", 0);
  db.close();
  if (process.env.QA_LINK_HOOK) await page.evaluate(async () => fetch("/api/me"));
  await page.reload();
  await page.locator(".maplibregl-canvas").waitFor();
  await sleep(4000);
  await page.screenshot({ path: join(OUT, "00-map-390.png") });
  await page.goto(`${url}/?tab=inventory`);
  const bag = page.getByRole("button", { name: "Inventory" }).first();
  if (await bag.isVisible().catch(() => false)) await bag.click();
  await sleep(3000);
  await page.screenshot({ path: join(OUT, "01-inventory-390.png"), fullPage: true });
  for (const name of ["Wardrobe", "Character", "Gotchi", "Badges", "Messages"]) {
    const tab = page.locator(`[role=tab], .inv-action-button`).filter({ hasText: new RegExp(`^\\s*${name}`) }).first();
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click();
    await sleep(3000);
    await page.screenshot({ path: join(OUT, `02-tab-${name.toLowerCase()}-390.png`), fullPage: true });
  }
  const back = page.locator('.inv-subhead .panel-back').first();
  if (await back.isVisible().catch(() => false)) await back.click();
  const history = page.locator(".inv-action-button").filter({ hasText: "History" }).first();
  if (await history.isVisible().catch(() => false)) {
    await history.click();
    await sleep(800);
    for (const s of await page.locator("summary").filter({ hasText: /Aura catalog/ }).all()) await s.click().catch(() => {});
    await sleep(800);
    await page.screenshot({ path: join(OUT, "03-history-catalog-390.png") });
  }
  await page.goto(url);
  await page.locator(".maplibregl-canvas").waitFor();
  await sleep(4000);
  await page.screenshot({ path: join(OUT, "04-map-after-390.png") });
  // Own profile: tap your explorer on the map.
  await page.locator(".player-marker").first().click({ force: true });
  await page.locator(".player-card h2").first().waitFor();
  await sleep(2500);
  await page.screenshot({ path: join(OUT, "05-own-profile-390.png") });
  await browser.close();
  console.log("shots in", OUT);
} finally {
  child.kill("SIGTERM");
}
