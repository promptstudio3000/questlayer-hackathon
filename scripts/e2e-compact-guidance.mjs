// Real local App/API, disposable explorers and data; no credentials or chain actions.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { activityLabel } from "../src/activity-view.ts";

const root = resolve(import.meta.dirname, "..");
const shots = resolve(process.env.E2E_SHOTS || "output/qa/compact-guidance-2026-11-08/activities");
mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "questlayer-guidance-"));
const port = await new Promise(done => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => done(p)); }); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, "server/index.mjs")], {
  cwd: dir,
  env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: url, DATABASE_PATH: join(dir, "test.sqlite"), DISABLE_RELAYER: "1", DISABLE_NATIVE_ATTESTATIONS: "1", DISABLE_BACKGROUND_WORKERS: "1", NEAR_RPC_URL: "http://127.0.0.1:9", ACTORS_ALL_DAY: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});
let stderr = "", browser;
server.stderr.on("data", d => { stderr += d; });
const report = { provenance: "Actual local App/API; isolated data, no wallet or physical-device claim", browser: process.env.E2E_BROWSER || "chromium", cases: [] };
const axe = createRequire(import.meta.url)("axe-core").source;
try {
  const until = Date.now() + 60000;
  while (true) { try { if ((await fetch(url + "/api/health")).ok) break; } catch {} if (Date.now() > until) throw Error(stderr.slice(-1000)); await new Promise(r => setTimeout(r, 100)); }
  browser = await (process.env.E2E_BROWSER === "webkit" ? webkit : chromium).launch();
  for (const [name, width, height] of [["phone-360",360,780],["phone-390",390,844],["landscape",844,390],["desktop",1440,900]]) {
    if (process.env.E2E_VIEWPORT && process.env.E2E_VIEWPORT !== name) continue;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
    const post = async (path, data) => { const r = await context.request.post(url + "/api" + path, { headers: { Origin: url }, data }); assert.ok(r.ok(), path); return r.json(); };
    await post("/session", { name: `Mira ${name}` });
    const world = await post("/world", { arena: true, location: { lat:49.74745, lng:13.3774 } });
    const now = Date.now();
    const walk = world.quests.find(q => q.kind === "route" && q.tier === 1 && q.opens_at <= now && q.closes_at > now);
    assert.ok(walk, "An available free walk exists");
    const zone = world.zones.find(z => z.id === walk.zone_id);
    const other = world.zones.find(z => z.tier === 1 && z.id !== zone.id && z.opensAt <= now && z.closesAt > now);
    assert.ok(other, "Another place can be browsed");
    const page = await context.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    let claims = 0; page.on("request", r => { if (/\/api\/quests\/(claim|checkpoint)$/.test(r.url())) claims++; });
    await page.goto(url);
    await page.locator(".world-loading").waitFor({ state:"hidden", timeout:60000 });
    await page.getByRole("button", { name:"Explore", exact:true }).click();
    await page.locator(".zone-card").filter({ hasText:zone.name }).click();
    const picker = page.locator(".activity-picker");
    await picker.getByRole("button", { name:activityLabel(walk), exact:true }).click();
    assert.ok((await picker.boundingBox()).y < (await page.locator(".quest-detail-art").boundingBox()).y, "Activity choices precede the illustration and details");
    assert.equal(await page.locator(".quest-brief-more[open]").count(), 0);
    assert.equal(await picker.locator("button").count(), world.quests.filter(q => q.zone_id === zone.id).length);
    const capture = async label => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ": no horizontal overflow");
      await page.screenshot({ path:join(shots, `${name}-${label}.png`) });
    };
    await capture("activity-choices");
    await page.getByRole("button", { name:"Start quest", exact:true }).click();
    await page.locator(".sheet-compact .compact-selection").waitFor();
    const original = await page.locator(".compact-selection").innerText();
    assert.match(original, /Stop 1 of|Any order/);
    assert.equal(claims, 0, "Starting a walk does not submit evidence or claim a reward");
    await capture("active-map");
    await page.getByRole("button", { name:"Explore", exact:true }).click();
    await page.locator(".zone-card").filter({ hasText:other.name }).click();
    await page.getByRole("button", { name:"Close panel", exact:true }).click();
    assert.equal(await page.locator(".compact-selection").innerText(), original, "Inspecting another place preserves the current adventure");
    await page.reload();
    await page.locator(".sheet-compact .compact-selection").waitFor();
    assert.equal(await page.locator(".compact-selection").innerText(), original, "Reload restores the same activity and next step");
    if (width === 390) {
      await page.addScriptTag({ content:axe });
      const issues = await page.evaluate(async () => (await window.axe.run()).violations.filter(v => ["critical","serious"].includes(v.impact)).map(v => v.id));
      assert.deepEqual(issues, [], "Map accessibility");
      const small = await page.locator(".rail-links button, .demo-pad button, .map-toolbar > button").evaluateAll(nodes => nodes.filter(e => e.checkVisibility()).map(e => ({ label:e.getAttribute("aria-label"), r:e.getBoundingClientRect() })).filter(x => x.r.width < 47.9 || x.r.height < 47.9).map(x => x.label));
      assert.deepEqual(small, [], "Essential controls retain 48px targets");
    }
    assert.deepEqual(errors, []);
    report.cases.push({ name, preservedThroughBrowse:true, preservedThroughReload:true, claims });
    await context.close();
  }
} catch (error) {
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    console.error((await page.locator("body").innerText()).slice(-6000));
    await page.screenshot({ path:join(shots, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); server.kill("SIGTERM");
  writeFileSync(join(shots, "verification.json"), JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));
