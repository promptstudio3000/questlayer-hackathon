// Actual local UI/API with disposable demo data. No production environment or chain actions.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const phase = process.env.E2E_PHASE || "after";
const engine = process.env.E2E_BROWSER === "webkit" ? webkit : chromium;
const shots = resolve(process.env.E2E_SHOTS || `output/qa/profile-community-2026-11-06/${phase}`);
mkdirSync(shots, { recursive: true });
const isolated = mkdtempSync(join(tmpdir(), "questlayer-profile-community-"));
const port = await new Promise(done => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, "server/index.mjs")], {
  cwd: isolated,
  env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: url,
    DATABASE_PATH: join(isolated, "demo.sqlite"), DISABLE_RELAYER: "1", DISABLE_NATIVE_ATTESTATIONS: "1", NEAR_RPC_URL: "http://127.0.0.1:9" },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "";
server.stderr.on("data", d => { stderr += d; });
const axe = createRequire(import.meta.url)("axe-core").source;
const report = { phase, engine: engine.name(), provenance: "Actual local app and demo API; disposable accounts and public notes only in this test process", viewports: [] };
let browser;
try {
  const until = Date.now() + 60000;
  while (true) {
    try { if ((await fetch(url + "/api/health")).ok) break; } catch {}
    if (Date.now() > until) throw Error(stderr.slice(-1000));
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await engine.launch();
  for (const [name, width, height] of [["phone-360", 360, 780], ["phone-390", 390, 844], ["landscape", 844, 390], ["desktop", 1440, 900]]) {
    if (process.env.E2E_VIEWPORT && process.env.E2E_VIEWPORT !== name) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const faults = [];
    page.on("pageerror", e => faults.push(e.message));
    const scans = [];
    async function capture(label) {
      await page.screenshot({ path: join(shots, `${name}-${label}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ": page width");
      if (width === 390) {
        await page.addScriptTag({ content: axe });
        const issues = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })));
        scans.push({ label, issues });
        assert.deepEqual(issues.filter(i => ["serious", "critical"].includes(i.impact)), [], label + ": accessibility");
      }
    }
    const openProfile = async () => {
      await page.locator(".topbar .profile-pill").click();
      await page.locator(".profile-hero").waitFor();
    };
    const openCommunity = async () => {
      await page.locator(".nav-rail").getByRole("button", { name: "Community", exact: true }).click();
      await page.getByRole("tablist", { name: "Community", exact: true }).waitFor();
    };
    const close = async () => { await page.getByRole("button", { name: "Close panel", exact: true }).click(); };
    await page.goto(url);
    await page.getByLabel("What should we call you?", { exact: true }).fill("Mira");
    await page.getByRole("button", { name: "Start exploring", exact: true }).click();
    await page.getByRole("button", { name: "Let's explore", exact: true }).click();
    await page.locator(".topbar .profile-pill").waitFor();
    await openProfile();
    await page.locator(".world-loading").waitFor({ state: "detached" });
    await page.locator(".app-shell > .toast").waitFor({ state: "detached" });
    await capture("character");
    const characterTab = page.getByRole("tab", { name: "Character", exact: true });
    await characterTab.focus();
    await page.keyboard.press("End");
    assert.equal(await page.getByRole("tab", { name: "Settings", exact: true }).getAttribute("aria-selected"), "true", "Keyboard tabs select Settings");
    await page.keyboard.press("Home");
    assert.equal(await characterTab.getAttribute("aria-selected"), "true", "Keyboard tabs return to Character");
    if (phase !== "before") {
      const sizes = await page.getByRole("tablist", { name: "Profile", exact: true }).getByRole("tab").evaluateAll(els => els.map(el => ({ label: el.textContent.trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      assert.deepEqual(sizes.filter(s => s.width < 47.9 || s.height < 47.9), [], "Profile tabs have 48px targets");
      assert.ok(await page.locator(".profile-hero-avatar").evaluate(el => el.querySelector(".profile-hero-source").getBoundingClientRect().bottom <= el.querySelector(".character-composition").getBoundingClientRect().top), "Appearance disclosure does not overlap the character");
    }
    // Badges are a chapter of Character; Stake holds Stake and Earnings behind one switch.
    await page.locator(".badge-medal").first().waitFor();
    await page.getByRole("button", { name: /^Badges/ }).click();
    await capture("profile-badges");
    for (const section of ["Stake", "Settings"]) {
      await page.getByRole("tab", { name: section, exact: true }).click();
      if (section === "Stake") await page.locator(".fuel").waitFor();
      await page.waitForTimeout(250);
      await capture("profile-" + section.toLowerCase());
      if (section === "Stake") {
        await page.getByRole("button", { name: "Earnings", exact: true }).click();
        await page.locator(".earn-hero").waitFor();
        await capture("profile-earnings");
      }
    }
    await page.getByRole("tab", { name: "Character", exact: true }).click();
    await page.locator(".journey").waitFor();
    await close();
    await openProfile();
    if (width === 390) {
      await page.locator(".profile-hero *").evaluateAll(els => els.filter(el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())).map(el => [el, parseFloat(getComputedStyle(el).fontSize)]).forEach(([el, size]) => el.style.setProperty("font-size", `${size * 2}px`, "important")));
      await capture("character-enlarged-text");
    }
    await close();
    await openCommunity();
    await page.getByText("Creator quests are not enabled on this host yet. Nearby posts and sponsored tasks remain available in the Local chat and Tasks tabs.", { exact: true }).waitFor();
    await capture("community-unavailable");
    if (phase !== "before") {
      await page.locator(".community-available-actions").getByRole("button", { name: "Local chat", exact: true }).click();
      await page.getByRole("button", { name: "Write a note", exact: true }).waitFor();
      await page.getByRole("tab", { name: "Quests", exact: true }).click();
      await page.locator(".community-available-actions").getByRole("button", { name: "Community tasks", exact: true }).click();
      assert.equal(await page.getByRole("tab", { name: "Tasks", exact: true }).getAttribute("aria-selected"), "true");
    }
    for (const section of ["Tasks", "Places", "Creators"]) {
      await page.getByRole("tab", { name: section, exact: true }).click();
      await page.waitForTimeout(250);
      await capture("community-" + section.toLowerCase());
    }
    await page.getByRole("tab", { name: "Local chat", exact: true }).click();
    await page.getByRole("button", { name: "Write a note", exact: true }).waitFor();
    await capture("community-empty");
    await page.getByRole("button", { name: "Write a note", exact: true }).click();
    await page.locator("#map-note-text").fill("The fountain is a quiet place to pause between discoveries.");
    await page.getByText("Public at this pin", { exact: false }).waitFor();
    await capture("note-compose");
    if (width === 390) {
      await page.setViewportSize({ width, height: 420 });
      await page.locator("#map-note-text").focus();
      await capture("note-keyboard-viewport");
      await page.setViewportSize({ width, height });
      await page.locator(".quick-create *").evaluateAll(els => els.filter(el => el.matches("textarea,input") || [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())).map(el => [el, parseFloat(getComputedStyle(el).fontSize)]).forEach(([el, size]) => {
        el.dataset.qaFont = el.style.fontSize;
        el.style.setProperty("font-size", `${size * 2}px`, "important");
      }));
      await capture("note-enlarged-text");
      await page.getByRole("button", { name: "Leave the note here", exact: true }).scrollIntoViewIfNeeded();
      await capture("note-enlarged-text-actions");
      assert.ok(await page.getByRole("button", { name: "Leave the note here", exact: true }).isVisible(), "Publication remains reachable with 200% text");
      await page.locator(".quick-create [data-qa-font]").evaluateAll(els => els.forEach(el => {
        el.style.removeProperty("font-size");
        if (el.dataset.qaFont) el.style.fontSize = el.dataset.qaFont;
        delete el.dataset.qaFont;
      }));
    }
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await close();
    await openCommunity();
    await page.getByRole("tab", { name: "Local chat", exact: true }).click();
    const resume = page.getByRole("button", { name: "Resume draft", exact: true });
    if (await resume.isVisible()) await resume.click();
    await page.locator("#map-note-text").waitFor();
    assert.equal(await page.locator("#map-note-text").inputValue(), "The fountain is a quiet place to pause between discoveries.", "Draft survives returning to the map");
    await page.getByRole("button", { name: "Leave the note here", exact: true }).click();
    await page.locator(".map-note").first().waitFor();
    assert.equal(await page.locator(".map-note").count(), 1, "One server-confirmed local public note");
    await page.locator(".app-shell > .toast").waitFor({ state: "detached" });
    await capture("community-notes");
    await page.locator(".map-note-menu > summary").click();
    await page.getByRole("button", { name: "Remove note", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await capture("note-remove-dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator(".map-note").count(), 1, "Cancelling removal preserves the note");
    await page.getByRole("button", { name: "Remove note", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove note", exact: true }).click();
    await page.locator(".map-note").waitFor({ state: "detached" });
    assert.deepEqual(faults, [], "No browser errors");
    report.viewports.push({ name, width, height, scans, faults, checks: ["All profile routes", "Character story", "Creator capability and all Community routes", "Public disclosure", "Draft restoration", "Local publication", "Removal cancellation"] });
    writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
    await context.close();
    console.log(`${name}: Profile, Community and public-note interactions passed`);
  }
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
