// Isolated UI acceptance. No .env, existing state, relayer or signing keys.
// npm run build; node scripts/e2e-weekend.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = resolve(process.env.E2E_SHOTS || "output/qa/weekend-2026-11-05");
mkdirSync(SHOTS, { recursive: true });
const sandbox = mkdtempSync(join(tmpdir(), "questlayer-ui-"));
const port = await new Promise((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
  cwd: sandbox,
  env: { PATH: process.env.PATH, PORT: String(port), HOST: "127.0.0.1", APP_ORIGIN: url,
    DATABASE_PATH: join(sandbox, "ui.sqlite"), DISABLE_RELAYER: "1", DISABLE_NATIVE_ATTESTATIONS: "1",
    DISABLE_BACKGROUND_WORKERS: "0", NEAR_RPC_URL: "http://127.0.0.1:9", ACTORS_ENABLED: "1", ACTORS_ALL_DAY: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});
let errors = ""; server.stderr.on("data", d => { errors += d; });
let browser;
const report = [];
try {
  const until = Date.now() + 60000;
  while (true) {
    try { const h = await (await fetch(url + "/api/health")).json(); if (h.worldPreparation?.days?.some(d => d.state === "ready")) break; } catch {}
    if (Date.now() > until) throw new Error("Preview did not start: " + errors.slice(-1000));
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height] of [["phone-360",360,780],["phone-390",390,844],["landscape",844,390],["desktop",1440,900]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const faults = []; page.on("pageerror", e => faults.push(e.message));
    await page.goto(url);
    await page.getByLabel("What should we call you?").fill("UI explorer");
    await page.getByRole("button", { name: "Start exploring", exact: true }).click();
    await page.getByRole("button", { name: "Inventory", exact: true }).waitFor();
    await page.locator(".maplibregl-canvas").waitFor({ timeout: 30000 });
    await page.locator(".world-loading").waitFor({ state: "hidden", timeout: 60000 });
    await page.screenshot({ path: join(SHOTS, `${name}-map.png`) });
    const objective = await page.locator(".sheet-compact").boundingBox();
    assert.ok(objective && objective.height < height / 2, `${name}: objective leaves half the map visible`);
    for (const screen of ["Inventory", "Community", "Profile"]) {
      await page.locator(screen === "Profile" ? ".topbar" : ".nav-rail").getByRole("button", { name: screen, exact: true }).click();
      await page.locator(".main-panel h1").waitFor();
      if (screen === "Inventory") await page.locator(".inventory-experience").waitFor();
      if (screen === "Profile") await page.locator(".profile-hero").waitFor();
      await page.screenshot({ path: join(SHOTS, `${name}-${screen.toLowerCase()}.png`) });
      const bounds = await page.locator(".main-panel").boundingBox();
      assert.ok(bounds.y < 2 && bounds.height >= height - 2, `${name}: ${screen} uses the whole screen`);
      assert.ok(await page.locator(".map-stage").getAttribute("inert") !== null);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.getByRole("button", { name: "Close panel", exact: true }).click();
    }
    report.push({ name, faults });
    assert.deepEqual(faults, []);
    await context.close();
  }
  writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ shots: SHOTS, report }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
