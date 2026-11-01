// QA journey for slice 7 (PWA polish). The API runs as
// `PORT=18788 APP_ORIGIN=http://localhost:18789 DISABLE_BACKGROUND_WORKERS=1
// DATABASE_PATH=<tmp> node server/index.mjs`; qa-proxy.mjs on 18789 serves a
// frozen `vite build` (isolated from concurrent rebuilds of dist/), forwards
// /api and can publish a changed sw.js. Usage: node pwa-qa.cjs <phase>
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const path = require("node:path");
const BASE = process.env.BASE || "http://localhost:18789";
const OUT = __dirname;
const UA = {
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
};
const VIEWPORTS = [
  { name: "360", width: 360, height: 780, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "844x390", width: 844, height: 390, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
];
const results = [];
const log = (...a) => {
  results.push(a.join(" "));
  console.log(...a);
};
// Chromium only fires beforeinstallprompt for a real install candidate; the
// headless run dispatches an equivalent event with a stubbed prompt().
const FAKE_PROMPT = () => {
  window.__promptCalls = 0;
  window.addEventListener("load", () => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => {
      window.__promptCalls++;
    };
    e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
    window.dispatchEvent(e);
  });
};
async function context(browser, vp, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 2,
    userAgent: opts.ua || (vp.mobile ? UA.android : undefined),
    reducedMotion: opts.reducedMotion || "no-preference",
  });
  if (opts.fakePrompt) await ctx.addInitScript(FAKE_PROMPT);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`[${vp.name}] pageerror`, e.message));
  return { ctx, page };
}
async function startPlaying(page, name = "Klara") {
  await page.goto(BASE + "/");
  await page.fill("#nickname", name);
  await page.click("text=Start exploring");
  await page.waitForSelector(".main-panel", { timeout: 30000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
}
const shot = (page, file) => page.screenshot({ path: path.join(OUT, file) });
async function targets(page, selector) {
  return page.$$eval(selector, (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${e.textContent.trim()}=${Math.round(r.width)}x${Math.round(r.height)}`;
    }),
  );
}

async function installPhase(browser) {
  await Promise.all(
    VIEWPORTS.flatMap((vp) => [
      (async () => {
        const { ctx, page } = await context(browser, vp, { fakePrompt: true });
        await startPlaying(page, "Klara");
        await page.waitForTimeout(3000);
        const early = await page.$(".pwa-install");
        log(`[${vp.name}] install offer before 45 s of play: ${early ? "shown (FAIL)" : "hidden"}`);
        await page.waitForSelector(".pwa-install", { timeout: 70000 });
        await page.waitForTimeout(400);
        await shot(page, `install-prompt-${vp.name}.png`);
        log(`[${vp.name}] install offer targets`, (await targets(page, ".pwa-install button")).join(", "));
        if (vp.name === "390") {
          // Keyboard: Tab into the offer, Escape dismisses and returns focus.
          await page.focus(".pwa-install .pwa-primary");
          await page.keyboard.press("Tab");
          const focused = await page.evaluate(() => document.activeElement.textContent);
          await page.keyboard.press("Escape");
          const after = await page.evaluate(() => ({
            stored: localStorage.getItem("questlayer.install-offer"),
            offer: !!document.querySelector(".pwa-install"),
            focus: document.activeElement.className,
          }));
          log(`[390] keyboard: Tab reached "${focused}", Escape -> stored=${after.stored}, offer=${after.offer}, focus=${after.focus}`);
          await page.reload();
          await page.waitForSelector(".main-panel");
          await page.waitForTimeout(50000);
          log(`[390] after dismissal + reload + 50 s play: offer ${(await page.$(".pwa-install")) ? "shown (FAIL)" : "not shown"}`);
        }
        if (vp.name === "360") {
          await page.click(".pwa-install .pwa-primary");
          await page.waitForTimeout(300);
          const after = await page.evaluate(() => ({
            calls: window.__promptCalls,
            stored: localStorage.getItem("questlayer.install-offer"),
            offer: !!document.querySelector(".pwa-install"),
          }));
          log(`[360] Add to home screen -> prompt() calls=${after.calls}, stored=${after.stored}, offer=${after.offer}`);
        }
        await ctx.close();
      })(),
      ...(vp.mobile
        ? [
            (async () => {
              const { ctx, page } = await context(browser, vp, { ua: UA.ios });
              await startPlaying(page, "Tomas");
              await page.waitForSelector(".pwa-install", { timeout: 70000 });
              await page.waitForTimeout(400);
              await shot(page, `install-ios-${vp.name}.png`);
              log(`[${vp.name}] iOS guidance targets`, (await targets(page, ".pwa-install button")).join(", "));
              await ctx.close();
            })(),
          ]
        : []),
    ]),
  );
}

let release = 1;
async function updatePhase(browser) {
  for (const vp of VIEWPORTS) {
    const { ctx, page } = await context(browser, vp);
    release += 2;
    await fetch(`${BASE}/__qa/release?n=${release}`);
    await startPlaying(page, "Jana");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(1500);
    const early = await page.$(".pwa-update");
    log(`[${vp.name}] first visit (worker just installed): notice ${early ? "shown (FAIL)" : "hidden"}`);
    // A real second worker: the served sw.js changes, the tab checks again.
    await fetch(`${BASE}/__qa/release?n=${release + 1}`);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForSelector(".pwa-update", { timeout: 20000 });
    await page.waitForTimeout(400);
    const waiting = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    log(`[${vp.name}] update notice shown; registration.waiting=${waiting}`);
    await shot(page, `update-${vp.name}.png`);
    log(`[${vp.name}] update targets`, (await targets(page, ".pwa-update button")).join(", "));
    if (vp.name === "390") {
      const live = await page.textContent(".pwa-sr-only[role=status]");
      log(`[390] live region: "${live}"`);
      await page.evaluate(() => (window.__beforeReload = true));
      await page.click(".pwa-update .pwa-primary");
      await page.waitForFunction(() => !window.__beforeReload, null, { timeout: 15000 });
      await page.waitForSelector(".main-panel", { timeout: 30000 });
      const after = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        return { waiting: !!r.waiting, notice: !!document.querySelector(".pwa-update") };
      });
      log(`[390] Reload -> page reloaded via controllerchange; waiting=${after.waiting}, notice=${after.notice}`);
    }
    await ctx.close();
  }
  // Newer published shell without a service-worker change.
  const vp = VIEWPORTS[1];
  const { ctx, page } = await context(browser, vp);
  await startPlaying(page, "Petr");
  await ctx.route(BASE + "/", async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    const response = await route.fetch();
    const body = (await response.text()).replace(/index-[\w-]+\.css/, "index-NEXTRELEASE.css");
    await route.fulfill({ response, body });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForSelector(".pwa-update", { timeout: 20000 });
  log(`[390] newer published shell -> update notice shown`);
  await ctx.close();
}

async function offlinePhase(browser) {
  for (const vp of VIEWPORTS) {
    const { ctx, page } = await context(browser, vp);
    await startPlaying(page, "Eva");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(2500);
    await ctx.setOffline(true);
    await page.waitForSelector(".pwa-offline", { timeout: 5000 });
    await page.waitForTimeout(400);
    await shot(page, `offline-playing-${vp.name}.png`);
    const appBar = await page.$eval(".offline-bar", (e) => getComputedStyle(e).display).catch(() => "absent");
    log(`[${vp.name}] offline while playing: notice shown, app strip display=${appBar}`);
    await page.reload();
    await page.waitForTimeout(4000);
    const state = await page.evaluate(() => ({
      shell: !!document.querySelector(".app-shell"),
      notice: !!document.querySelector(".pwa-offline:popover-open"),
      welcome: !!document.querySelector("dialog[open]"),
    }));
    log(`[${vp.name}] offline reload: shell=${state.shell}, notice in top layer=${state.notice}, welcome dialog=${state.welcome}`);
    await shot(page, `offline-reload-${vp.name}.png`);
    await ctx.setOffline(false);
    await page.waitForSelector(".pwa-back-online", { timeout: 5000 });
    await page.waitForTimeout(300);
    if (vp.name === "390") await shot(page, `back-online-${vp.name}.png`);
    if (vp.name === "390") {
      // Worker installed but the shell never cached: the offline page.
      await page.evaluate(async () => {
        for (const key of await caches.keys()) await caches.delete(key);
      });
      await ctx.setOffline(true);
      await page.reload();
      await page.waitForTimeout(1000);
      await shot(page, `offline-first-open-${vp.name}.png`);
      log(`[390] uncached offline open: "${await page.textContent("h1")}"`);
    }
    await ctx.close();
  }
}

async function accessPhase(browser) {
  const vp = VIEWPORTS[0];
  const { ctx, page } = await context(browser, vp, { reducedMotion: "reduce" });
  await startPlaying(page, "Ondra");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.waitForSelector(".pwa-offline");
  const anim = await page.$eval(".pwa-offline", (e) => getComputedStyle(e).animationName + " " + getComputedStyle(e).animationDuration);
  log(`[360 reduced motion] offline notice animation: ${anim}`);
  await ctx.setOffline(false);
  await ctx.close();
  // 200 % text: the notices use rem, so a larger root size reflows them.
  for (const v of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const { ctx: c2, page: p2 } = await context(browser, v, { fakePrompt: true });
    await startPlaying(p2, "Lucie");
    await p2.waitForFunction(() => !!navigator.serviceWorker.controller);
    await p2.addStyleTag({ content: "html{font-size:200%}" });
    await c2.setOffline(true);
    await p2.waitForSelector(".pwa-offline");
    await p2.waitForTimeout(300);
    await shot(p2, `offline-200-text-${v.name}.png`);
    const fits = await p2.$eval(".pwa-offline", (e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.left)}..${Math.round(r.right)} of ${innerWidth}, scroll=${e.scrollHeight > e.clientHeight}`;
    });
    log(`[${v.name} 200% text] offline notice box ${fits}`);
    await c2.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const phase = process.argv[2] || "all";
  if (phase === "all" || phase === "install") await installPhase(browser);
  if (phase === "all" || phase === "update") await updatePhase(browser);
  if (phase === "all" || phase === "offline") await offlinePhase(browser);
  if (phase === "all" || phase === "access") await accessPhase(browser);
  await browser.close();
  require("node:fs").writeFileSync(path.join(OUT, `results-${phase}.txt`), results.join("\n") + "\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
