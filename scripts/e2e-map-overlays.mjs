// Actual local App and API; disposable sessions and synthetic GPS positions.
// No project environment, production state, signing keys or native transactions.
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
import {chromium} from "playwright";
import assert from "node:assert/strict";
import {BRNO,buildCzechiaFixture,pathsAround} from "../tests/fixtures/world-coverage/czechia.mjs";
import {latLngToCell} from "h3-js";
import {positionAt} from "../server/actors/schedule.mjs";
import { openMapSettings } from "./lib/e2e-nav.mjs";

const root=resolve(import.meta.dirname,".."), dir=mkdtempSync(join(tmpdir(),"questlayer-overlays-"));
const shots=resolve(process.env.E2E_SHOTS||"output/qa/map-overlays-2026-11-06");mkdirSync(shots,{recursive:true});
const fixture=await buildCzechiaFixture(join(dir,"poi"));
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`, database=join(dir,"game.sqlite");
const server=spawn(process.execPath,[join(root,"server/index.mjs")],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:database,DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",NEAR_RPC_URL:"http://127.0.0.1:9",ACTORS_ENABLED:"1",ACTORS_ALL_DAY:"1",POI_DB_PATH:fixture.dbPath},stdio:["ignore","ignore","pipe"]});
let errors="";server.stderr.on("data",d=>errors+=d);
const axe=createRequire(import.meta.url)("axe-core").source;
const results=[];let browser;
try {
  const until=Date.now()+60000;
  while(true){try{const h=await(await fetch(url+"/api/health")).json();if(h.worldPreparation?.days?.some(d=>d.state==="ready"))break;}catch{}
    if(Date.now()>until)throw Error(errors.slice(-1200));await new Promise(r=>setTimeout(r,100));}
  const db=new DatabaseSync(database), now=Date.now();db.exec("PRAGMA busy_timeout=5000");
  db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(latLngToCell(BRNO.lat,BRNO.lng,7),JSON.stringify({version:1,paths:pathsAround(BRNO),observedAt:now,freshUntil:now+86400000,retryAt:now+86400000,attempts:0}),now+86400000);db.close();
  browser=await chromium.launch();
  for(const [name,width,height] of [["phone-360",360,780],["phone-390",390,844],["landscape",844,390],["desktop",1440,900]]){
    if(process.env.E2E_VIEWPORT&&process.env.E2E_VIEWPORT!==name)continue;
    const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});const page=await context.newPage();
    const faults=[];page.on("pageerror",e=>faults.push(e.message));
    const post=async(path,data)=>{const response=await context.request.post(url+"/api"+path,{headers:{Origin:url},data});const out=await response.json();assert.ok(response.ok(),JSON.stringify(out));return out;};
    await post("/session",{name:`Overlay ${name}`});await page.goto(url);
    await page.locator(".demo-pad").waitFor();await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
    await page.locator(".map-loading").waitFor({state:"hidden",timeout:30000});
    const controls=async()=>page.locator(".nav-rail,.demo-pad,.map-toolbar").evaluateAll(els=>els.map(el=>({name:el.className,x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
    const anchors=await controls();
    const same=async()=>assert.deepEqual(await controls(),anchors,"Sheets never move map controls");
    await page.screenshot({path:join(shots,`${name}-map.png`)});
    assert.equal(await page.getByRole("button",{name:/Show discoveries/}).count(),0);
    await page.getByRole("button",{name:"Map tools",exact:true}).click();
    const toolBounds=await page.locator(".map-toolbar > button:visible").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute("aria-label"),x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    assert.ok(toolBounds.every(r=>r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height),"Every expanded map tool stays inside the viewport");
    await page.screenshot({path:join(shots,`${name}-map-tools.png`)});
    await page.getByRole("button",{name:"Nearby discoveries",exact:true}).click();
    const dialog=page.locator("dialog[open]");await dialog.waitFor();await same();
    assert.equal(await page.locator(".map-stage").getAttribute("aria-hidden"),"false","Map remains visible behind detail");
    const bounds=await dialog.boundingBox();assert.ok(bounds.width<width&&bounds.height<height,"Details use bounded overlays");
    if(width>1000)assert.ok(bounds.width<=642&&bounds.height<=height*.85,"Desktop detail leaves map context");
    if(width===390) {
      await page.addScriptTag({content:axe});
      const issues=await page.evaluate(async()=> (await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"Discovery list accessibility");
    }
    await page.screenshot({path:join(shots,`${name}-discoveries.png`)});
    await page.goBack();await dialog.waitFor({state:"hidden"});await same();
    await page.getByRole("button",{name:"Map tools",exact:true}).click();
    await page.getByRole("button",{name:"Nearby discoveries",exact:true}).click();
    await page.locator(".zone-card").first().click();await page.locator(".quest-detail, .locked-panel").first().waitFor();
    await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const close=page.getByRole("button",{name:"Close panel",exact:true});const cb=await close.boundingBox();
    assert.ok(cb&&cb.y>=0&&cb.y+cb.height<=height,"Close remains visible after scrolling");
    await same();
    if(width===390) {
      const issues=await page.evaluate(async()=> (await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"Discovery detail accessibility");
    }
    await page.screenshot({path:join(shots,`${name}-detail.png`)});
    await close.click();await dialog.waitFor({state:"hidden"});await same();
    {
      await page.getByRole("button",{name:"Map tools",exact:true}).click();
      await page.getByRole("button",{name:"Nearby discoveries",exact:true}).click();
      await dialog.getByRole("button",{name:/Place requires Tier/}).first().click();
      await page.locator(".locked-panel").waitFor();
      const short=await dialog.boundingBox();if(width>1000)assert.ok(short.height<height*.75,"Short content uses its natural height");
      await page.addScriptTag({content:axe});
      const issues=await page.evaluate(async()=> (await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"Locked requirements remain readable");
      await page.screenshot({path:join(shots,`${name}-locked.png`)});
      if(width>1000)await page.screenshot({path:join(shots,"desktop-short-detail.png")});
      await close.click();await dialog.waitFor({state:"hidden"});await same();
    }
    const hide=page.getByRole("button",{name:"Hide objective",exact:true});if(await hide.isVisible())await hide.click();await same();
    await page.addScriptTag({content:axe});
    const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]}})).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[]);assert.deepEqual(faults,[]);results.push({name,anchors,bounds,violations});console.log(`${name}: overlay and fixed controls passed`);await context.close();
  }
  // A separate explorer stands at a real generated actor. The browser GPS is synthetic.
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  const post=async(path,data)=>{const r=await context.request.post(url+"/api"+path,{headers:{Origin:url},data});assert.ok(r.ok(),await r.text());return r.json();};
  await post("/session",{name:"Nearby actor"});const world=await post("/world",{arena:false,location:{lat:49.74745,lng:13.3774}});
  const response=await(await context.request.get(url+`/api/actors?worldId=${encodeURIComponent(world.id)}&lat=49.74745&lng=13.3774`)).json();
  const candidates=response.actors.filter(a=>a.kind==="npc"&&a.archetype==="quest_giver").map(actor=>({actor,position:positionAt(actor.segments,response.now)})).filter(a=>a.position).sort((a,b)=>Number(b.position.dwell)-Number(a.position.dwell));
  assert.ok(candidates.length,"The reviewed city has a nearby NPC");const chosen=candidates[0];
  const atActor=await post("/world",{arena:false,location:chosen.position});assert.equal(atActor.id,world.id,"Synthetic GPS stays in the same world");
  const network=[];const page=await context.newPage();
  page.on("response",async r=>{if(r.url().includes("/api/actors?")||r.url().endsWith("/api/world")){try{network.push({url:r.url(),status:r.status(),data:await r.json()});}catch{}}});
  await page.addInitScript(p=>{
    const fix=()=>({coords:{latitude:p.lat,longitude:p.lng,accuracy:5,heading:null,speed:0},timestamp:Date.now()});
    navigator.geolocation.getCurrentPosition=success=>success(fix());
    navigator.geolocation.watchPosition=success=>{success(fix());return setInterval(()=>success(fix()),1000);};
    navigator.geolocation.clearWatch=timer=>clearInterval(timer);
  },chosen.position);
  await page.goto(url);await (await openMapSettings(page)).getByRole("button",{name:"Use GPS, my location",exact:true}).click();
  const cue=page.locator(".nearby-open");
  await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
  // First equipment/recovery prompts may own the objective; dismissing one is an explicit player choice.
  const hide=page.getByRole("button",{name:"Hide objective",exact:true});
  if(await hide.isVisible())await hide.click();
  try { await cue.waitFor({timeout:30000}); }
  catch(error) {
    await page.screenshot({path:join(shots,"nearby-unavailable.png")});
    writeFileSync(join(shots,"nearby-diagnostic.json"),JSON.stringify({actor:chosen.actor.name,position:chosen.position,world:world.id,network,status:await page.locator(".map-status-chip").innerText(),objective:await page.locator(".main-panel").textContent()},null,2));
    throw error;
  }
  await page.waitForTimeout(4200);assert.ok(await cue.isVisible(),"A stationary nearby cue stays available");
  await page.screenshot({path:join(shots,"phone-390-nearby.png")});
  await page.addScriptTag({content:axe});
  const cueIssues=await page.evaluate(async()=> (await window.axe.run()).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(cueIssues,[],"Nearby action remains readable and accessible");
  await cue.click();await page.locator(".npc-continue").waitFor({timeout:30000}).catch(async error=>{
    await page.screenshot({path:join(shots,"nearby-encounter-diagnostic.png")});
    console.error("Encounter state:",await page.locator("dialog[open]").allTextContents());throw error;
  });
  await page.screenshot({path:join(shots,"phone-390-nearby-open.png")});
  const text=await page.locator("dialog[open]").innerText();
  await page.keyboard.press("Escape");await page.locator("dialog[open]").waitFor({state:"hidden"});
  assert.ok(await page.evaluate(()=>document.activeElement?.checkVisibility()),"Focus returns to the visible map");
  await cue.click();await page.locator(".npc-continue").waitFor();
  await page.locator(".npc-continue").click();
  await page.locator(".npc-choice").first().click();
  const accepted=page.waitForResponse(r=>r.url().includes("/offers/")&&r.url().endsWith("/accept"));
  const refreshed=page.waitForResponse(r=>r.url().endsWith("/greet"));
  await page.getByRole("button",{name:"Start quest",exact:true}).click();
  const receipt=await(await accepted).json();assert.equal(receipt.state,"accepted");
  const active=(await(await refreshed).json()).active.find(line=>line.offerId===receipt.offerId);
  const next=active?.steps.find(step=>!step.done);assert.ok(next,"The server confirmed an unfinished NPC step");
  await page.getByRole("button",{name:"Back to map",exact:true}).waitFor();
  await page.locator(".npc-continue").click();
  await page.locator("dialog[open]").waitFor({state:"hidden"});
  await page.waitForFunction(id=>!!document.getElementById("quest-"+id),next.questId);
  assert.ok(await page.locator(".compact-selection:visible, .nearby-open:visible").count(),"An accepted NPC quest has a visible map objective");
  await page.screenshot({path:join(shots,"phone-390-npc-objective.png")});
  await page.locator(".npc-more").waitFor({state:"detached"});
  results.push({name:"nearby",text,cueIssues,escape:true,acceptedNpcTarget:next.questId});await context.close();
  writeFileSync(join(shots,"report.json"),JSON.stringify({provenance:"Actual local App/API, disposable data and synthetic GPS",results},null,2));console.log(JSON.stringify(results));
} finally {await browser?.close();server.kill("SIGTERM");}
