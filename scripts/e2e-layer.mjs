// Layer journey (docs/LAYER.md): the built App and authenticated loopback API
// with disposable state and no signing capability. Two explorers enter the
// virtual voxel layer, one builds on their plot, the other sees it and cannot
// build there. Screenshots land in output/qa/layer/.
//
// Usage: npm run build && npm run e2e:layer
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, ".."),
  out = resolve(process.env.LAYER_QA_OUT || join(root, "output/qa/layer"));
mkdirSync(out, { recursive: true });
assert(!existsSync(join(root, ".env")), "Run this isolated journey in a checkout without local runtime configuration.");
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
  await page.getByRole("button", { name: "Start exploring", exact: true }).click();
  await page.locator(".app-shell[data-screen=explore]").waitFor();
  const intro = page.getByRole("dialog", { name: "How to play", exact: true });
  await intro.waitFor();
  await intro.getByRole("button", { name: "Let's explore", exact: true }).click();
  await intro.waitFor({ state: "hidden" });
}
async function enterLayer(page) {
  await page.locator(".topbar .world-switcher").click();
  await page.getByRole("button", { name: /Space Layer/ }).click();
  await page.locator('[data-testid="layer-stage"][data-ready="true"]').waitFor({ timeout: 30000 });
}

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const deadline = Date.now() + 30000;
  while (true) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Isolated game did not start: " + log.slice(-2500));
    await sleep(200);
  }
  const reports = [];
  const pages = [];
  for (const [name, viewport, mobile] of [
    ["phone-390", { width: 390, height: 844 }, true],
    ["desktop", { width: 1440, height: 900 }, false],
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await newExplorer(page, `Nova ${name}`);
    await enterLayer(page);
    const help = page.getByRole("dialog", { name: "How the layer works" });
    await help.waitFor();
    await page.screenshot({ path: join(out, `${name}-welcome.png`) });
    await help.getByRole("button", { name: "Close" }).click();
    await sleep(1500);
    await page.screenshot({ path: join(out, `${name}-world.png`) });
    pages.push({ name, page, errors });
  }
  // The phone explorer builds a small tower on their plot through the API path the UI uses.
  const phone = pages[0].page;
  const home = await phone.evaluate(async () =>
    (await fetch("/api/layer/home", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json(),
  );
  await phone.getByRole("button", { name: "Build", exact: true }).click();
  await phone.getByRole("radio", { name: "Hull plate" }).click();
  await sleep(300);
  await phone.screenshot({ path: join(out, `phone-390-build.png`) });
  const { x0, z0 } = home.plot;
  const edits = [];
  for (let y = 15; y < 19; y++) edits.push({ x: x0 + 6, y, z: z0 + 6, block: 12 }, { x: x0 + 9, y, z: z0 + 6, block: 12 });
  edits.push({ x: x0 + 6, y: 19, z: z0 + 6, block: 14 }, { x: x0 + 9, y: 19, z: z0 + 6, block: 14 });
  const saved = await phone.evaluate(
    async ([plotId, edits]) =>
      (
        await fetch("/api/layer/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plotId, requestId: crypto.randomUUID(), edits }),
        })
      ).json(),
    [home.plot.id, edits],
  );
  assert.equal(saved.plot.blocks, edits.length);
  // The desktop explorer cannot build on the phone explorer's plot.
  const desktop = pages[1].page;
  const refused = await desktop.evaluate(
    async ([plotId, edit]) =>
      (
        await fetch("/api/layer/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plotId, requestId: crypto.randomUUID(), edits: [edit] }),
        })
      ).status,
    [home.plot.id, edits[0]],
  );
  assert.equal(refused, 403);
  await sleep(6500); // one plot sync
  await desktop.screenshot({ path: join(out, `desktop-neighbour.png`) });
  await phone.reload();
  await phone.locator('.topbar .world-switcher, [data-testid="layer-stage"]').first().waitFor();
  await sleep(1000);
  await phone.screenshot({ path: join(out, `phone-390-reloaded.png`) });
  if (!(await phone.locator('[data-testid="layer-stage"]').count())) await enterLayer(phone);
  else await phone.locator('[data-testid="layer-stage"][data-ready="true"]').waitFor({ timeout: 30000 });
  await sleep(1500);
  await phone.screenshot({ path: join(out, `phone-390-tower.png`) });
  for (const p of pages) {
    const fps = await p.page.locator('[data-testid="layer-stage"]').getAttribute("data-fps");
    reports.push({ viewport: p.name, fps: Number(fps), errors: p.errors });
    assert.deepEqual(p.errors, [], `${p.name} page errors`);
  }
  writeFileSync(join(out, "verification.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), reports, status: "passed", hardware: false }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", reports, out }));
} finally {
  await browser.close().catch(() => {});
  child.kill("SIGTERM");
  writeFileSync(join(out, "server.log"), log);
  rmSync(state, { recursive: true, force: true });
}
