// Local HTTP and browser verification of an actually prepared geographic day.
// GPS is simulated; these checks are not physical access/device verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { readPreparedContent } from "../server/world-preparation/read.mjs";

const arg = (key) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key)+1] : null;
assert.ok(arg("--days") && arg("--out"), "Use --days <prepared-days> --out <qa-output> after npm run build.");
const days = resolve(arg("--days")), out = resolve(arg("--out")), day = new Date().toISOString().slice(0,10);
const file = resolve(days,day,"manifest.json"), manifest = JSON.parse(readFileSync(file));
mkdirSync(out,{recursive:true});
const port = await new Promise((done,fail) => {const s=createServer();s.on("error",fail);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`, temp=mkdtempSync(resolve(tmpdir(),"questlayer-global-browser-"));
const child=spawn(process.execPath,["server/index.mjs"],{env:{PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:resolve(temp,"test.sqlite"),DISABLE_RELAYER:"1",DISABLE_BACKGROUND_WORKERS:"1",GLOBAL_ACTIVITY_DAYS_DIR:days},stdio:["ignore","pipe","pipe"]});
let log="";child.stdout.on("data",d=>log=(log+d).slice(-10000));child.stderr.on("data",d=>log=(log+d).slice(-10000));
let browser;
const report={day,inputHash:manifest.inputHash,counts:manifest.counts,scope:"Real OSM inputs; local server, simulated GPS and desktop browser emulation only.",http:[],screens:[],pageErrors:[]};
try {
  const deadline=Date.now()+30000;
  for(;;) {
    const health=await fetch(`${url}/api/health`).then(r=>r.json()).catch(()=>null);
    if(health?.globalActivities?.days.some(d=>d.day===day && d.state==="ready")) {report.readiness=health.globalActivities;break;}
    assert.ok(Date.now()<deadline,`Server did not import the day: ${log}`);await new Promise(r=>setTimeout(r,100));
  }
  browser=await chromium.launch();
  const selected=[];
  for(const region of manifest.regions) {
    if(selected.some(s=>s.country===region.countries[0])) continue;
    const content=readPreparedContent(file,region.id), quest=content.objects.find(o=>o.kind==="quest" && o.zoneId) || content.objects.find(o=>o.kind==="quest" && !o.title.startsWith("Atlas:"));
    if(quest) selected.push({country:region.countries[0],quest,region:region.id});
  }
  const expectedCountries=(arg('--expected-countries')||'DE,ZA,JP,US,AR,AU').split(',').sort();
  assert.deepEqual(selected.map(s=>s.country).sort(),expectedCountries,"The real-data journey must cover the explicitly expected countries.");
  for(const {country,quest,region} of selected) {
    const context=await browser.newContext();
    const request=async(path,body)=>{const response=await context.request.post(url+"/api"+path,{data:body,headers:{Origin:url}});return {status:response.status(),data:await response.json()};};
    assert.equal((await request("/session",{name:`Map pilot ${country}`})).status,201);
    const loaded=await request("/world",{location:quest.target,arena:false});assert.equal(loaded.status,200);assert.equal(loaded.data.globalPreparation.financialActivation,false);
    const q=loaded.data.quests.find(q=>q.id===quest.id);assert.ok(q,`Prepared quest ${quest.id} must be visible at its real target.`);
    const distant=await request("/quests/claim",{questId:q.id,fix:{lat:q.lat+.01,lng:q.lng,accuracy:5,timestamp:Date.now()}});assert.equal(distant.status,422);assert.match(distant.data.error,/closer|range/i);
    const fix={lat:q.lat,lng:q.lng,accuracy:5,timestamp:Date.now()}, first=await request("/quests/claim",{questId:q.id,fix}), replay=await request("/quests/claim",{questId:q.id,fix});
    assert.equal(first.status,200);assert.equal(first.data.xp,40);assert.equal(first.data.reward,0);assert.equal(first.data.item,null);assert.equal(replay.data.replayed,true);assert.equal(first.data.result.id,replay.data.result.id);
    report.http.push({country,region,questId:q.id,title:q.title,source:quest.source,lat:q.lat,lng:q.lng,farStatus:distant.status,xp:first.data.xp,reward:first.data.reward,replayed:replay.data.replayed});
    await context.close();
  }
  const q=selected[0].quest;
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,geolocation:{latitude:q.target.lat,longitude:q.target.lng,accuracy:5},permissions:["geolocation"]});
  await context.addInitScript(()=>{localStorage.setItem("questlayer-play-mode-chosen","1");localStorage.setItem("questlayer-play-mode","demo");localStorage.setItem("questlayer.mapAppearance","2d");});
  const page=await context.newPage();page.on("pageerror",e=>report.pageErrors.push(e.message));
  await page.goto(url);
  await page.getByPlaceholder("Your explorer name").fill("Atlas browser pilot");await page.getByRole("button",{name:"Start exploring",exact:true}).click();
  await page.getByRole("button",{name:"Let's explore",exact:true}).click();
  const worldResponse=page.waitForResponse(r=>r.url().endsWith("/api/world") && r.request().postDataJSON()?.arena===false && r.status()===200);
  await page.getByRole("button",{name:"Use GPS, my location",exact:true}).click();await worldResponse;
  await page.waitForFunction(()=>document.querySelector(".coverage-note")?.textContent?.includes("Map-derived discoveries by Atlas"));
  assert.equal(await page.locator(".first-session").count(),0,"The arena coin/chest coach must not promise absent global objects.");
  await page.locator(".map-loading").waitFor({state:"hidden",timeout:45000});
  const expand=page.locator(".main-panel .sheet-toggle[aria-expanded=false]");if(await expand.isVisible()) await expand.click();
  await page.locator(".coverage-note").scrollIntoViewIfNeeded();
  for(const [name,width,height] of [["phone-390",390,844],["phone-360",360,780],["landscape",844,390],["desktop",1440,900]]) {
    await page.setViewportSize({width,height});await page.locator(".coverage-note").scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(out,`${name}.png`)});
    report.screens.push({name,width,height,disclosureOpen:await page.locator(".coverage-note").getAttribute("open")!==null,horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
  }
  await page.setViewportSize({width:390,height:844});
  const paragraph=page.locator(".coverage-note p"), originalSize=await paragraph.evaluate(el=>getComputedStyle(el).fontSize);
  await paragraph.evaluate((el,size)=>el.style.fontSize=`${parseFloat(size)*2}px`,originalSize);await paragraph.scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,"phone-enlarged.png")});
  report.screens.push({name:"phone-enlarged",paragraphScale:2,horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)});
  writeFileSync(resolve(out,"browser-text.txt"),await page.locator("body").innerText());
  await paragraph.evaluate(el=>el.style.fontSize="");
  await page.locator(".zone-card").first().click();
  const confirm=page.getByRole("button",{name:"Confirm visit",exact:true});await confirm.waitFor({state:"visible"});
  await context.setGeolocation({latitude:q.target.lat+.001,longitude:q.target.lng,accuracy:5});
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Confirm visit" && b.disabled));
  await page.screenshot({path:resolve(out,"phone-too-far.png")});
  await context.setGeolocation({latitude:q.target.lat,longitude:q.target.lng,accuracy:5});
  await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Confirm visit" && !b.disabled));
  await page.screenshot({path:resolve(out,"phone-confirm.png")});
  const claimResponse=page.waitForResponse(r=>r.url().endsWith("/api/quests/claim"));await confirm.focus();await page.keyboard.press("Enter");
  const confirmed=await (await claimResponse).json();assert.equal(confirmed.xp,40);assert.equal(confirmed.reward,0);assert.ok(confirmed.result.id);
  report.browserClaim={xp:confirmed.xp,reward:confirmed.reward,durableReceipt:true,tooFarDisabled:true,keyboardConfirmation:true};
  await page.getByRole("button",{name:/Reward collected/}).waitFor({state:"visible"});
  await page.screenshot({path:resolve(out,"phone-completed.png")});
  await context.close();
  report.globalNoticeLocales=[];
  const notice="Map-derived discoveries by Atlas. Public access and paths have not been checked on foot: follow local signs and skip blocked places. These activities award personal XP; no monetary or item reward is promised.";
  for(const lang of ["ar","cs","de","es","fr","hi","ja","pt","ru","zh"]) {
    const localized=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,geolocation:{latitude:q.target.lat,longitude:q.target.lng,accuracy:5},permissions:["geolocation"]});
    await localized.addInitScript(lang=>{localStorage.setItem("questlayer.lang",lang);localStorage.setItem("questlayer-play-mode-chosen","1");localStorage.setItem("questlayer-play-mode","demo");},lang);
    assert.equal((await localized.request.post(url+"/api/session",{data:{name:`Atlas locale ${lang}`},headers:{Origin:url}})).status(),201);
    const p=await localized.newPage();await p.goto(url);await p.locator(".map-status-chip button").click();
    const expected=JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`,import.meta.url)))[notice];
    await p.waitForFunction(text=>document.querySelector(".coverage-note p")?.textContent===text,expected);
    const open=p.locator(".main-panel .sheet-toggle[aria-expanded=false]");if(await open.isVisible())await open.click();
    await p.locator(".coverage-note").scrollIntoViewIfNeeded();await p.screenshot({path:resolve(out,`notice-${lang}.png`)});
    const horizontalOverflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(horizontalOverflow,false);
    report.globalNoticeLocales.push({lang,translated:true,horizontalOverflow});await localized.close();
  }
  assert.deepEqual(report.pageErrors,[]);
  report.state="passed";
} catch(error) {report.state="failed";report.error=error.message;throw error;}
finally {
  writeFileSync(resolve(out,"report.json"),JSON.stringify(report,null,2));
  await browser?.close();child.kill("SIGTERM");await new Promise(r=>{if(child.exitCode!==null)return r();child.once("exit",r);setTimeout(r,3000).unref();});rmSync(temp,{recursive:true,force:true});
}
