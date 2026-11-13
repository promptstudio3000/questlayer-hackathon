// Layer journey (docs/LAYER.md): the built App and authenticated loopback API
// with disposable state and no signing capability. Two explorers enter the
// shared voxel square, explore the atlas, extract natural ore and see the same
// world change. Screenshots land in output/qa/metalayer-first-expedition/.
//
// Usage: npm run build && npm run e2e:layer
import { chromium } from "playwright";
import sharp from "sharp";
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
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  out = resolve(
    process.env.LAYER_QA_OUT ||
      join(root, "output/qa/metalayer-first-expedition"),
  );
mkdirSync(out, { recursive: true });
assert(
  !existsSync(join(root, ".env")),
  "Run this isolated journey in a checkout without local runtime configuration.",
);
const state = mkdtempSync(join(tmpdir(), "questlayer-layer-app-"));
const guard = join(state, "loopback.mjs");
writeFileSync(
  guard,
  `const original=globalThis.fetch; globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return Promise.reject(new Error('QA permits loopback fetch only'));return original(input,options);};`,
);
const port = await new Promise((ok, fail) => {
  const s = createServer();
  s.on("error", fail);
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => ok(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: root,
  env: {
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
    LAYER_ENABLED: "1",
    NODE_OPTIONS: `--import=${guard}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (b) => (log += b));
child.stderr.on("data", (b) => (log += b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newExplorer(page, name) {
  await page.goto(base);
  await page.locator("#nickname").fill(name);
  await page
    .getByRole("button", { name: "Start exploring", exact: true })
    .click();
  await page.locator(".app-shell[data-screen=explore]").waitFor();
  const intro = page.getByRole("dialog", { name: "How to play", exact: true });
  await intro.waitFor();
  await intro
    .getByRole("button", { name: "Let's explore", exact: true })
    .click();
  await intro.waitFor({ state: "hidden" });
}
async function enterLayer(page) {
  await page.locator(".topbar .world-switcher").click();
  await page.getByRole("button", { name: /MetaLayer/ }).click();
  await page
    .locator('[data-testid="layer-stage"][data-ready="true"]')
    .waitFor({ timeout: 30000 });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [];
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (Date.now() > deadline)
      throw Error("Isolated game did not start: " + log.slice(-2500));
    await sleep(200);
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() =>
    localStorage.setItem("questlayer.playMode", "demo"),
  );
  const phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await newExplorer(phone, "Mira");
  await enterLayer(phone);
  await phone.screenshot({ path: join(out, "phone-390-arrival.png") });
  await phone.locator(".layer-screen .daily-board-chip").click();
  await phone
    .getByRole("button", { name: "Accept expedition", exact: true })
    .click();
  await phone
    .getByRole("dialog", { name: "Expedition board", exact: true })
    .waitFor({ state: "hidden" });
  await phone.screenshot({ path: join(out, "phone-390-expedition.png") });
  await phone.setViewportSize({ width: 360, height: 780 });
  await phone.screenshot({ path: join(out, "phone-360-world.png") });
  assert.equal(await phone.locator(".ml-map-tools").count(), 0, "the map stays folded until requested");
  await phone.getByRole("button", { name: "Map settings", exact: true }).click();
  await phone.getByRole("button", { name: "Shared atlas", exact: true }).click();
  await phone.getByRole("button", { name: "Open shared atlas" }).click();
  await phone.screenshot({ path: join(out, "phone-360-atlas.png") });
  await phone.getByRole("button", { name: "Look north", exact: true }).click();
  await phone
    .getByRole("button", { name: "Central square", exact: true })
    .click();
  await phone.keyboard.press("Escape");
  await phone.setViewportSize({ width: 740, height: 360 });
  await phone.screenshot({ path: join(out, "landscape-world.png") });
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.getByRole("button", { name: "Map settings", exact: true }).click();
  await phone
    .getByRole("button", { name: "Open MetaLayer field guide" })
    .click();
  await phone.addStyleTag({
    content:
      ".ml-sheet, .ml-sheet p, .ml-sheet li, .ml-sheet button { font-size: 20px !important; } .ml-sheet h2 { font-size: 30px !important; }",
  });
  await phone.screenshot({ path: join(out, "phone-390-enlarged-guide.png") });
  await phone.getByRole("button", { name: "Close", exact: true }).click();
  // Nearby peer is a second authenticated explorer, never a seeded pretend user.
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await desktopContext.addInitScript(() =>
    localStorage.setItem("questlayer.playMode", "demo"),
  );
  const desktop = await desktopContext.newPage();
  const miningResponses = [];
  let aimedOre = null;
  desktop.on("request", (request) => {
    if (request.url().includes("/expedition/mine-start"))
      aimedOre = request.postDataJSON();
  });
  desktop.on("pageerror", (e) => errors.push(e.message));
  desktop.on("response", async (response) => {
    if (response.url().includes("/expedition/mine-"))
      miningResponses.push({
        status: response.status(),
        data: await response.json().catch(() => null),
      });
  });
  await newExplorer(desktop, "Tomas");
  await enterLayer(desktop);
  await desktop.screenshot({ path: join(out, "desktop-world.png") });
  await desktop.locator(".layer-screen .daily-board-chip").click();
  await desktop
    .getByRole("button", { name: "Accept expedition", exact: true })
    .click();
  await desktop
    .getByRole("dialog", { name: "Expedition board", exact: true })
    .waitFor({ state: "hidden" });
  await phone.bringToFront();
  await phone.waitForFunction(
    () =>
      document.querySelector(".ml-location")?.textContent.includes("1 nearby"),
    undefined,
    { timeout: 15000 },
  );
  await phone.getByRole("button", { name: "Actions", exact: true }).click();
  await phone.getByRole("button", { name: "Build", exact: true }).click();
  await phone.screenshot({ path: join(out, "phone-390-materials-on-request.png") });
  await phone.getByRole("radio", { name: "Lamp", exact: true }).click();
  await phone.screenshot({ path: join(out, "phone-390-build.png") });
  await phone.getByRole("button", { name: "Actions", exact: true }).click();
  await phone.getByRole("button", { name: "Mine blocks", exact: true }).click();
  // Exercise travel through the actual keyboard path. The stage exposes the
  // current visual target and position as diagnostics, not a teleport shortcut.
  await desktop.bringToFront();
  await desktop.locator(".layer-canvas").focus();
  await desktop.keyboard.down("w");
  for (let i = 0; i < 130; i++) {
    const position = JSON.parse(
      await desktop
        .locator('[data-testid="layer-stage"]')
        .getAttribute("data-position"),
    );
    if (position.z <= -49) break;
    await sleep(500);
  }
  await desktop.keyboard.up("w");
  const position = JSON.parse(
    await desktop
      .locator('[data-testid="layer-stage"]')
      .getAttribute("data-position"),
  );
  assert.ok(
    position.z <= -47 && position.z >= -65,
    `walk reached cave entrance: ${JSON.stringify(position)}`,
  );
  await sleep(1000);
  // Turn with the same D key the player uses, then approach the eastern wall.
  await desktop.locator(".layer-canvas").focus();
  await desktop.keyboard.down("d");
  for (let i = 0; i < 50; i++) {
    const yaw = Number(
      await desktop
        .locator('[data-testid="layer-stage"]')
        .getAttribute("data-heading"),
    );
    if (yaw <= -Math.PI / 2 + 0.08) break;
    await sleep(80);
  }
  await desktop.keyboard.up("d");
  await desktop.keyboard.down("w");
  for (let i = 0; i < 50; i++) {
    const p = JSON.parse(
      await desktop
        .locator('[data-testid="layer-stage"]')
        .getAttribute("data-position"),
    );
    if (p.x >= 2.8) break;
    await sleep(80);
  }
  await desktop.keyboard.up("w");
  await sleep(900);
  await desktop.screenshot({ path: join(out, "desktop-mine-aim.png") });
  // Pick a visible cyan ore face from the actual rendered image. This exercises
  // the ordinary pointer-and-hold path without injecting a target or position.
  const screenshot = await desktop.screenshot();
  const { data: pixels, info } = await sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const candidates = [];
  for (let y = 110; y < info.height - 270; y += 12)
    for (let x = 55; x < info.width - 210; x += 12) {
      const offset = (y * info.width + x) * 4;
      const [red, green, blue] = pixels.subarray(offset, offset + 3);
      if (red < 185 && green > 200 && blue > 190 && green - red > 40)
        candidates.push({
          x,
          y,
          distance: (x - info.width / 2) ** 2 + (y - info.height * 0.48) ** 2,
        });
    }
  candidates.sort((a, b) => a.distance - b.distance);
  const chosen = [];
  for (const candidate of candidates)
    if (
      chosen.every((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) > 38)
    ) {
      chosen.push(candidate);
      if (chosen.length >= 10) break;
    }
  assert.ok(
    chosen.length,
    "the mine has visible diamond ore in the rendered scene",
  );
  const before = await desktop.evaluate(async () =>
    (await fetch("/api/layer/expedition/state?x=0&z=-50")).json(),
  );
  let after = before;
  for (const point of chosen) {
    await desktop.mouse.move(point.x, point.y);
    await desktop.mouse.down();
    await sleep(2200);
    await desktop.mouse.up();
    await sleep(300);
    after = await desktop.evaluate(async () =>
      (await fetch("/api/layer/expedition/state?x=0&z=-50")).json(),
    );
    if (after.inventory.diamonds === before.inventory.diamonds + 1) break;
  }
  const target = aimedOre;
  assert.equal(
    after.inventory.diamonds,
    before.inventory.diamonds + 1,
    `holding a rendered ore face grants one diamond; ${JSON.stringify({ miningResponses, target, position })}`,
  );
  assert.ok(
    after.changes.some(
      ([x, y, z, block]) =>
        x === target.x && y === target.y && z === target.z && block === 0,
    ),
  );
  await desktop
    .getByRole("button", { name: "Open resource inventory" })
    .click();
  await desktop.screenshot({ path: join(out, "desktop-resource-receipt.png") });
  await desktop.keyboard.press("Escape");
  await phone.bringToFront();
  const shared = await phone.evaluate(async () =>
    (await fetch("/api/layer/expedition/state?x=0&z=-50")).json(),
  );
  assert.ok(
    shared.changes.some(
      ([x, y, z, block]) =>
        x === target.x && y === target.y && z === target.z && block === 0,
    ),
    "other authenticated explorer sees the same mined block",
  );
  await desktop.bringToFront();
  await desktop.reload();
  await desktop.locator('[data-testid="layer-stage"][data-ready="true"]').waitFor({ timeout: 30000 });
  await desktop
    .getByRole("button", { name: "Open resource inventory" })
    .click();
  const recovered = await desktop.evaluate(async () =>
    (await fetch("/api/layer/expedition/state?x=0&z=-50")).json(),
  );
  assert.deepEqual(
    recovered.inventory,
    after.inventory,
    "resources survive reload",
  );
  assert.deepEqual(errors, [], "no browser runtime errors");
  writeFileSync(
    join(out, "verification.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        checks: [
          "360 and 390 phone layouts",
          "landscape",
          "enlarged guide",
          "atlas controls",
          "two authenticated peers",
          "keyboard travel into cave",
          "held tool resource receipt",
          "shared mined block",
          "reload recovery",
        ],
        position,
        target,
        inventory: recovered.inventory,
        errors,
        hardware: false,
        status: "passed",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
  rmSync(state, { recursive: true, force: true });
}
