// Phone check of every UI language: signs up one explorer per language at
// 390 x 844 (Chromium, touch), walks the main screens and their tabs, takes a
// screenshot of each and checks the layout:
//   - nothing makes the page scroll sideways or sticks out of the screen,
//   - no button, tab, badge or heading cuts its text off without an ellipsis,
//   - Arabic runs right-to-left (<html dir="rtl">) and the others left-to-right,
//   - no English UI string shows untranslated (a dictionary key rendered as is).
//
// Usage:  npm run build && npm run e2e:languages [-- --lang=ar,ja]
// It starts its own server on a free port with a throwaway database unless
// E2E_BASE_URL points at a running one. Screenshots and report.json land in
// output/qa/2026-11-languages/<lang>/ (override the root with E2E_SHOTS).
// Exits 1 when any language has a layout or translation problem.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { closeOpenSheet } from "./lib/e2e-nav.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const I18N = join(ROOT, "src/i18n");
const SHOTS_ROOT = resolve(process.env.E2E_SHOTS || join(ROOT, "output/qa/2026-11-languages"));
const PHONE_390 = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const RTL = new Set(["ar"]);

const DICTS = Object.fromEntries(
  readdirSync(I18N)
    .filter((n) => /^[a-z]{2,3}\.json$/.test(n))
    .map((n) => [n.slice(0, -5), JSON.parse(readFileSync(join(I18N, n), "utf8"))]),
);
const arg = process.argv.find((a) => a.startsWith("--lang="))?.slice(7);
const LANGS = ["en", ...Object.keys(DICTS).sort()].filter((l) => !arg || arg.split(",").includes(l));

async function freePort() {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

async function startServer() {
  if (process.env.E2E_BASE_URL) return { url: process.env.E2E_BASE_URL, stop() {} };
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "questlayer-lang-"));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: url,
      DATABASE_PATH: join(dir, "e2e.sqlite"),
      DISABLE_RELAYER: "1",
      DISABLE_NATIVE_ATTESTATIONS: "1",
      NEAR_RPC_URL: "http://127.0.0.1:9",
      CREATOR_COMMUNITY_ENABLED: "1",
      CREATOR_POLICY_VERSION: "e2e-languages-v1",
      CREATOR_XP_COMMITMENT: "200",
      CREATOR_MODERATORS: "e2e-reviewer",
      CREATOR_COMPLETION_AUTHORITIES: "e2e-validator",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const h = await (await fetch(`${url}/api/health`)).json();
      if (h.worldPreparation?.days?.some((d) => d.state === "ready")) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Server did not become ready.");
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    stop() {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Runs in the page: layout problems on the current screen.
function layoutProblems() {
  const W = innerWidth;
  const out = [];
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? b : null;
  };
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
  // Inside a sideways scroller (tab rows, carousels) or off-screen on purpose.
  const scrollsX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
      if (s.position === "fixed" && p.getBoundingClientRect().right <= 0) return true;
    }
    return false;
  };
  const ignore = (el) =>
    el.closest(".maplibregl-map, .game-map, canvas, .sr-only, [aria-hidden='true'], .toast");
  if (document.scrollingElement.scrollWidth > W + 1)
    out.push(`page scrolls sideways (${document.scrollingElement.scrollWidth}px wide)`);
  for (const el of document.querySelectorAll("button, a, h1, h2, h3, h4, label, .badge, [role=tab], p, small, strong, b, span, li, dt, dd")) {
    if (ignore(el)) continue;
    const b = visible(el);
    if (!b) continue;
    if ((b.right > W + 1 || b.left < -1) && !scrollsX(el)) out.push(`off screen [${Math.round(b.left)}..${Math.round(b.right)}]: ${name(el)}`);
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== "ellipsis" && el.innerText.trim())
      out.push(`text cut off (${el.scrollWidth} > ${el.clientWidth}px): ${name(el)}`);
    if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 2 && /(hidden|clip)/.test(s.overflowY) && !/(auto|scroll)/.test(s.overflowY) && s.webkitLineClamp === "none" && el.innerText.trim())
      out.push(`text cut off vertically (${el.scrollHeight} > ${el.clientHeight}px): ${name(el)}`);
  }
  return [...new Set(out)];
}

// Runs in the page: visible text that equals an English key whose
// translation differs, i.e. a string that skipped tr().
function untranslated(dict) {
  // Skip English keys that read the same as some translation (French
  // "Explorer" is the translation of "Explore", not the English "Explorer").
  const translated = new Set(Object.values(dict).map((t) => t.trim()));
  const keys = new Map(
    Object.entries(dict)
      .filter(([en, t]) => en !== t && !translated.has(en.trim()))
      .map(([en]) => [en.trim(), en]),
  );
  const found = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script, style, .maplibregl-map, .sr-only")) continue;
    const t = n.textContent.trim();
    if (t.length < 3 || !keys.has(t)) continue;
    const b = el.getBoundingClientRect();
    if (b.width && b.height && getComputedStyle(el).visibility !== "hidden") found.add(t);
  }
  for (const el of document.querySelectorAll("[aria-label], [placeholder], [title]"))
    for (const attr of ["aria-label", "placeholder", "title"]) {
      const v = el.getAttribute(attr)?.trim();
      if (v && keys.has(v)) found.add(`${attr}: ${v}`);
    }
  return [...found];
}

async function dismissOverlays(page) {
  for (const sel of [".pwa-install button", ".first-session-coach button.text-button"]) {
    const b = page.locator(sel).last();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
  if (await page.locator("dialog[open]").count()) await page.keyboard.press("Escape");
}

async function check(page, lang, dir, shot, report, keepDialog = false) {
  await page.waitForTimeout(700);
  if (!keepDialog) await dismissOverlays(page);
  const file = `${String(report.screens.length + 1).padStart(2, "0")}-${shot}.png`;
  // Chromium sometimes refuses one capture ("Unable to capture screenshot");
  // the screenshot is evidence only, so retry once after a frame.
  await page.screenshot({ path: join(dir, file) }).catch(async () => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(dir, file) });
  });
  const layout = await page.evaluate(layoutProblems);
  const english = lang === "en" ? [] : await page.evaluate(untranslated, DICTS[lang]);
  report.screens.push({ screen: shot, file, layout, english });
  console.log(`  ${shot}: ${layout.length} layout, ${english.length} English`);
}

async function runLanguage(browser, url, lang) {
  const dir = join(SHOTS_ROOT, lang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const report = { lang, screens: [], problems: [] };
  const context = await browser.newContext({ ...PHONE_390, reducedMotion: "reduce", locale: "en-GB" });await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});
  const page = await context.newPage();
  page.on("pageerror", (e) => report.problems.push(`page error: ${e.message}`));
  await page.goto(`${url}/?lang=${lang}`);
  const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir || "ltr" }));
  const wantDir = RTL.has(lang) ? "rtl" : "ltr";
  if (html.dir !== wantDir) report.problems.push(`<html dir> is ${html.dir}, expected ${wantDir}`);
  if (html.lang !== lang) report.problems.push(`<html lang> is "${html.lang}", expected ${lang}`);
  await page.locator("#nickname").waitFor();
  await check(page, lang, dir, "welcome", report);
  await page.fill("#nickname", `Lang ${lang}`);
  await page.locator("form button[type=submit]").click();
  await page.locator(".game-intro").waitFor();
  await check(page, lang, dir, "how-to-play", report, true);
  await page.locator(".game-intro-head button").click();
  await page.locator(".rail-links button").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await check(page, lang, dir, "map", report);
  const destinations = [
    ["inventory", ".rail-links button:nth-child(2)"],
    ["community", ".rail-links button:last-child"],
    ["profile", ".topbar .profile-pill"],
  ];
  for (const [id, selector] of destinations) {
    await dismissOverlays(page);
    await closeOpenSheet(page);
    await page.locator(selector).click();
    await page.waitForTimeout(600);
    await check(page, lang, dir, id, report);
    const tabs = page.locator(".screen-tabs:not(.screen-tabs-sub)").first().locator("[role=tab]");
    const count = await tabs.count().catch(() => 0);
    for (let t = 1; t < count; t++) {
      await tabs.nth(t).click();
      await check(page, lang, dir, `${id}-tab${t + 1}`, report);
    }
  }
  await context.close();
  for (const s of report.screens) {
    for (const l of s.layout) report.problems.push(`${s.screen}: ${l}`);
    for (const e of s.english) report.problems.push(`${s.screen}: English left: ${e}`);
  }
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

const server = await startServer();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const lang of LANGS) {
    console.log(`${lang}:`);
    const report = await runLanguage(browser, server.url, lang);
    if (report.problems.length) {
      failed += 1;
      for (const p of report.problems) console.log(`  ✗ ${p}`);
    } else console.log(`  ✓ ${report.screens.length} screens clean`);
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(failed ? `${failed} of ${LANGS.length} languages have problems.` : `All ${LANGS.length} languages clean.`);
process.exit(failed ? 1 : 0);
