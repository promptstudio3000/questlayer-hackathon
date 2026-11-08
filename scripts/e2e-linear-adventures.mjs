// Actual local App/API with disposable explorers. GPS is synthetic; no keys or chain actions.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { daytimeOffset } from "./lib/e2e-clock.mjs";
import { polygonsOf, containsPoint, nearestOnSegment } from "../server/poi/geo.mjs";

const root = resolve(import.meta.dirname, "..");
const phase = process.env.E2E_PHASE || "after";
const language = process.env.E2E_LANG || "en";
const dictionary = language === "en" ? {} : JSON.parse(readFileSync(join(root,"src/i18n",language+".json"),"utf8"));
const t = (key) => dictionary[key] || key;
const engine = process.env.E2E_BROWSER === "webkit" ? webkit : chromium;
const shots = resolve(process.env.E2E_SHOTS || `output/qa/linear-adventures-2026-11-07/${phase}`);
mkdirSync(shots, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "questlayer-linear-test-")), offset = daytimeOffset();
const port = await new Promise(done => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => done(p)); }); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", join(root, "scripts/lib/e2e-clock.mjs"), join(root, "server/index.mjs")], {
  cwd: dir, env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: String(port), APP_ORIGIN: url, DATABASE_PATH: join(dir, "test.sqlite"), DISABLE_RELAYER: "1", DISABLE_NATIVE_ATTESTATIONS: "1", NEAR_RPC_URL: "http://127.0.0.1:9", E2E_CLOCK_OFFSET_MS: String(offset) }, stdio: ["ignore", "ignore", "pipe"],
});
let stderr = ""; server.stderr.on("data", d => stderr += d);
const report = { phase, language, engine: engine.name(), provenance: "Actual local App/API and confirmed demo claims; disposable data, synthetic GPS", cases: [] };
const axe = createRequire(import.meta.url)("axe-core").source;
const plzen = { lat: 49.74745, lng: 13.3774 };
let browser;
async function gpsContext(point) {
  // Fault injection must reach page.route; a controlling service worker can
  // bypass interception. Normal service-worker behavior has first-session coverage.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", hasTouch: true, serviceWorkers: "block" });
  await context.addInitScript(({ point, offset }) => {
    const RealDate = Date;
    window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); } static now() { return RealDate.now() + offset; } };
    let position = point, accuracy = 5, watcher, timer;
    const fix = () => ({ coords: { latitude: position.lat, longitude: position.lng, accuracy, heading: null, speed: 0 }, timestamp: Date.now() });
    navigator.geolocation.getCurrentPosition = success => success(fix());
    navigator.geolocation.watchPosition = success => { watcher = success; timer = setInterval(() => success(fix()), 1000); return 1; };
    navigator.geolocation.clearWatch = () => clearInterval(timer);
    window.__moveTestGps = (next, precision = 5) => { position = next; accuracy = precision; watcher?.(fix()); };
  }, { point, offset });
  return context;
}
function interior(zone) {
  const polygons = polygonsOf(zone.geometry), candidates = [zone];
  for (const [ring] of polygons) {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    for (let x = 1; x < 10; x++) for (let y = 1; y < 10; y++) candidates.push({ lng: minX + (maxX - minX) * x / 10, lat: minY + (maxY - minY) * y / 10 });
  }
  return candidates.filter(p => containsPoint(zone.geometry, [p.lng, p.lat])).map(p => ({ p, margin: Math.min(...polygons.flat(1).flatMap(r => r.slice(1).map((_, i) => nearestOnSegment([p.lng, p.lat], r[i], r[i + 1]).distanceM))) })).sort((a, b) => b.margin - a.margin)[0]?.p;
}
try {
  const until = Date.now() + 60000;
  while (true) { try { if ((await fetch(url + "/api/health")).ok) break; } catch {} if (Date.now() > until) throw Error(stderr.slice(-1000)); await new Promise(r => setTimeout(r, 100)); }
  browser = await engine.launch();
  for (const [name, width, height] of [["phone-360", 360, 780], ["phone-390", 390, 844], ["landscape", 844, 390], ["desktop", 1440, 900]]) {
    if (process.env.E2E_VIEWPORT && process.env.E2E_VIEWPORT !== name) continue;
    const context = await gpsContext(plzen);
    const post = async (path, data) => { const r = await context.request.post(url + "/api" + path, { headers: { Origin: url }, data, maxRetries: 1 }); const body = await r.json(); assert.ok(r.ok(), path + ": " + JSON.stringify(body)); return body; };
    await post("/session", { name: `Mira ${name}` });
    const world = await post("/world", { arena: false, location: plzen }), now = Date.now() + offset;
    const quest = world.quests.find(q => q.kind === "chest" && q.tier === 1 && q.itemAvailable === true && q.opens_at <= now && q.closes_at > now);
    assert.ok(quest, "A current free chest exists");
    const zone = world.zones.find(z => z.id === quest.zone_id), target = quest.nextPoint || quest;
    const page = await context.newPage(); await page.setViewportSize({ width, height });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    // The first location fixes use the actual target, with no artificial travel claim.
    await page.goto(url+"/?lang="+language); await page.getByRole("button", { name: t("Use GPS, my location"), exact: true }).waitFor();
    await page.evaluate(p => window.__moveTestGps(p), target);
    await page.getByRole("button", { name: t("Use GPS, my location"), exact: true }).click();
    await page.locator(".world-loading").waitFor({ state: "hidden", timeout: 60000 });
    await page.getByRole("button", { name: t("Map tools"), exact: true }).click();
    await page.getByRole("button", { name: t("Nearby discoveries"), exact: true }).click();
    await page.locator(".zone-card").filter({ hasText: zone.name }).first().click();
    const details = page.locator(".quest-detail"); await details.waitFor();
    const expectedTitle = quest.title === "Path chest" ? t("A chest along the path") : quest.title;
    if (!(await details.innerText()).includes(expectedTitle)) {
      if (phase === "before") await page.locator(".zone-activities > summary").click();
      await page.locator(phase === "before" ? ".walk-picker button" : ".activity-picker button").filter({ has: page.locator('[data-object-kind="chest"]') }).first().click();
    }
    await details.getByRole("heading", { name: expectedTitle, exact: true }).waitFor();
    const scans = [];
    const capture = async label => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ": no page overflow");
      if (width === 390) {
        await page.addScriptTag({ content: axe });
        const issues = await page.evaluate(async () => (await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v => ["critical", "serious"].includes(v.impact)).map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
        assert.deepEqual(issues, [], label + ": accessibility"); scans.push({ label, issues });
      }
      await page.screenshot({ path: join(shots, `${name}-${label}.png`) });
    };
    let claimRequests = 0; page.on("request", r => { if (r.url().endsWith("/api/quests/claim")) claimRequests++; });
    await capture("quest-overview");
    if (phase !== "before") {
      assert.equal(await details.locator("details[open]").count(), 0, "Services start folded");
      assert.equal(await details.getByRole("button", { name: t("Start quest"), exact: true }).count(), 1);
      await details.getByRole("button", { name: t("Start quest"), exact: true }).click();
      assert.equal(claimRequests, 0, "Start never requests or grants a reward");
      await details.getByRole("button", { name: t("Open chest"), exact: true }).waitFor();
      await capture("quest-ready");
    }
    let failedClaimRequests=0;
    if (phase !== "before" && width === 390) {
      const outside = Array.from({length:24},(_,i)=>({lat:target.lat+24*Math.cos(i*Math.PI/12)/111320,lng:target.lng+24*Math.sin(i*Math.PI/12)/(111320*Math.cos(target.lat*Math.PI/180))})).find(p=>!containsPoint(zone.geometry,[p.lng,p.lat]));
      assert.ok(outside,"This real target has a nearby point outside the zone footprint");
      await page.evaluate(point=>window.__moveTestGps(point),outside);
      await details.getByRole("button",{name:t("Show on map"),exact:true}).waitFor();
      assert.equal(await details.getByRole("button",{name:t("Open chest"),exact:true}).count(),0,"Proximity outside the zone cannot offer confirmation");
      assert.equal(claimRequests,0);
      await capture("quest-outside-zone");
      await page.evaluate(point=>window.__moveTestGps(point),target);
      await details.getByRole("button",{name:t("Open chest"),exact:true}).waitFor();
      await page.evaluate(point=>window.__moveTestGps(point,80),target);
      await details.getByRole("button",{name: t("Update location"),exact:true}).waitFor();
      await capture("quest-uncertain-gps");
      await details.getByRole("button",{name: t("Update location"),exact:true}).click();
      assert.equal(claimRequests,0,"Refreshing a location is not a claim");
      await page.evaluate(point=>window.__moveTestGps(point,5),target);
      await details.getByRole("button",{name: t("Open chest"),exact:true}).waitFor();
      await context.setOffline(true);
      await details.getByRole("button",{name: t("You're offline"),exact:true}).waitFor();
      assert.ok(await details.getByRole("button",{name: t("You're offline"),exact:true}).isDisabled());
      await capture("quest-offline");
      await context.setOffline(false);
      await details.getByRole("button",{name: t("Open chest"),exact:true}).waitFor();
      // Keep the transport fault installed until the error is visible.
      const failClaim=route=>route.abort("failed");
      await page.route("**/api/quests/claim",failClaim);
      await details.getByRole("button",{name: t("Open chest"),exact:true}).click();
      await page.locator("dialog[open] .inline-error").waitFor().catch(async error=>{
        await page.screenshot({path:join(shots,`${name}-request-failure-diagnostic.png`)});
        console.error("Failed request state:",await page.locator("dialog[open]").allTextContents());
        throw error;
      });
      await capture("quest-retry");
      assert.equal(await page.locator(".adventure-results-dialog").count(),0,"No unconfirmed reward appears after a failed request");
      failedClaimRequests=claimRequests;assert.ok(failedClaimRequests>=1,"The failed claim was actually attempted");
      await page.unroute("**/api/quests/claim",failClaim);
    }
    const claim = page.waitForResponse(r => r.url().endsWith("/api/quests/claim"));
    await details.getByRole("button", { name: t("Open chest"), exact: true }).click();
    const claimResponse = await claim; const claimed = await claimResponse.json(); assert.ok(claimResponse.ok(), JSON.stringify({status:claimResponse.status(),error:claimed.error,code:claimed.code})); assert.ok(claimed.item, "A real server reply supplies the Aura");
    const reward = page.locator(".adventure-results-dialog"); await reward.getByRole("button", { name: t("Try it on"), exact: true }).waitFor();
    if(phase!=="before")assert.equal(await page.locator("dialog[open]").count(),1,"A reward replaces the quest dialog instead of stacking surfaces");
    await capture("reward");
    if (phase !== "before") {
      assert.equal(await reward.locator("details[open]").count(), 0, "Reward services start folded");
      assert.equal(await reward.locator(".primary-button:visible").count(), 1, "One primary reward action");
      await reward.locator(".reward-more > summary").click();
      await reward.getByRole("button", { name: t("Open collection"), exact: true }).waitFor();
      await capture("reward-more");
      await reward.locator(".reward-more > summary").click();
    }
    const equip = page.waitForResponse(r => r.url().endsWith("/api/equip"));
    await reward.getByRole("button", { name: t("Try it on"), exact: true }).click();
    const equipped = await (await equip).json(); assert.equal(equipped.player.inventory.find(i => i.id === claimed.item.id)?.equipped, 1);
    await reward.waitFor({ state: "hidden" });
    assert.equal(claimRequests, failedClaimRequests+1, "One request follows the explicit retry; no extra successful claim is sent");
    const replay = await post("/quests/claim", { questId: quest.id, checkpoint: 0, fix: { ...target, accuracy: 5, timestamp: Date.now() + offset } });
    assert.equal(replay.replayed, true, "Retry returns the same durable result");
    assert.equal(replay.item.id, claimed.item.id);
    assert.deepEqual(errors, []);
    report.cases.push({ name, width, height, claims: claimRequests, item: claimed.item.name, equipped: true, replay: true, scans });
    await context.close();
    if (phase !== "before") {
      const entry = interior(zone); assert.ok(entry, "The zone has a real interior test point");
      const zoneContext = await gpsContext(entry);
      const zpost = async (path, data) => { const r = await zoneContext.request.post(url + "/api" + path, { headers: { Origin: url }, data, maxRetries: 1 }); assert.ok(r.ok()); return r.json(); };
      await zpost("/session", { name: `Zone ${name}` });
      const zonePage = await zoneContext.newPage(); await zonePage.setViewportSize({width,height});
      await zonePage.goto(url+"/?lang="+language); await zonePage.getByRole("button",{name: t("Use GPS, my location"),exact:true}).click();
      await zonePage.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
      await zonePage.locator(".zone-presence-ready").waitFor();
      await zonePage.locator(".map-loading").waitFor({state:"hidden",timeout:60000});
      await zonePage.screenshot({path:join(shots,`${name}-zone-entered.png`)});
      const anchors = await zonePage.locator(".nav-rail,.map-toolbar").evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
      if(width===390){await zonePage.addScriptTag({content:axe});const issues=await zonePage.evaluate(async()=>(await window.axe.run()).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(issues,[],"Inside-zone cue accessibility");}
      await zonePage.evaluate(point=>window.__moveTestGps(point,80),entry);
      await zonePage.locator(".zone-presence-uncertain").waitFor();
      assert.equal(await zonePage.locator(".zone-presence-ready").count(),0,"Inaccurate GPS never advertises ready activities");
      await zonePage.screenshot({path:join(shots,`${name}-zone-uncertain.png`)});
      const xs=polygonsOf(zone.geometry).flat(2).map(p=>p[0]);
      await zonePage.evaluate(point=>window.__moveTestGps(point,5),{lat:entry.lat,lng:Math.max(...xs)+.002});
      await zonePage.locator(".zone-presence").waitFor({state:"hidden"});
      assert.deepEqual(await zonePage.locator(".nav-rail,.map-toolbar").evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y}))),anchors,"Entering/leaving a zone never moves controls");
      await zoneContext.close();

      const pickupContext=await gpsContext(plzen);
      const ppost=async(path,data)=>{const r=await pickupContext.request.post(url+"/api"+path,{headers:{Origin:url},data,maxRetries:1});assert.ok(r.ok());return r.json();};
      await ppost("/session",{name:`Find ${name}`});
      const finds=await ppost("/world",{arena:false,location:plzen});
      const find=finds.coins.find(c=>c.wearable&&!c.claimant);assert.ok(find,"An actual unclaimed wearable find exists");
      const pickupPage=await pickupContext.newPage();await pickupPage.setViewportSize({width,height});
      await pickupPage.goto(url+"/?lang="+language);await pickupPage.getByRole("button",{name: t("Use GPS, my location"),exact:true}).waitFor();
      await pickupPage.evaluate(point=>window.__moveTestGps(point),find);
      const picked=pickupPage.waitForResponse(r=>r.url().endsWith("/api/coins/claim")&&r.request().postDataJSON()?.coinId===find.id);
      await pickupPage.getByRole("button",{name: t("Use GPS, my location"),exact:true}).click();
      const confirmed=await(await picked).json();assert.equal(confirmed.wearable?.id,find.wearable.id);assert.equal(confirmed.wearable.duplicate,false);
      const moment=pickupPage.locator(".wearable-moment");await moment.waitFor();
      assert.equal(await moment.locator("details[open]").count(),0);assert.equal(await moment.locator(".primary-button:visible").count(),1);
      await pickupPage.screenshot({path:join(shots,`${name}-wearable-found.png`)});
      if(width===390){await pickupPage.addScriptTag({content:axe});const issues=await pickupPage.evaluate(async()=>(await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(issues,[],"Confirmed wearable accessibility");}
      await moment.getByRole("button",{name: t("Continue"),exact:true}).click();await moment.waitFor({state:"hidden"});
      await pickupPage.reload();await pickupPage.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
      assert.equal(await pickupPage.locator(".wearable-moment").filter({hasText:find.wearable.name}).count(),0,"Reload never replays a historical pickup");
      await pickupContext.close();
      report.cases.at(-1).zoneEntryExitAndUncertainty=true;report.cases.at(-1).confirmedWearableAndNoReplay=true;
    }
    writeFileSync(join(shots,"report.json"),JSON.stringify(report,null,2));
    console.log(`${name}: quest, actual reward, equip, replay and zone/pickup states passed`);
  }
  writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
} finally { await browser?.close(); server.kill("SIGTERM"); }
