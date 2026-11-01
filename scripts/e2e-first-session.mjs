// Automated journey through a newcomer's first session on a phone-sized
// viewport (390 x 844): name → nearest find → first coin → first chest →
// Aura → secure/share, then the sound/vibration/motion settings.
//
// Usage:  npm run build && npm run e2e:first-session
// It starts its own server on a free port with a throwaway database unless
// E2E_BASE_URL points at a running one. Screenshots land in
// output/qa/2026-11-first-session/ (override with E2E_SHOTS).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = resolve(
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

let shot = 0;
async function capture(page, name) {
  shot += 1;
  const file = join(SHOTS, `${String(shot).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  screenshot ${file}`);
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

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
      acceptDownloads: true,
      locale: "en-GB",
    });
    // Record vibration calls; headless Chromium has no vibration motor.
    await context.addInitScript(() => {
      window.__vibrations = [];
      navigator.vibrate = (pattern) => {
        window.__vibrations.push(pattern);
        return true;
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));

    console.log("1. Name");
    await page.goto(server.url);
    await page.getByPlaceholder("Your explorer name").waitFor();
    await capture(page, "welcome");
    await page.getByPlaceholder("Your explorer name").fill("Mira");
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
    console.log("First-session journey passed.");
  } finally {
    await browser.close();
    server.stop();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
