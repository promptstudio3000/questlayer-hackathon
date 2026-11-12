// Real local API and UI with disposable demo accounts. No production configuration or signing.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { daytimeOffset } from "./lib/e2e-clock.mjs";

const root = resolve(import.meta.dirname, "..");
const shots = resolve(process.env.E2E_SHOTS || "output/qa/mobile-polish-2026-11-06/screens");
mkdirSync(shots, { recursive: true });
const isolated = mkdtempSync(join(tmpdir(), "questlayer-mobile-polish-"));
const offset = daytimeOffset();
const port = await new Promise(done => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", join(root, "scripts/lib/e2e-clock.mjs"), join(root, "server/index.mjs")], {
  cwd: isolated,
  env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: url,
    DATABASE_PATH: join(isolated, "demo.sqlite"), DISABLE_RELAYER: "1", DISABLE_NATIVE_ATTESTATIONS: "1",
    NEAR_RPC_URL: "http://127.0.0.1:9", E2E_CLOCK_OFFSET_MS: String(offset) },
  stdio: ["ignore", "ignore", "pipe"],
});
let errors = "";
server.stderr.on("data", d => { errors += d; });
const axe = createRequire(import.meta.url)("axe-core").source;
const engine = process.env.E2E_BROWSER === "webkit" ? webkit : chromium;
const report = { browser: engine.name(), scope: "Local application and real demo API; synthetic movement/positions", viewports: [], checks: [] };
let browser;
try {
  const until = Date.now() + 60000;
  while (true) {
    try { if ((await fetch(url + "/api/health")).ok) break; } catch {}
    if (Date.now() > until) throw Error(errors.slice(-1000));
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await engine.launch();
  for (const [name, width, height] of [["phone-360", 360, 780], ["phone-390", 390, 844], ["landscape", 844, 390], ["desktop", 1440, 900]]) {
    if (process.env.E2E_VIEWPORT && process.env.E2E_VIEWPORT !== name) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});
    await context.addInitScript(({ offset }) => {
      const RealDate = Date;
      class PreviewDate extends RealDate {
        constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
        static now() { return RealDate.now() + offset; }
      }
      window.Date = PreviewDate;
    }, { offset });
    const page = await context.newPage();
    const faults = [];
    page.on("pageerror", e => faults.push({ message: e.message, stack: e.stack }));
    const accountReads = new Set();
    page.on("request", request => { if (request.url() === url + "/api/account") accountReads.add(request); });
    page.on("requestfinished", request => accountReads.delete(request));
    page.on("requestfailed", request => accountReads.delete(request));
    async function navigate(reload = false) {
      // Let the initial optional account read finish before a forced reload.
      // WebKit otherwise reports the deliberately interrupted read as a CORS error.
      if (reload) {
        await page.waitForLoadState("networkidle");
        const until = Date.now() + 10000;
        while (accountReads.size && Date.now() < until) await new Promise(r => setTimeout(r, 50));
        assert.equal(accountReads.size, 0, "Existing account reads finish before the test forces navigation");
      }
      const account = page.waitForResponse(r => r.url() === url + "/api/account" && r.request().method() === "GET");
      if (reload) await page.reload(); else await page.goto(url);
      await (await account).finished();
    }
    const post = async (path, data) => {
      const r = await context.request.post(url + "/api" + path, { headers: { Origin: url }, data });
      const body = await r.json();
      assert.ok(r.ok(), path + ": " + JSON.stringify(body));
      return body;
    };
    await post("/session", { name: `Mira ${name}` });
    const world = await post("/world", { arena: true, location: { lat: 49.74745, lng: 13.3774 } });
    await navigate();
    await page.getByRole("button", { name: "Inventory", exact: true }).waitFor();
    await page.locator(".world-loading").waitFor({ state: "hidden", timeout: 60000 });
    const mapReady = await page.locator(".map-loading").waitFor({ state: "hidden", timeout: 30000 }).then(() => true, () => false);
    const scans = [];
    async function check(label) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ": no horizontal overflow");
      if (width === 390) {
        await page.addScriptTag({ content: axe });
        const issues = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })));
        assert.deepEqual(issues.filter(v => ["serious", "critical"].includes(v.impact)), [], label + ": accessibility");
        scans.push({ label, issues });
      }
      await page.screenshot({ path: join(shots, `${name}-${label}.png`) });
    }
    await check("map");
    const opener = page.getByRole("button", { name: "Demo controls", exact: true });
    const pad = page.locator(".demo-pad");
    await pad.waitFor();
    assert.equal(await opener.count(), 0, "Fresh demo starts with movement open");
    const padBounds = await pad.boundingBox();
    assert.ok(padBounds.x >= 0 && padBounds.x + padBounds.width <= width && padBounds.height <= 60, "Open movement fits in one minimal row");
    const controls = await pad.locator("button").evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }));
    assert.ok(controls.every(r=>r.width>=47.9&&r.height>=47.9&&Math.abs(r.y-controls[0].y)<1), "Movement keeps 48px controls in one row");
    const anchors = await page.locator(".nav-rail,.demo-pad,.map-toolbar").evaluateAll(els=>els.map(el=>({name:el.className,x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
    const overlaps = await page.locator(".nav-rail,.demo-pad,.map-toolbar,.main-panel.sheet-compact,.nearby-open").evaluateAll(els=>{
      const boxes=els.filter(el=>el.checkVisibility()).map(el=>({name:el.className,r:el.getBoundingClientRect()}));
      return boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>a.r.left<b.r.right&&a.r.right>b.r.left&&a.r.top<b.r.bottom&&a.r.bottom>b.r.top).map(b=>[a.name,b.name]));
    });
    assert.deepEqual(overlaps,[],"The objective, navigation, tools and open movement never overlap");
    await check("map-controls");
    // A modal also stops a movement key that was held before it opened.
    await page.keyboard.down("ArrowUp");
    await page.waitForFunction(()=>document.querySelector(".demo-forward")?.getAttribute("aria-pressed")==="true");
    await page.locator(".daily-board-chip").click();
    await page.locator("dialog[open]").waitFor();
    await page.waitForFunction(()=>document.querySelector(".demo-forward")?.getAttribute("aria-pressed")==="false");
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({state:"hidden"});
    assert.equal(await page.locator(".demo-forward").getAttribute("aria-pressed"),"false","Closing a modal does not resume old movement");
    await page.keyboard.up("ArrowUp");
    assert.deepEqual(await page.locator(".nav-rail,.demo-pad,.map-toolbar").evaluateAll(els=>els.map(el=>({name:el.className,x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y}))),anchors,"Modal geometry does not move controls");
    await page.getByRole("button", { name: "Hide demo controls", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.matches(".demo-pad-open"));
    assert.equal(await opener.evaluate(el => el === document.activeElement), true, "Hiding movement returns focus");
    await navigate(true);
    await opener.waitFor();
    assert.equal(await pad.count(), 0, "An explicit collapse survives reload");
    await opener.click();
    await page.waitForFunction(() => document.activeElement?.matches(".demo-forward"));
    await navigate(true);
    await pad.waitFor();
    if(width===390) {
      const hide=page.getByRole("button",{name:"Hide objective",exact:true});
      if(await hide.isVisible()) {
        await hide.click();
        await page.locator(".topbar .profile-pill").click();
        await page.getByRole("tab",{name:"Settings",exact:true}).click();
        await page.getByRole("button",{name:"Show first steps again",exact:true}).click();
        await page.locator(".first-session").waitFor();
        assert.ok(await page.locator(".main-panel").isVisible(),"Settings restores a dismissed guide without resetting progress");
        await check("guide-restored");
      }
    }
    await page.locator(".nav-rail").getByRole("button", { name: "Inventory", exact: true }).click();
    await page.locator(".inventory-experience").waitFor();
    await check("inventory-empty");
    assert.equal(await page.locator(".inv-catalog[open]").count(), 0);
    await page.locator(".inv-catalog > summary").click();
    assert.ok(await page.locator(".inv-catalog .inv-cell.locked:visible").count() > 0, "Unowned catalog remains available");
    await check("inventory-catalog");
    await page.locator(".inv-catalog > summary").click();
    await page.locator(".inv-character-details > summary").click();
    assert.ok(await page.locator(".inv-level-bar").isVisible(), "Existing progression remains available");
    await page.locator(".inv-character-details > summary").click();
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.getByRole("button", { name: "Map tools", exact: true }).click();
    await page.getByRole("button", { name: "Nearby discoveries", exact: true }).click();
    await page.locator(".zone-card").filter({ hasText: "FREE" }).first().click();
    await page.locator(".quest-detail, .locked-panel").first().waitFor();
    await check("quest-detail");
    await page.keyboard.press("Escape");
    await page.locator("dialog.game-dialog-map").waitFor({ state: "detached" });

    // Seed one owned Aura by the unchanged demo claim API, then inspect actual UI state.
    const now = Date.now() + offset;
    const chest = world.quests.find(q => q.kind === "chest" && q.tier === 1 && q.opens_at <= now && q.closes_at > now && q.itemAvailable === true);
    assert.ok(chest, "A fresh demo has an eligible Aura chest");
    const point = chest.nextPoint || chest;
    const claimed = await post("/quests/claim", { questId: chest.id, checkpoint: 0, fix: { lat: point.lat, lng: point.lng, accuracy: 0, timestamp: now } });
    assert.ok(claimed.item, "The unchanged server confirms an actual demo item");
    const equipped = await post("/equip", { itemId: claimed.item.id });
    assert.ok(equipped.player.inventory.find(i => i.id === claimed.item.id)?.equipped);
    await navigate(true);
    await page.locator(".nav-rail").getByRole("button", { name: "Inventory", exact: true }).click();
    const item = page.locator(".inv-grid .inv-cell.worn").first();
    await item.waitFor();
    await check("inventory-owned");
    await item.click();
    await page.locator(".inv-detail-actions").getByRole("button", { name: "Take it off", exact: true }).waitFor();
    await check("item-detail");
    await page.locator(".inv-detail-actions").getByRole("button", { name: "Take it off", exact: true }).click();
    await page.locator(".inv-detail-actions").getByRole("button", { name: "Try it on", exact: true }).click();
    await page.locator(".inv-detail-actions").getByRole("button", { name: "Take it off", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator("dialog:has(.inv-detail)").waitFor({ state: "detached" });
    await page.waitForFunction(() => document.activeElement?.matches(".inv-grid .inv-cell.worn"));
    assert.equal(await item.evaluate(el => el === document.activeElement), true, "Item detail returns focus to its slot");
    if (width === 390) {
      await item.click();
      await page.getByRole("button", { name: "Sell", exact: true }).click();
      await page.locator("#inventory-list-price").fill("50000");
      await page.setViewportSize({ width, height: 420 });
      await page.locator("#inventory-list-price").focus();
      await check("item-keyboard-viewport");
      await page.setViewportSize({ width, height });
      await page.locator(".inv-detail *").evaluateAll(els => els.filter(el => el.matches("input,textarea,select") || [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())).forEach(el => el.style.setProperty("font-size", `${parseFloat(getComputedStyle(el).fontSize) * 2}px`, "important")));
      await check("item-enlarged-text");
      assert.equal(await page.locator("#inventory-list-price").inputValue(), "50000");
    }
    assert.deepEqual(faults, [], "No browser errors");
    report.viewports.push({ name, width, height, mapReady, scans, faults });
    await context.close();
    console.log(`${name}: map, discovery, empty/catalog/owned inventory and item checks passed`);
  }
  report.checks = ["Open-by-default one-row movement, 48px controls, no map-control overlap and collapse/reopen focus", "Explicit movement preferences survive reload; modal opening releases held input", "Catalog retained behind disclosure", "Progression remains inspectable", "Existing claim/equip server responses", "Item dialog focus return after equip/unequip recreates the trigger", "Keyboard viewport and enlarged text"];
  writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
