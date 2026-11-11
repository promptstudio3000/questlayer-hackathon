// Isolated UI acceptance. No .env, existing state, relayer or signing keys.
// npm run build; node scripts/e2e-weekend.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium, webkit, devices } from "playwright";
import { createRequire } from "node:module";
import { openMapSettings } from "./lib/e2e-nav.mjs";
const axeSource = createRequire(import.meta.url)("axe-core").source;

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
    if (process.env.E2E_VIEWPORT && name !== process.env.E2E_VIEWPORT) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});
    const page = await context.newPage();
    const faults = []; const resources = []; page.on("requestfailed", r => resources.push({ url: r.url().split("?")[0], error: r.failure()?.errorText })); page.on("pageerror", e => faults.push(e.message));
    await page.goto(url);
    await page.getByLabel("What should we call you?").fill("UI explorer");
    if (width === 390) {
      await page.locator(".welcome-card *").evaluateAll(elements => {
        const saved=elements.map(el=>[el,el.style.fontSize,getComputedStyle(el).fontSize,el.style.getPropertyPriority("font-size")]);
        window.__restoreText=()=>saved.forEach(([el,style,,priority])=>el.style.setProperty("font-size",style,priority));
        saved.filter(([el])=>el.matches("input,textarea,select")||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,,size])=>el.style.setProperty("font-size",`${parseFloat(size)*2}px`,"important"));
      });
      await page.screenshot({path:join(SHOTS,"enlarged-text-welcome.png")});
      assert.equal(await page.locator("#nickname").evaluate(el=>getComputedStyle(el).fontSize),"32px");
      await page.evaluate(()=>window.__restoreText());
    }
    if (width === 390) {
      await page.setViewportSize({ width, height: 420 });
      await page.getByLabel("What should we call you?").focus();
      await page.screenshot({ path: join(SHOTS, "keyboard-viewport-welcome.png") });
      await page.setViewportSize({ width, height });
    }
    if (width === 390) {
      await page.route("**/api/session", route => route.abort("failed"), { times: 1 });
      await page.getByRole("button", { name: "Start exploring", exact: true }).click();
      await page.locator(".welcome-card .inline-error").waitFor();
      assert.equal(await page.locator("#nickname").inputValue(), "UI explorer");
      await page.screenshot({ path: join(SHOTS, "welcome-lost-response.png") });
    }
    await page.getByRole("button", { name: "Start exploring", exact: true }).click();
    await page.getByRole("button", { name: "Let's explore", exact: true }).click();
    await page.getByRole("button", { name: "Inventory", exact: true }).waitFor();
    await page.locator(".maplibregl-canvas").waitFor({ timeout: 30000 });
    await page.locator(".world-loading").waitFor({ state: "hidden", timeout: 60000 });
    const mapReady = await page.locator(".map-loading").waitFor({ state: "hidden", timeout: 15000 }).then(() => true, () => false);
    await page.screenshot({ path: join(SHOTS, `${name}-map.png`) });
    const scans = [];
    async function scan(label) {
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, checks: n.any })) })));
      scans.push({ label, violations, contentHeight: await page.locator(".main-panel").evaluate(el => el.scrollHeight) });
      if (violations.length) console.log(JSON.stringify(violations));
      assert.deepEqual(violations.filter(v => ["serious", "critical"].includes(v.impact)), [], `${label}: accessibility`);
    }
    const targets = await page.locator(".topbar button, .rail-links button, .map-toolbar button, .map-status-chip button, .demo-pad button, .demo-pad-open, .sheet-compact button").evaluateAll(elements => elements.map(el => ({label:el.getAttribute("aria-label") || el.textContent.trim(), rect:el.getBoundingClientRect(), visible:el.checkVisibility()})).filter(x => x.visible).map(x => ({label:x.label,width:x.rect.width,height:x.rect.height})));
    assert.deepEqual(targets.filter(x => x.width < 47.9 || x.height < 47.9), [], "Essential map controls have 48px targets");
    assert.ok(await page.locator(".demo-pad").isVisible(), "Demo movement starts open");
    const pad = await page.locator(".demo-pad").boundingBox();
    assert.ok(pad.height <= 60, "Demo controls occupy one row");
    if (width === 390) await scan("map");
    const objective = await page.locator(".sheet-compact").boundingBox();
    assert.ok(objective && objective.height < height / 2, `${name}: objective leaves half the map visible`);
    for (const screen of ["Inventory", "Community", "Profile"]) {
      if (screen === "Profile") await page.locator(".topbar .profile-pill").click();
      else await page.locator(".nav-rail").getByRole("button", { name: screen, exact: true }).click();
      await page.locator(".main-panel h1").waitFor();
      if (screen === "Inventory") await page.locator(".inventory-experience").waitFor();
      if (screen === "Profile") await page.locator(".profile-hero").waitFor();
      await page.screenshot({ path: join(SHOTS, `${name}-${screen.toLowerCase()}.png`) });
      const bounds = await page.locator(".main-panel").boundingBox();
      if (width >= 900 && height >= 560)
        assert.ok(bounds.width <= 962 && bounds.y >= 30 && bounds.height <= height - 60, `${name}: ${screen} is a card over the map on desktop`);
      else assert.ok(bounds.y < 2 && bounds.height >= height - 2, `${name}: ${screen} uses the whole screen`);
      assert.ok(await page.locator(".map-stage").getAttribute("inert") !== null);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (width === 390) {
        const tabs = page.locator(".screen-tabs-primary [role=tab]");
        for (let i = 0; i < await tabs.count(); i++) {
          await tabs.nth(i).click();
          await page.waitForTimeout(400);
          await scan(`${screen}-${i}`);
          if (screen === "Profile") assert.ok(await page.locator(".main-panel").evaluate(el=>el.scrollHeight)<=height*2, "Profile sections fit two phone heights");
          if (screen === "Profile" && i === 1) {
            const first=await page.locator(".badge-medal").first().getAttribute("aria-label");
            assert.equal(await page.locator(".badge-medal").count(),12);
            await page.getByRole("button",{name:"Next page",exact:true}).click();
            assert.notEqual(await page.locator(".badge-medal").first().getAttribute("aria-label"),first);
            await page.getByRole("button",{name:"Previous page",exact:true}).click();
            assert.equal(await page.locator(".badge-medal").first().getAttribute("aria-label"),first);
            await page.screenshot({path:join(SHOTS,"profile-badges-paged.png")});
          }
        }
        if (screen === "Community") {
          await page.getByRole("tab", { name:"Local chat", exact:true }).click();
          await page.getByRole("button", { name:"Write a message", exact:true }).click();
          await page.locator("#map-note-text").fill("A draft kept through returning to the map.");
          await page.setViewportSize({width,height:420});
          await page.locator("#map-note-text").focus();
          await page.screenshot({ path:join(SHOTS,"keyboard-viewport-local-chat.png") });
          await context.setOffline(true);
          assert.match(await page.locator("#map-note-text").inputValue(), /A draft kept/);
          await page.screenshot({ path:join(SHOTS,"offline-local-chat.png") });
          await context.setOffline(false);
          await page.setViewportSize({width,height});
          await page.keyboard.press("Escape");
          await page.locator(".nav-rail").getByRole("button", {name:"Community",exact:true}).click();
          await page.getByRole("tab", { name:"Local chat", exact:true }).click();
          const resume = page.getByRole("button", { name:"Resume draft", exact:true });
          if (await resume.isVisible()) await resume.click();
          await page.locator("#map-note-text").waitFor();
          assert.match(await page.locator("#map-note-text").inputValue(), /A draft kept/);
          await page.screenshot({path:join(SHOTS,"local-chat-resumed-draft.png")});
          await page.locator(".map-notes-compose *").evaluateAll(elements => {
            const saved=elements.map(el=>[el,el.style.fontSize,getComputedStyle(el).fontSize,el.style.getPropertyPriority("font-size")]);
            window.__restoreText=()=>saved.forEach(([el,style,,priority])=>el.style.setProperty("font-size",style,priority));
            saved.filter(([el])=>el.matches("input,textarea,select")||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,,size])=>el.style.setProperty("font-size",`${parseFloat(size)*2}px`,"important"));
          });
          await page.screenshot({path:join(SHOTS,"enlarged-text-local-chat.png")});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
          await page.evaluate(()=>window.__restoreText());
        }
        if (screen === "Profile") {
          await page.locator(".main-panel *").evaluateAll(elements => elements.map(el => [el, getComputedStyle(el).fontSize]).filter(([el]) => el.matches("input,textarea,select") || [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())).map(([el,size]) => { el.style.setProperty("font-size",`${parseFloat(size)*2}px`,"important"); return size; }));
          await page.screenshot({ path: join(SHOTS, "enlarged-text-profile.png") });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "200% text keeps page width");
        }
        await page.keyboard.press("Escape");
        await page.locator(".main-panel.sheet-compact").waitFor();
        assert.ok(await page.evaluate(() => document.activeElement !== document.body), "Closing returns focus");
      } else await page.getByRole("button", { name: "Close panel", exact: true }).click();
    }
    if (width === 390) {
      const cameraBefore=await page.locator(".player-marker").first().getAttribute("style");
      await page.locator(".topbar .profile-pill").click();
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      const cameraAfter=await page.locator(".player-marker").first().getAttribute("style");
      assert.equal(cameraAfter,cameraBefore,"Map camera remains stable across a content screen");
      await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=(_ok,fail)=>fail({code:1,message:"denied"});});
      await (await openMapSettings(page)).getByRole("button",{name:"Use GPS, my location",exact:true}).click();
      await page.getByText("Allow location access, or keep exploring in the city demo.",{exact:true}).first().waitFor();
      assert.ok(await page.locator(".map-status-chip.demo").count());
      await page.screenshot({path:join(SHOTS,"gps-denied.png")});
      await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=ok=>ok({coords:{latitude:49.7384,longitude:13.3736,accuracy:999,heading:null,speed:0},timestamp:Date.now()});navigator.geolocation.watchPosition=()=>1;});
      await (await openMapSettings(page)).getByRole("button",{name:"Use GPS, my location",exact:true}).click();
      await page.getByText("GPS ±999 m",{exact:true}).waitFor();
      assert.equal(await page.locator(".demo-pad").count(),0,"GPS play never offers manual movement");
      await page.screenshot({path:join(SHOTS,"gps-inaccurate.png")});
      await page.goto(url + "/wiki");
      await page.locator(".wk-chapter").first().waitFor();
      assert.equal(await page.locator(".wk-chapter").count(),22);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),false);
      await page.screenshot({path:join(SHOTS,"wiki-phone-390.png")});
    }
    report.push({ name, faults, mapReady, resources, targets, scans });
    assert.deepEqual(faults, []);
    await context.close();
  }
  const ios = await webkit.launch();
  try {
    const {defaultBrowserType,...profile}=devices["iPhone 15"];
    const context=await ios.newContext({...profile,reducedMotion:"reduce"});await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});
    const page=await context.newPage();await page.clock.install();await page.goto(url);
    await page.locator("#nickname").fill("Install explorer");
    await page.getByRole("button",{name:"Start exploring",exact:true}).click();
    await page.getByRole("button",{name:"Let's explore",exact:true}).click();
    await page.getByRole("button",{name:"Hide objective",exact:true}).click();
    await page.clock.runFor(50000);
    const card=page.locator(".pwa-install");await card.waitFor();
    const overlaps=await page.evaluate(()=>{
      const c=document.querySelector(".pwa-install").getBoundingClientRect();
      return [...document.querySelectorAll(".topbar,.nav-rail,.demo-pad,.map-toolbar")].filter(el=>el.checkVisibility()).filter(el=>{
        const b=el.getBoundingClientRect();return c.left<b.right&&c.right>b.left&&c.top<b.bottom&&c.bottom>b.top;
      }).map(el=>el.className);
    });assert.deepEqual(overlaps,[],"Install offer keeps map controls available");
    await page.screenshot({path:join(SHOTS,"iphone-install-map.png")});
    await page.locator(".topbar .profile-pill").click();await page.clock.runFor(2500);
    await card.waitFor({state:"hidden"});
    await page.getByRole("button",{name:"Close panel",exact:true}).click();await page.clock.runFor(2500);
    await card.waitFor();
    writeFileSync(join(SHOTS,"pwa-report.json"),JSON.stringify({engine:"WebKit iPhone 15 emulation",overlaps,hiddenDuringContent:true,returnedOnMap:true},null,2));
    await context.close();
  } finally {await ios.close();}
  writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ shots: SHOTS, report }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
