// Real local API + real NPC/monster UI, with synthetic position and POI fixtures.
// No public host, wallet or operator key. Run: node scripts/e2e-encounters.mjs
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const axeSource=createRequire(import.meta.url)("axe-core").source;
import {createServer as createVite} from "vite";
import react from "@vitejs/plugin-react";
import {chromium} from "playwright";
import {latLngToCell} from "h3-js";
import {BRNO,buildCzechiaFixture,pathsAround} from "../tests/fixtures/world-coverage/czechia.mjs";
import {daytimeOffset} from "./lib/e2e-clock.mjs";
import {positionAt} from "../server/actors/schedule.mjs";
import {loadQuizBank} from "../server/actors/challenges/quiz.mjs";

const ROOT=resolve(import.meta.dirname,"..");
const dir=mkdtempSync(join(tmpdir(),"questlayer-encounters-"));
const shots=resolve(process.env.E2E_SHOTS || "output/qa/weekend-2026-11-05/encounters");
mkdirSync(shots,{recursive:true});
const offset=daytimeOffset();
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const vite=await createVite({root:ROOT,configFile:false,envDir:false,cacheDir:join(dir,"vite"),plugins:[react(),{
  name:"isolated-encounter-fixture",configureServer(server){server.middlewares.use("/__encounter-test.html",(_req,res)=>{
    res.setHeader("Content-Type","text/html");
    const html='<!doctype html><html lang="en"><head><title>Encounter acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/weekend-encounter.tsx"></script></body></html>';
    server.transformIndexHtml("/__encounter-test.html",html).then(value=>res.end(value));
  });}
}],server:{host:"127.0.0.1",port:0,proxy:{"/api":`http://127.0.0.1:${port}`}}});
await vite.listen();
const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
const fixture=await buildCzechiaFixture(join(dir,"poi"));
const database=join(dir,"game.sqlite");
const child=spawn(process.execPath,["--import",join(ROOT,"scripts/lib/e2e-clock.mjs"),join(ROOT,"server/index.mjs")],{
  cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:database,
    DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",NEAR_RPC_URL:"http://127.0.0.1:9",ACTORS_ENABLED:"1",ACTORS_ALL_DAY:"1",POI_DB_PATH:fixture.dbPath,E2E_CLOCK_OFFSET_MS:String(offset)},
  stdio:["ignore","ignore","pipe"]
});
let serverErrors="";child.stderr.on("data",d=>serverErrors+=d);
let browser;
try{
  const until=Date.now()+60000;
  while(true){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}
    if(Date.now()>until)throw Error(serverErrors.slice(-1000));await new Promise(r=>setTimeout(r,100));}
  const db=new DatabaseSync(database);db.exec("PRAGMA busy_timeout=5000");
  const now=Date.now()+offset,region=latLngToCell(BRNO.lat,BRNO.lng,7);
  db.prepare("INSERT OR REPLACE INTO geo_cache VALUES(?,?,?)").run(region,JSON.stringify({version:1,paths:pathsAround(BRNO),observedAt:now,freshUntil:now+86400000,retryAt:now+86400000,attempts:0}),now+86400000);
  db.close();
  browser=await chromium.launch();
  const bank=loadQuizBank();const results=[];
  for(const kind of ["npc","monster"]){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
    const page=await context.newPage();
    page.on("pageerror",e=>console.error("Browser:",e.message));
    page.on("response",async r=>{if(r.url().includes("/api/actors/")&&!r.ok())console.error("Actor API:",r.status(),await r.text());});
    if(offset)await page.clock.setSystemTime(new Date(Date.now()+offset));
    const post=async(path,data)=>{const response=await context.request.post(url+"/api"+path,{headers:{Origin:url},data});const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;};
    const session=await post("/session",{name:`Encounter ${kind}`});
    const world=await post("/world",{arena:false,location:BRNO});
    const actors=await (await context.request.get(url+`/api/actors?worldId=${encodeURIComponent(world.id)}&lat=${BRNO.lat}&lng=${BRNO.lng}`)).json();
    const actor=actors.actors.find(a=>kind==="npc"?a.archetype==="quest_giver":a.kind==="monster"&&a.archetype==="roamer");
    assert.ok(actor,`${kind} fixture has an actor`);
    const position=positionAt(actor.segments,actors.now);assert.ok(position);
    await page.addInitScript(data=>{window.__encounterFixture=data;},{actor,playerId:session.player.id,worldId:world.id,position});
    if(kind==="npc") {
      let failed=false;
      await page.route("**/greet", route => { if(!failed) { failed=true; return route.abort("failed"); } return route.continue(); });
    }
    const greet=kind==="npc"?page.waitForResponse(r=>r.url().endsWith(`/${actor.id}/greet`)):null;
    await page.goto(url+"/__encounter-test.html");
    if(kind==="npc"){
      await page.getByRole("alert").waitFor();
      await page.screenshot({path:join(shots,"npc-failed.png")});
      await page.getByRole("button",{name:"Try again",exact:true}).click();
      const greeting=await (await greet).json();
      const offer=greeting.menu.find(o=>o.terms.errand);assert.ok(offer,"quest giver has a real errand");
      const bounds=await page.locator("dialog[open]").boundingBox();assert.ok(bounds.x<2&&bounds.y<2&&bounds.width>=389&&bounds.height>=843,"NPC owns the full screen");
      await page.addScriptTag({content:axeSource});
      const issues=await page.evaluate(async()=> (await window.axe.run()).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"NPC accessibility");
      await page.locator(".npc-chat input").fill("An unsent question for the wayfinder.");
      await page.locator("dialog[open]").click({position:{x:380,y:830}});
      assert.equal(await page.locator(".npc-chat input").isVisible(),true,"Blank screen area does not dismiss a page");
      await page.reload();
      await page.locator(".npc-chat input").waitFor();
      assert.equal(await page.locator(".npc-chat input").inputValue(),"An unsent question for the wayfinder.");
      await page.screenshot({path:join(shots,"npc-ready.png")});
      for (const [name,width,height] of [["360",360,780],["landscape",844,390],["desktop",1440,900]]) {
        await page.setViewportSize({width,height});
        assert.equal(await page.locator("dialog[open]").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        await page.screenshot({path:join(shots,`npc-${name}.png`)});
      }
      await page.setViewportSize({width:390,height:844});
      const accepted=page.waitForResponse(r=>decodeURIComponent(new URL(r.url()).pathname).endsWith(`/offers/${offer.id}/accept`));
      await page.getByRole("button",{name:new RegExp(offer.label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))}).click();
      const receipt=await (await accepted).json();assert.equal(receipt.state,"accepted");
      await page.getByRole("tab",{name:/Tasks/}).click();
      await page.screenshot({path:join(shots,"npc-accepted.png")});
      await page.setViewportSize({width:390,height:420});
      await page.locator(".npc-chat input").focus();
      await page.locator(".npc-chat input").scrollIntoViewIfNeeded();
      const inputBounds=await page.locator(".npc-chat input").boundingBox();assert.ok(inputBounds.y+inputBounds.height<=421);
      await page.screenshot({path:join(shots,"npc-keyboard-viewport.png")});
      await page.setViewportSize({width:390,height:844});
      await page.locator(".npc-sheet *").evaluateAll(elements=>elements.map(el=>[el,getComputedStyle(el).fontSize]).filter(([el])=>el.matches("input,textarea,select")||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,size])=>el.style.fontSize=`${parseFloat(size)*2}px`));
      assert.equal(await page.locator("dialog[open]").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
      await page.screenshot({path:join(shots,"npc-enlarged-text.png")});
      results.push({kind,accepted:receipt.state,draftRestored:true,keyboardViewport:true,enlargedText:true});
    }else{
      await page.locator(".actor-offers button").first().click();
      const started=page.waitForResponse(r=>r.url().endsWith(`/${actor.id}/challenge`)&&r.request().method()==="POST");
      await page.getByRole("button",{name:/Answer its riddles/}).click();
      const {challenge}=await (await started).json();assert.equal(challenge.format,"quiz");
      const submitted=page.waitForResponse(r=>r.url().endsWith(`/${challenge.id}/submit`));
      for(const question of challenge.questions){
        const original=bank.byId.get(question.id);const answer=original.choices[original.answer];
        await page.waitForTimeout(1800); // Real elapsed human play time is scored by the server.
        await page.getByRole("button",{name:answer,exact:true}).click();
      }
      const receipt=await (await submitted).json();assert.equal(receipt.result.outcome,"won");
      await page.getByRole("heading",{name:"You beat it!"}).waitFor();
      assert.equal(await page.locator(".monster-result").count(),1);
      await page.screenshot({path:join(shots,"monster-confirmed.png")});
      for (const [name,width,height] of [["360",360,780],["landscape",844,390],["desktop",1440,900]]) {
        await page.setViewportSize({width,height});
        assert.equal(await page.locator("dialog[open]").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        await page.screenshot({path:join(shots,`monster-${name}.png`)});
      }
      await page.setViewportSize({width:390,height:844});
      await page.getByRole("button",{name:"Back to the map",exact:true}).click();
      await page.getByText("Encounter closed",{exact:true}).waitFor();
      results.push({kind,outcome:receipt.result.outcome,score:receipt.result.score});
    }
    await context.close();
  }
  writeFileSync(join(shots,"report.json"),JSON.stringify({fixture:"synthetic position; real local API and UI",results},null,2));
  console.log(JSON.stringify(results));
}finally{await browser?.close();child.kill("SIGTERM");await vite.close();}
