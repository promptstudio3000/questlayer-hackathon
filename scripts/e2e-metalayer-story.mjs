// Built-App story interaction checks, with disposable loopback state. The
// extraction prerequisite is a named UI fixture; the full extraction-to-finale
// lifecycle is separately tested at the authenticated store boundary. No live
// NEAR transaction, reward or signer is used by this journey.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import "../server/schema-catalog.mjs";
import { openDatabase } from "../server/database.mjs";

const root = resolve(import.meta.dirname, ".."), out = resolve(process.env.LAYER_QA_OUT || "output/qa/metalayer-story-2026-11-13");
mkdirSync(out, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "metalayer-story-ui-")), file = join(temporary, "game.sqlite");
const guard = join(temporary, "loopback.mjs");
writeFileSync(guard, `const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return Promise.reject(Error('Story QA permits loopback only'));return original(input,options);};`);
const port = await new Promise((resolve,reject)=>{const s=createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,["server/index.mjs"],{cwd:root,env:{PATH:dirname(process.execPath)+":/usr/bin:/bin",PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:base,DATABASE_PATH:file,DISABLE_NATIVE_ATTESTATIONS:"1",DISABLE_BACKGROUND_WORKERS:"1",DISABLE_RELAYER:"1",NPC_TRADER_ENABLED:"0",QGOLD_KEEPER_ENABLED:"0",QGOLD_KEEPER_EXECUTE:"0",NEAR_RPC_URL:"http://127.0.0.1:9",NODE_ENV:"test",LAYER_ENABLED:"1",NODE_OPTIONS:`--import=${guard}`},stdio:["ignore","pipe","pipe"]});
let logs="";server.stdout.on("data",b=>logs+=b);server.stderr.on("data",b=>logs+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser, db, page;
const errors=[], captures=[], scans=[];
try {
  const deadline=Date.now()+30000;
  while(true){try{if((await fetch(base+"/api/health")).ok)break;}catch{}if(Date.now()>deadline)throw Error(logs.slice(-3000));await sleep(200);}
  browser=await chromium.launch({headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,reducedMotion:"reduce",serviceWorkers:"block"});
  await context.addInitScript(()=>localStorage.setItem("questlayer.playMode","demo"));
  page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base);await page.locator("#nickname").fill("Nera visitor");
  await page.getByRole("button",{name:"Start exploring",exact:true}).click();
  await page.getByRole("dialog",{name:"How to play",exact:true}).getByRole("button",{name:"Let's explore",exact:true}).click();
  const uiProperties = ["backgroundColor", "borderRadius", "boxShadow"];
  const coreHud = await page.locator(".app-shell .topbar .hud-bubble").evaluate((e,keys)=>{const style=getComputedStyle(e);return Object.fromEntries(keys.map(k=>[k,style[k]]));},uiProperties);
  await page.locator(".topbar .world-switcher").click();await page.getByRole("button",{name:/MetaLayer/}).click();
  const stage=page.locator('[data-testid="layer-stage"][data-ready=true]');await stage.waitFor({timeout:30000});
  const shot=async name=>{await page.locator(".ml-sheet img").evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))));await page.screenshot({path:join(out,name+".png")});captures.push(name+".png");};
  const axe=async name=>{
    await page.addScriptTag({content:createRequire(import.meta.url)("axe-core").source});
    const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    scans.push({name,violations});assert.deepEqual(violations,[],`accessibility ${name}`);
  };
  const metaHud = await page.locator(".layer-screen .topbar .hud-bubble").evaluate((e,keys)=>{const style=getComputedStyle(e);return Object.fromEntries(keys.map(k=>[k,style[k]]));},uiProperties);
  assert.deepEqual(metaHud,coreHud,"MetaLayer inherits the actual QuestLayer HUD appearance");
  assert.equal(await page.locator(".ml-map-tools").count(),0,"map starts folded");
  assert.equal(await page.locator(".ml-action-buttons").count(),0,"the tool action is contextual, not permanent chrome");
  assert.equal(await page.locator(".ml-palette").count(),0,"materials are not permanently over the world");
  const stick = await page.locator(".layer-screen .demo-pad").boundingBox();
  assert.ok(stick && stick.x < 100,"the canonical QuestLayer joystick is on the left");
  await shot("390-arrival");
  await page.locator(".layer-screen .daily-board-chip").click();
  await page.getByRole("heading",{name:"The Quiet Beacon",exact:true}).waitFor();
  await shot("390-story-start");await axe("story-start");
  await page.getByRole("button",{name:"Accept expedition",exact:true}).click();
  await page.keyboard.press("Escape");
  db=openDatabase(file);
  const actor=db.prepare("SELECT id FROM players WHERE name=?").get("Nera visitor");assert.ok(actor);
  // UI fixture: authenticated extraction is covered by the store campaign test.
  // Only skip its travel/mining prerequisites here; every clue, build and final
  // action below goes through the normal mounted UI and real HTTP handlers.
  db.prepare("UPDATE ml_explorers SET completed_at=?,discovered_at=?,quest_diamonds=10,diamonds=10,stone=6 WHERE player_id=?").run(Date.now(),Date.now(),actor.id);
  db.prepare("UPDATE ml_story SET quarry_at=? WHERE player_id=?").run(Date.now(),actor.id);
  async function pose(x,z){
    db.prepare("UPDATE ml_explorers SET x=?,y=15,z=?,seen_at=? WHERE player_id=?").run(x,z,Date.now(),actor.id);
    await page.waitForFunction(({x,z})=>{const p=JSON.parse(document.querySelector('[data-testid="layer-stage"]').dataset.position||"{}");return Math.abs(p.x-x)<.2&&Math.abs(p.z-z)<.2;},{x,z},{timeout:15000});
  }
  const board=async()=>{if(!await page.getByRole("dialog",{name:"Expedition board",exact:true}).isVisible())await page.locator(".layer-screen .daily-board-chip").click();};
  await pose(-28,18);await board();
  await page.getByRole("button",{name:"Star",exact:true}).click();
  await page.getByText("That symbol does not match the inscription.",{exact:true}).waitFor();
  await shot("390-signal-wrong-choice");
  const before=await stage.getAttribute("data-position");await page.keyboard.down("w");await sleep(600);await page.keyboard.up("w");
  assert.equal(await stage.getAttribute("data-position"),before,"dialog owns movement keys");
  await page.getByRole("button",{name:"Spore",exact:true}).click();
  await page.getByRole("heading",{name:"Tide Arch",exact:true}).waitFor();
  await page.keyboard.press("Escape");await pose(28,24);await board();
  await page.getByRole("button",{name:"Tide",exact:true}).click();
  await page.keyboard.press("Escape");await pose(30,-23);await board();
  await page.getByRole("button",{name:"Star",exact:true}).click();
  await page.getByRole("heading",{name:"A light for everyone",exact:true}).waitFor();
  await page.keyboard.press("Escape");await pose(18,22);
  await page.setViewportSize({width:360,height:640});await shot("360-marker-world");await board();await shot("360-marker-template");
  await page.getByRole("button",{name:"Place marker template",exact:true}).click();
  await page.getByRole("heading",{name:"Wake the quiet beacon",exact:true}).waitFor();
  await page.keyboard.press("Escape");await pose(5.5,.5);await board();
  await page.getByRole("button",{name:"Restore beacon",exact:true}).click();
  await page.getByRole("heading",{name:"The beacon is awake",exact:true}).waitFor();
  await shot("360-story-complete");await axe("story-complete");
  await page.getByRole("tab",{name:"Field journal",exact:true}).click();await shot("360-journal");
  await page.getByRole("tab",{name:"On chain",exact:true}).click();
  await page.getByText("Saved in preview",{exact:true}).first().waitFor();
  assert.equal(await page.locator(".ml-activity-list .chain-link.is-final").count(),0,"local receipts never appear final on NEAR");
  await shot("360-local-action-receipts");await axe("receipts");
  await page.keyboard.press("Escape");await page.setViewportSize({width:740,height:360});await shot("landscape-restored-square");
  const landscapeCard=await page.locator(".ml-objective-panel").boundingBox(), landscapeActions=await page.locator(".layer-screen .map-actions").boundingBox();
  assert.ok(landscapeCard.x+landscapeCard.width<=landscapeActions.x,"landscape objective and Actions do not overlap");
  await page.setViewportSize({width:1440,height:900});await shot("desktop-restored-square");
  await page.reload();await stage.waitFor({timeout:30000});await board();
  await page.getByRole("heading",{name:"The beacon is awake",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  // Controlled capability fixture for the dormant verifier form. No proof,
  // contract activation or successful chain result is invented by this fixture.
  await page.route(/\/api\/layer\/expedition\/activity\?/,async route=>{const r=await route.fetch();const body=await r.json();await route.fulfill({response:r,json:{...body,verifier:"read-only"}});});
  await board();await page.getByRole("tab",{name:"On chain",exact:true}).click();
  await page.getByLabel("World action",{exact:true}).selectOption({index:1});
  await page.getByLabel("NEAR transaction hash",{exact:true}).fill("not-a-valid-transaction");
  await page.setViewportSize({width:390,height:480});
  await page.addStyleTag({content:".ml-proof-form label {font-size:24px} .ml-proof-form input,.ml-proof-form select {font-size:24px}"});
  await page.getByLabel("NEAR transaction hash",{exact:true}).focus();await shot("390-enlarged-proof-form-keyboard-space");
  await page.getByRole("button",{name:"Verify transaction",exact:true}).click();
  await page.getByText("This transaction does not verify the selected MetaLayer action. Keep its reference and retry.",{exact:true}).waitFor();
  const visibleError = await page.locator(".ml-proof-form .ml-sheet-error").boundingBox();
  assert.ok(visibleError && visibleError.y >= 0 && visibleError.y + visibleError.height <= 480, "verification failure is visible beside the active form");
  assert.equal(await page.getByLabel("NEAR transaction hash",{exact:true}).inputValue(),"not-a-valid-transaction");
  await shot("390-proof-error-preserves-reference");
  await page.keyboard.press("Escape");
  await page.setViewportSize({width:390,height:844});
  await page.locator(".layer-screen .profile-pill").click();
  await page.locator(".layer-screen").waitFor({state:"detached"});
  await page.locator(".app-shell .main-panel .panel-close").click();
  await page.locator(".topbar .world-switcher").click();
  await page.getByRole("button",{name:/MetaLayer/}).click();
  await stage.waitFor({timeout:30000});
  await board();
  await page.getByRole("heading",{name:"The beacon is awake",exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await shot("390-return-from-platform-profile");
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"story-ui.json"),JSON.stringify({verifiedAt:new Date().toISOString(),status:"passed",checks:["story introduction","wrong clue retry","modal movement ownership","three normal HTTP signal actions","shared marker template","beacon finale","local vs NEAR receipts","reload persistence","enlarged proof form and retained input","shared HUD appearance","folded map and materials","left joystick","platform profile and world picker continuity"],fixtures:["completed extraction prerequisite and checkpoint positions","read-only verifier form capability only"],captures,scans,errors,hardware:false,liveNearTransaction:false},null,2)+"\n");
  console.log("MetaLayer story UI journey passed.");
} catch (error) {
  if (page) {
    console.error(await page.locator(".ml-sheet").innerText().catch(()=>"No active sheet"));
    await page.screenshot({path:join(out,"failed-state.png")}).catch(()=>{});
  }
  throw error;
} finally {
  db?.close();await browser?.close();server.kill("SIGTERM");
  await new Promise(r=>{if(server.exitCode!==null)r();else server.once("exit",r);});
  rmSync(temporary,{recursive:true,force:true});
}
