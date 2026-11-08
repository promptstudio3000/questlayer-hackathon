// Actual App + authenticated API with disposable state and no signing capability.
import { chromium, webkit } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  out = resolve(
    process.env.GOTCHIVERSE_QA_OUT ||
      join(root, "output/qa/gotchiverse-integration-2026-11-07/browser"),
  );
mkdirSync(out, { recursive: true });
assert(
  !existsSync(join(root, ".env")),
  "Run this isolated journey in a checkout without local runtime configuration.",
);
const state = mkdtempSync(join(tmpdir(), "questlayer-gotchi-app-"));
const guard = join(state, "loopback.mjs");
writeFileSync(
  guard,
  `const original=globalThis.fetch; globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return Promise.reject(new Error('QA permits loopback fetch only'));return original(input,options);};`,
);
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => ok(port));
    });
  });
const port = await freePort(),
  base = `http://127.0.0.1:${port}`;
const env = {
  PATH: dirname(process.execPath) + ":/usr/bin:/bin",
  PORT: String(port),
  HOST: "127.0.0.1",
  APP_ORIGIN: base,
  DATABASE_PATH: join(state, "game.sqlite"),
  DISABLE_NATIVE_ATTESTATIONS: "1",
  DISABLE_BACKGROUND_WORKERS: "1",
  DISABLE_RELAYER: "1",
  NPC_TRADER_ENABLED: "0",
  QGOLD_KEEPER_ENABLED: "0",
  QGOLD_KEEPER_EXECUTE: "0",
  NEAR_RPC_URL: "http://127.0.0.1:9",
  NODE_ENV: "test",
  NODE_OPTIONS: `--import=${guard}`,
};
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (b) => (log += b));
child.stderr.on("data", (b) => (log += b));
const require = createRequire(import.meta.url),
  axe = require("axe-core").source;
const reports = [],
  browsers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openWorld(page) {
  await page.locator(".topbar .world-switcher").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("world-switcher"),
  );
  await page.locator(".topbar .world-switcher").click();
  await page
    .getByRole("button", { name: /Gotchiverse.*Shape terrain/ })
    .click();
  await page.locator(".gotchi-stage").waitFor();
}
async function newExplorer(page, name) {
  await page.goto(base);
  await page.locator("#nickname").fill(name);
  await page
    .getByRole("button", { name: "Start exploring", exact: true })
    .click();
  await page.locator(".app-shell[data-screen=explore]").waitFor();
}
const getState = async (page) =>
  page.evaluate(async () => {
    const view = JSON.parse(
      sessionStorage.getItem(
        Object.keys(sessionStorage).find((k) =>
          k.startsWith("questlayer.gotchiverse.view:"),
        ),
      ) || "null",
    );
    if (!view) return null;
    const r = await fetch(`/api/gotchiverse/workshop?id=${view.workshopId}`);
    return r.json();
  });
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw Error("Isolated game did not start: " + log.slice(-2500));
    await sleep(200);
  }
  for (const [engine, type] of process.env.GOTCHIVERSE_QA_SMOKE
    ? [["chromium", chromium]]
    : [
        ["chromium", chromium],
        ["webkit", webkit],
      ]) {
    const browser = await type.launch({ headless: true });
    browsers.push(browser);
    for (const [name, width, height] of process.env.GOTCHIVERSE_QA_SMOKE
      ? [["phone-390", 390, 844]]
      : [
          ["phone-360", 360, 800],
          ["phone-390", 390, 844],
          ["landscape", 844, 390],
          ["desktop", 1440, 1000],
        ]) {
      const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: "reduce",
        }),
        page = await context.newPage();
      const pageErrors = [],
        physicalClaims = [],
        scripts = [];
      let virtual = false;
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("request", (r) => {
        if (r.resourceType() === "script") scripts.push(r.url());
        if (virtual && r.url().includes("/api/coins/claim"))
          physicalClaims.push(r.url());
      });
      await newExplorer(page, `Mira ${engine[0]} ${width}`);
      assert(
        !scripts.some((u) => /Gotchiverse-/.test(u)),
        "Virtual renderer must not preload before selection",
      );
      await page.screenshot({
        path: join(out, `${engine}-${name}-before.png`),
      });
      await openWorld(page);
      virtual = true;
      const initial = await getState(page);
      assert(initial.workshop.id);
      const account = await page.request
        .get(base + "/api/me")
        .then((r) => r.json());
      await page.screenshot({
        path: join(out, `${engine}-${name}-entered.png`),
        fullPage: true,
      });
      if (width <= 600) {
        const firstAction = await page
          .getByRole("button", { name: "Raise", exact: true })
          .boundingBox();
        assert(
          firstAction &&
            firstAction.y > 64 &&
            firstAction.y + firstAction.height < height - 64,
          "The first building action must be visible without scrolling",
        );
      }
      await page.getByRole("button", { name: "Raise", exact: true }).click();
      await page
        .getByText("Saved. Your landscape is up to date.", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Select block East", exact: true })
        .click();
      await page.getByRole("button", { name: "Raise", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector(".gotchi-tool-grid button")?.disabled,
      );
      await page
        .getByRole("button", { name: "Select block South", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Garden lantern", exact: true })
        .click();
      await page
        .getByText("Your first build is complete.", { exact: true })
        .waitFor();
      const built = await getState(page);
      assert.equal(built.workshop.progress.completedAt > 0, true);
      const stage = page.locator(".gotchi-stage");
      await stage.focus();
      await page.keyboard.press("ArrowRight");
      await page
        .getByRole("button", { name: "Move explorer", exact: true })
        .click();
      await stage.focus();
      await page.keyboard.press("w");
      await page.getByRole("button", { name: "Build", exact: true }).click();
      await page.locator(".main-panel").evaluate((el) => (el.scrollTop = 0));
      await page.screenshot({
        path: join(out, `${engine}-${name}-building.png`),
        fullPage: true,
      });
      await page.reload();
      await page.locator(".gotchi-stage").waitFor();
      const reloaded = await getState(page);
      assert.equal(reloaded.workshop.revision, built.workshop.revision);
      if (engine === "chromium" && name === "phone-390") {
        await page.route(
          "**/api/gotchiverse/edit",
          async (route) => {
            await route.fetch();
            await route.abort("failed");
          },
          { times: 1 },
        );
        await page.getByRole("button", { name: "Raise", exact: true }).click();
        await page
          .getByRole("button", { name: "Retry save", exact: true })
          .waitFor();
        const committed = await getState(page);
        assert.equal(committed.workshop.revision, built.workshop.revision + 1);
        await page.screenshot({
          path: join(out, "lost-save-reply.png"),
          fullPage: true,
        });
        await page.reload();
        await page
          .getByRole("button", { name: "Retry save", exact: true })
          .click();
        await page.waitForFunction(
          () => !document.querySelector(".gotchi-pending"),
        );
        assert.equal(
          (await getState(page)).workshop.revision,
          committed.workshop.revision,
        );
        await context.setOffline(true);
        await page
          .getByText(
            "You are offline. Your landscape stays visible; building resumes when you reconnect.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Raise", exact: true })
            .isDisabled(),
          true,
        );
        await context.setOffline(false);
        await page.waitForFunction(() => navigator.onLine);
      }
      await page
        .getByRole("button", { name: "Build with friends", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Create invitation", exact: true })
        .click();
      await page.locator("#gotchi-invite").waitFor();
      const keyboardBefore = await page.evaluate(() =>
        JSON.stringify(
          JSON.parse(
            sessionStorage.getItem(
              Object.keys(sessionStorage).find((k) =>
                k.startsWith("questlayer.gotchiverse.view:"),
              ),
            ),
          ),
        ),
      );
      await page.locator("#gotchi-invite").focus();
      await page.keyboard.press("a");
      assert.equal(
        await page.evaluate(() =>
          JSON.stringify(
            JSON.parse(
              sessionStorage.getItem(
                Object.keys(sessionStorage).find((k) =>
                  k.startsWith("questlayer.gotchiverse.view:"),
                ),
              ),
            ),
          ),
        ),
        keyboardBefore,
      );
      assert.equal(
        await page
          .locator("#gotchi-invite")
          .inputValue()
          .then((v) => v.startsWith(base)),
        true,
      );
      await page.screenshot({
        path: join(out, `${engine}-${name}-invite-keyboard.png`),
        fullPage: true,
      });
      await page.addScriptTag({ content: axe });
      const scan = await page.evaluate(async () => {
        const r = await axe.run(document.querySelector(".gotchiverse"), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        });
        return r.violations
          .filter((v) => ["serious", "critical"].includes(v.impact))
          .map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          }));
      });
      writeFileSync(
        join(out, `${engine}-${name}-axe.json`),
        JSON.stringify(scan, null, 2),
      );
      assert.deepEqual(scan, []);
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        smallButtons: [...document.querySelectorAll(".gotchiverse button")]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return r.width && r.height && (r.width < 47.9 || r.height < 47.9);
          })
          .map((b) => b.textContent),
        inputFont: getComputedStyle(document.querySelector("#gotchi-invite"))
          .fontSize,
      }));
      assert.equal(geometry.overflow, false);
      assert.deepEqual(geometry.smallButtons, []);
      assert.equal(geometry.inputFont, "16px");
      const mainGeometry = await page.locator(".main-panel").evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
        height: innerHeight,
      }));
      assert(mainGeometry.top >= 60 && mainGeometry.bottom <= mainGeometry.height - 64,
        "Virtual content must fit between the header and navigation");
      const headerOverlap = await page.evaluate(() => {
        const boxes = [
          ...document.querySelectorAll(
            ".topbar > .world-switcher, .topbar-right > button",
          ),
        ]
          .map((b) => b.getBoundingClientRect())
          .filter((b) => b.width && b.height);
        return boxes.some((a, i) =>
          boxes
            .slice(i + 1)
            .some(
              (b) =>
                Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
            ),
        );
      });
      assert.equal(headerOverlap, false);
      await page.addStyleTag({
        content:
          ".gotchiverse{font-size:32px}.gotchiverse button,.gotchiverse p,.gotchiverse label,.gotchiverse input{font-size:inherit!important}",
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: join(out, `${engine}-${name}-enlarged.png`),
        fullPage: true,
      });
      const after = await page.request
        .get(base + "/api/me")
        .then((r) => r.json());
      assert.equal(after.player.xp, account.player.xp);
      assert.equal(after.player.gold_u, account.player.gold_u);
      assert.deepEqual(physicalClaims, []);
      virtual = false;
      await page.locator('.nav-rail button[aria-label="Inventory"]').click();
      await page.locator('.app-shell[data-screen=inventory]').waitFor();
      await page.goBack();
      await page.locator('.gotchi-stage').waitFor();
      assert.equal((await getState(page)).workshop.id, initial.workshop.id);
      await page
        .getByRole("button", { name: "Back outdoors", exact: true })
        .click();
      await page.locator(".app-shell[data-screen=explore]").waitFor();
      assert.equal(await page.locator(".gotchiverse").count(), 0);
      reports.push({
        engine,
        name,
        viewport: [width, height],
        flow: "passed",
        revisions: [
          initial.workshop.revision,
          built.workshop.revision,
          reloaded.workshop.revision,
        ],
        geometry,
        axeSerious: scan,
        physicalClaimsInVirtual: physicalClaims,
        pageErrors,
      });
      assert.deepEqual(pageErrors, []);
      await context.close();
    }
    await browser.close();
  }
  // Two independently authenticated explorers build in one actual server workshop.
  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    b = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    pa = await a.newPage(),
    pb = await b.newPage();
  await newExplorer(pa, "Lumi Builder");
  await openWorld(pa);
  await pa
    .getByRole("button", { name: "Build with friends", exact: true })
    .click();
  await pa
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const link = await pa.locator("#gotchi-invite").inputValue();
  await pb.goto(link);
  await pb.locator("#nickname").fill("Nori Friend");
  await pb
    .getByRole("button", { name: "Start exploring", exact: true })
    .click();
  await pb.locator(".gotchi-stage").waitFor();
  assert.match(
    await pb.locator(".gotchi-map-heading strong").innerText(),
    /Lumi Builder/,
  );
  await pb.getByRole("button", { name: "Raise", exact: true }).click();
  await pb
    .getByText("Saved. Your landscape is up to date.", { exact: true })
    .waitFor();
  await pa.waitForFunction(() =>
    document
      .querySelector(".gotchi-visitor")
      ?.textContent?.includes("Nori Friend"),
  );
  await pa.getByRole("button", { name: "Remove access", exact: true }).click();
  await pb
    .getByText(
      "Access to this workshop ended. Open your own workshop to keep building.",
      { exact: true },
    )
    .waitFor({ timeout: 10000 });
  reports.push({
    flow: "two-player-server-building-and-revocation",
    passed: true,
  });
  await a.close();
  await b.close();
  await browser.close();
  if (!process.env.GOTCHIVERSE_QA_SMOKE) {
    const translatedBrowser = await chromium.launch({ headless: true });
    browsers.push(translatedBrowser);
    for (const lang of [
      "en",
      "cs",
      "de",
      "es",
      "fr",
      "pt",
      "ru",
      "zh",
      "ja",
      "ar",
      "hi",
    ]) {
      const context = await translatedBrowser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await newExplorer(page, `Lumi ${lang}`);
      await page.goto(base + `/?lang=${lang}`);
      await page.locator(".topbar .world-switcher").click();
      await page.locator(".world-choice").last().click();
      await page.locator(".gotchi-stage").waitFor();
      await page.locator(".main-panel").evaluate((el) => (el.scrollTop = 0));
      assert.equal(await page.locator("html").getAttribute("lang"), lang);
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelector(".main-panel").scrollWidth >
            document.querySelector(".main-panel").clientWidth,
        ),
        false,
      );
      await page.screenshot({
        path: join(out, `locale-${lang}.png`),
        fullPage: true,
      });
      reports.push({
        flow: "locale-layout",
        lang,
        passed: true,
        rtl: lang === "ar",
      });
      await context.close();
    }
    await translatedBrowser.close();
  }
  writeFileSync(
    join(out, "verification.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        reports,
        status: "passed",
        scope:
          "Actual built App and authenticated loopback API; temporary synthetic explorers and separate workshop files. No production, signing, financial or chain action.",
        hardware: false,
        limits: [
          "Browser engines are emulated viewports, not real phones",
          "Focused readonly invitation input is not a physical keyboard-open test",
          "Enlarged font fixture is not native OS scaling",
          "Other visitors use a starter marker, not verified original appearances",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ status: "passed", journeys: reports.length, out }),
  );
} finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  child.kill("SIGTERM");
  writeFileSync(join(out, "server.log"), log);
  rmSync(state, { recursive: true, force: true });
}
