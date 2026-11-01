// Automated journey through a newcomer's first session on phone-sized
// viewports: name → nearest find → first coin → first chest → Aura →
// secure/share, the sound/vibration/motion settings, then the rest of the
// loop: equip from the collection, a practice market order that a second
// explorer fills, and the creator feed. Every key screen gets an axe
// accessibility scan and the first load is held to a performance budget.
//
// Usage:  npm run build && npm run e2e:first-session [-- --device=<name>]
//   --device=phone-390  Chromium at 390 x 844 (default, the original job)
//   --device=iphone     WebKit with Playwright's iPhone 15 profile
//   --device=pixel      Chromium with Playwright's Pixel 7 profile
//   --device=all        all three in turn against one server
// E2E_DEVICE does the same as --device. It starts its own server on a free
// port with a throwaway database unless E2E_BASE_URL points at a running
// one. Screenshots and the a11y/performance report land in
// output/qa/2026-11-first-session/<device>/ (override the root with
// E2E_SHOTS).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import { chromium, devices, webkit } from "playwright";

const require = createRequire(import.meta.url);
const AXE_SOURCE = require("axe-core").source;
const ROOT = resolve(import.meta.dirname, "..");
const SHOTS_ROOT = resolve(
  process.env.E2E_SHOTS || join(ROOT, "output/qa/2026-11-first-session"),
);
const CHAIN =
  /\b(wallet|testnet|transaction|NEAR|mint(ed)?|NFT|on-chain|contract|blockchain|demo GOLD)\b/i;
const STEP_TITLES = {
  find: "Reach the nearest find",
  coin: "Pick up a coin",
  chest: "Open your first chest",
  aura: "Wear your Aura",
  secure: "Secure or share it",
};

const PHONE_390 = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
// Each device: which engine, which emulation profile.
const DEVICES = {
  "phone-390": { engine: chromium, profile: PHONE_390 },
  iphone: { engine: webkit, profile: strip(devices["iPhone 15"]) },
  pixel: { engine: chromium, profile: strip(devices["Pixel 7"]) },
};
function strip({ defaultBrowserType, ...profile }) {
  return profile;
}

// First-load budget. The JS limits are on the scripts the welcome screen
// actually loads (gzip as served by a static host). They sit about 10 %
// over the November 2026 baseline (762 KB gzip / 2724 KB raw on Chromium,
// map engine included) so growth fails CI; lower them as the bundle is
// split. Times are generous for shared CI runners. E2E_PERF_* overrides.
const BUDGET = {
  scriptGzipKb: Number(process.env.E2E_PERF_SCRIPT_GZIP_KB || 840),
  scriptRawKb: Number(process.env.E2E_PERF_SCRIPT_RAW_KB || 3000),
  requests: Number(process.env.E2E_PERF_REQUESTS || 60),
  firstContentfulPaintMs: Number(process.env.E2E_PERF_FCP_MS || 4000),
  nameFieldReadyMs: Number(process.env.E2E_PERF_READY_MS || 6000),
  layoutShift: Number(process.env.E2E_PERF_CLS || 0.1),
};
// axe impacts that fail the run; "moderate"/"minor" are reported only.
const A11Y_FAIL = new Set(["serious", "critical"]);
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
  const dir = mkdtempSync(join(tmpdir(), "questlayer-e2e-"));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_ORIGIN: url,
      DATABASE_PATH: join(dir, "e2e.sqlite"),
      DISABLE_RELAYER: "1",
      CREATOR_COMMUNITY_ENABLED: "1",
      CREATOR_POLICY_VERSION: "e2e-journey-v1",
      CREATOR_XP_COMMITMENT: "200",
      CREATOR_MODERATORS: "e2e-reviewer",
      CREATOR_COMPLETION_AUTHORITIES: "e2e-validator",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/api/health`);
      const h = await r.json();
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

async function coachTitle(page) {
  const h = page.locator("#first-session-title");
  return (await h.count()) ? (await h.innerText()).trim() : "";
}

async function waitForStep(page, title, timeout = 20_000) {
  await page.waitForFunction(
    (t) => document.querySelector("#first-session-title")?.textContent?.trim() === t,
    title,
    { timeout },
  );
}

// Toasts sit over the sheet for a few seconds; wait so screenshots show it.
async function quietToast(page) {
  await page
    .locator(".toast")
    .waitFor({ state: "detached", timeout: 8000 })
    .catch(() => {});
}

async function assertNoChainWords(page, where) {
  const text = await page
    .locator(".main-panel, .toast, [role=alert]")
    .allInnerTexts();
  const joined = text.join("\n");
  assert.doesNotMatch(joined, CHAIN, `chain word in ${where}: ${joined.match(CHAIN)?.[0]}`);
}

async function newExplorerContext(browser, profile) {
  const context = await browser.newContext({
    ...profile,
    reducedMotion: "reduce",
    acceptDownloads: true,
    locale: "en-GB",
  });
  // Record vibration calls; headless browsers have no vibration motor.
  await context.addInitScript(() => {
    window.__vibrations = [];
    navigator.vibrate = (pattern) => {
      window.__vibrations.push(pattern);
      return true;
    };
  });
  // Layout shifts, collected from the first paint (Chromium only).
  await context.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      window.__cls = null;
    }
  });
  return context;
}

// Navigate to the app and measure the first load against BUDGET.
async function firstLoad(page, url, report) {
  const scripts = new Map();
  let requests = 0;
  const onResponse = async (response) => {
    requests += 1;
    if (response.request().resourceType() !== "script") return;
    try {
      const body = await response.body();
      scripts.set(response.url(), body);
    } catch {}
  };
  page.on("response", onResponse);
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").waitFor();
  const timing = await page.evaluate(() => ({
    ready: performance.now(),
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    domContentLoaded:
      performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? null,
  }));
  // Let late chunks requested by the first screen finish.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  page.off("response", onResponse);
  const cls = await page.evaluate(() => window.__cls);
  let raw = 0;
  let gzip = 0;
  for (const body of scripts.values()) {
    raw += body.length;
    gzip += gzipSync(body).length;
  }
  const perf = {
    scriptRawKb: Math.round(raw / 1024),
    scriptGzipKb: Math.round(gzip / 1024),
    scripts: scripts.size,
    requests,
    firstContentfulPaintMs: timing.fcp == null ? null : Math.round(timing.fcp),
    domContentLoadedMs:
      timing.domContentLoaded == null ? null : Math.round(timing.domContentLoaded),
    nameFieldReadyMs: Math.round(timing.ready),
    layoutShift: cls == null ? null : Number(cls.toFixed(4)),
    budget: BUDGET,
  };
  report.performance = perf;
  console.log(
    `  perf: ${perf.scriptGzipKb} KB gzip JS (${perf.scriptRawKb} KB raw, ${perf.scripts} files), ` +
      `${perf.requests} requests, FCP ${perf.firstContentfulPaintMs ?? "n/a"} ms, ` +
      `name field ${perf.nameFieldReadyMs} ms, CLS ${perf.layoutShift ?? "n/a"}`,
  );
  const over = [];
  if (perf.scriptGzipKb > BUDGET.scriptGzipKb)
    over.push(`JS ${perf.scriptGzipKb} KB gzip > ${BUDGET.scriptGzipKb} KB`);
  if (perf.scriptRawKb > BUDGET.scriptRawKb)
    over.push(`JS ${perf.scriptRawKb} KB raw > ${BUDGET.scriptRawKb} KB`);
  if (perf.requests > BUDGET.requests)
    over.push(`${perf.requests} requests > ${BUDGET.requests}`);
  if (perf.firstContentfulPaintMs != null && perf.firstContentfulPaintMs > BUDGET.firstContentfulPaintMs)
    over.push(`FCP ${perf.firstContentfulPaintMs} ms > ${BUDGET.firstContentfulPaintMs} ms`);
  if (perf.nameFieldReadyMs > BUDGET.nameFieldReadyMs)
    over.push(`name field ${perf.nameFieldReadyMs} ms > ${BUDGET.nameFieldReadyMs} ms`);
  if (perf.layoutShift != null && perf.layoutShift > BUDGET.layoutShift)
    over.push(`CLS ${perf.layoutShift} > ${BUDGET.layoutShift}`);
  report.performance.over = over;
}

// Scan the current screen with axe-core. Serious and critical WCAG 2.x A/AA
// violations fail the run at the end; the rest are written to the report.
async function a11y(page, screen, report) {
  const injected = await page.evaluate(() => typeof window.axe === "object");
  if (!injected) await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(
    async (tags) => {
      const r = await window.axe.run(document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      });
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
        details: v.nodes.slice(0, 5).map((n) => n.any?.[0]?.message || n.all?.[0]?.message || ""),
        count: v.nodes.length,
      }));
    },
    A11Y_TAGS,
  );
  report.a11y[screen] = result;
  const blocking = result.filter((v) => A11Y_FAIL.has(v.impact));
  const note = result.length
    ? result.map((v) => `${v.id}(${v.impact}×${v.count})`).join(", ")
    : "clean";
  console.log(`  a11y ${screen}: ${note}`);
  return blocking;
}

async function runDevice(name, server) {
  const { engine, profile } = DEVICES[name];
  const shots = join(SHOTS_ROOT, name);
  mkdirSync(shots, { recursive: true });
  let shot = 0;
  const capture = async (page, label) => {
    shot += 1;
    const file = join(shots, `${String(shot).padStart(2, "0")}-${label}.png`);
    await page.screenshot({ path: file });
    console.log(`  screenshot ${file}`);
  };
  const report = { device: name, browser: engine.name(), profile, a11y: {} };
  const blocking = [];
  const scan = async (page, screen) => {
    for (const v of await a11y(page, screen, report)) blocking.push({ screen, ...v });
  };
  const explorer = `Mira ${name}`;
  const browser = await engine.launch();
  console.log(`\n== ${name} (${engine.name()} ${browser.version()}) ==`);
  try {
    const context = await newExplorerContext(browser, profile);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));

    console.log("1. Name");
    await firstLoad(page, server.url, report);
    await capture(page, "welcome");
    await scan(page, "welcome");
    await page.getByPlaceholder("Your explorer name").fill(explorer);
    await page.getByRole("button", { name: "Start exploring" }).click();
    await waitForStep(page, STEP_TITLES.find);
    assert.match(await page.locator(".first-session-count").innerText(), /1 of 6/);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.motion),
      "reduce",
      "system reduced motion reaches the page",
    );
    // The live hint comes from the grounded guide.
    await page.waitForFunction(
      () => /m away/.test(document.querySelector(".first-session-hint")?.textContent || ""),
      null,
      { timeout: 10_000 },
    );
    await capture(page, "coach-nearest-find");
    await assertNoChainWords(page, "find step");
    await scan(page, "map-coach");

    console.log("2-3. Nearest find and first coin");
    for (let i = 0; i < 12; i++) {
      const title = await coachTitle(page);
      if (title !== STEP_TITLES.find && title !== STEP_TITLES.coin) break;
      await page.locator(".first-session-action").click();
      // The ghost walks (instantly with reduced motion), then the pickup
      // loop claims coins within reach every 600 ms.
      await page.waitForTimeout(2500);
    }
    await waitForStep(page, STEP_TITLES.chest);
    await capture(page, "coach-first-chest");
    await assertNoChainWords(page, "chest step");

    console.log("4. First chest");
    await page.locator(".first-session-action").click();
    const detail = page.locator(".quest-detail").first();
    await detail.waitFor();
    await capture(page, "chest-detail");
    for (let i = 0; i < 40; i++) {
      const button = detail.locator(".primary-button").first();
      const label = (await button.innerText()).trim();
      if (/Open chest|Confirm visit/.test(label)) {
        await button.click();
        break;
      }
      assert.match(label, /Walk/, `unexpected chest action: ${label}`);
      await button.click();
      await page.waitForTimeout(400);
    }
    const reward = page.getByRole("dialog");
    await reward.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await capture(page, "chest-reward");
    await scan(page, "chest-reward");
    // Back to the map; the coach continues with the Aura.
    await reward.getByRole("button", { name: "Back to map" }).click();
    await reward.waitFor({ state: "hidden" });
    await waitForStep(page, STEP_TITLES.aura);
    await quietToast(page);
    await capture(page, "coach-wear-aura");

    console.log("5. Aura");
    await page.locator(".first-session-action").click();
    await waitForStep(page, STEP_TITLES.secure);
    await assertNoChainWords(page, "aura step");
    await quietToast(page);
    await capture(page, "coach-secure-share");

    console.log("6. Secure or share");
    await page.locator(".first-session-action").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const share = dialog.getByRole("button", { name: /Share your Aura/ });
    await share.waitFor();
    await capture(page, "secure-share-dialog");
    await scan(page, "secure-share");
    const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
    await share.click();
    await download;
    await dialog.getByText(/Card saved|Making your card/).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await dialog.getByRole("button", { name: "Back to map" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => /You know the loop/.test(document.querySelector("#first-session-title")?.textContent || ""),
      null,
      { timeout: 10_000 },
    );
    assert.match(await page.locator(".first-session-count").innerText(), /6 of 6/);
    await capture(page, "coach-done");
    await page.getByRole("button", { name: "Keep exploring" }).click();
    assert.equal(await page.locator(".first-session").count(), 0);

    const vibrations = await page.evaluate(() => window.__vibrations.length);
    assert.ok(vibrations > 0, "haptic cues fired during the session");
    console.log(`  ${vibrations} haptic cues`);

    console.log("7. Sound, vibration and motion settings");
    await page.getByRole("button", { name: "Explorer profile" }).click();
    await page.getByRole("button", { name: "Profile and settings" }).click();
    const settings = page.locator(".feedback-settings");
    await settings.scrollIntoViewIfNeeded();
    await settings.getByRole("button", { name: "Sound on" }).click();
    await settings.getByRole("button", { name: "Off" }).first().click();
    await settings.getByRole("button", { name: "Reduce motion" }).click();
    assert.equal(
      await settings.getByRole("button", { name: "Reduce motion" }).getAttribute("aria-pressed"),
      "true",
    );
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("questlayer-feedback-v1")));
    assert.deepEqual(saved, { haptics: false, sound: true, motion: "reduce" });
    await capture(page, "settings-feedback");
    await scan(page, "settings");

    console.log("8. Equip from the collection");
    await page.getByRole("button", { name: "Inventory", exact: true }).first().click();
    const aura = page.locator(".inventory-item-choice").first();
    await aura.waitFor();
    const auraName = (await aura.locator("strong").innerText()).trim();
    assert.match(
      (await aura.getAttribute("aria-label")) || "",
      /equipped/,
      "the first-session Aura is worn",
    );
    await scan(page, "inventory");
    await aura.click();
    const itemActions = page.locator(".inventory-item-actions");
    await itemActions.getByRole("button", { name: "Take it off" }).click();
    await itemActions.getByRole("button", { name: "Try it on" }).waitFor();
    await itemActions.getByRole("button", { name: "Try it on" }).click();
    await itemActions.getByRole("button", { name: "Take it off" }).waitFor();
    assert.match(await page.locator(".inventory-item-detail .inventory-source").innerText(), /Equipped/);
    await quietToast(page);
    await capture(page, "inventory-equipped");

    console.log("9. Practice market order");
    await itemActions.getByRole("button", { name: "List on market" }).click();
    await page.locator("#inventory-list-price").fill("25");
    await scan(page, "market-listing-form");
    await page.getByRole("button", { name: "List for practice GOLD" }).click();
    await page.getByText("Your Aura is on the market.").waitFor({ timeout: 10_000 });
    await quietToast(page);
    // A second explorer, on the same device, fills the order.
    const buyerContext = await newExplorerContext(browser, profile);
    const buyer = await buyerContext.newPage();
    buyer.on("pageerror", (e) => console.error("buyer page error:", e.message));
    await buyer.goto(server.url);
    await buyer.getByPlaceholder("Your explorer name").fill(`Buyer ${name}`);
    await buyer.getByRole("button", { name: "Start exploring" }).click();
    await buyer.getByRole("button", { name: "Hide first steps" }).click();
    await buyer.getByRole("button", { name: "Profile", exact: true }).first().click();
    await buyer.getByRole("button", { name: /^Market/ }).click();
    const offer = buyer.locator(".listing-card, li, article").filter({ hasText: explorer }).filter({
      has: buyer.getByRole("button", { name: "Buy Aura" }),
    }).first();
    await offer.waitFor({ timeout: 15_000 });
    await capture(buyer, "market-buyer");
    await scan(buyer, "market");
    await offer.getByRole("button", { name: "Buy Aura" }).click();
    await buyer.getByText("This Aura is yours.", { exact: false }).waitFor({ timeout: 10_000 });
    await buyerContext.close();
    // The seller sees the sale: the Aura has left the collection.
    await page.getByRole("button", { name: "Inventory", exact: true }).first().click();
    await page.waitForFunction(
      (n) => ![...document.querySelectorAll(".inventory-item-choice strong")].some((e) => e.textContent.trim() === n),
      auraName,
      { timeout: 15_000 },
    ).catch(async () => {
      await page.reload();
      await page.getByRole("button", { name: "Inventory", exact: true }).first().click();
      await page.waitForFunction(
        (n) => ![...document.querySelectorAll(".inventory-item-choice strong")].some((e) => e.textContent.trim() === n),
        auraName,
        { timeout: 15_000 },
      );
    });
    console.log(`  ${auraName} sold for 25 practice GOLD`);

    console.log("10. Creator feed");
    await page.getByRole("button", { name: "Community", exact: true }).first().click();
    const feed = page.getByRole("region", { name: "Creator community" });
    await feed.waitFor();
    await feed.getByRole("heading", { name: "All creator quests" }).waitFor({ timeout: 15_000 });
    assert.equal(await feed.locator("[role=alert]").count(), 0, "creator feed loads without an error");
    await capture(page, "creator-feed");
    await scan(page, "creator-feed");
    await feed
      .getByRole("navigation", { name: "Creator community section" })
      .getByRole("button")
      .nth(1)
      .click();
    await page.waitForTimeout(500);
    assert.equal(await feed.locator("[role=alert]").count(), 0, "creator section loads");
    await capture(page, "creator-section");
    await assertNoChainWords(page, "creator feed");
  } finally {
    await browser.close();
    writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
  }
  const problems = [];
  for (const v of blocking)
    problems.push(`a11y ${v.screen}: ${v.id} (${v.impact}) ${v.help} → ${v.nodes.join(" | ")}`);
  for (const o of report.performance?.over || []) problems.push(`perf: ${o}`);
  return problems;
}

function chosenDevices() {
  const arg = process.argv.find((a) => a.startsWith("--device="))?.slice(9);
  const want = arg || process.env.E2E_DEVICE || "phone-390";
  const list = want === "all" ? Object.keys(DEVICES) : want.split(",");
  for (const d of list) assert.ok(DEVICES[d], `unknown device ${d}; use ${Object.keys(DEVICES).join(", ")} or all`);
  return list;
}

async function main() {
  const list = chosenDevices();
  const server = await startServer();
  const problems = [];
  try {
    for (const name of list)
      for (const p of await runDevice(name, server)) problems.push(`[${name}] ${p}`);
  } finally {
    server.stop();
  }
  if (problems.length) {
    console.error(`\n${problems.length} budget/a11y problem(s):\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`\nJourney passed on ${list.join(", ")}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
