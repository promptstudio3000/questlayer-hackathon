// Real React encounter surfaces; deterministic browser-only API fixtures.
// This verifies the teaching/request boundary. Real API acceptance is e2e-encounters.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createServer as createVite } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "questlayer-examples-"));
const lang = process.env.E2E_LANG || "en";
const dict = lang === "en" ? {} : JSON.parse(readFileSync(join(root,"src/i18n",lang+".json"),"utf8"));
const t = (key, values = {}) => Object.entries(values).reduce((text,[key,value]) => text.replaceAll(`{${key}}`,value),dict[key] || key);
const shots = resolve(process.env.E2E_SHOTS || "output/qa/compact-guidance-2026-11-08/encounters");
mkdirSync(shots,{recursive:true});
const axe = createRequire(import.meta.url)("axe-core").source;
const vite = await createVite({root,configFile:false,envDir:false,cacheDir:join(dir,"vite"),plugins:[react(),{
  name:"local-example-fixture",configureServer(server){server.middlewares.use("/__learning.html",(_req,res)=>{
    res.setHeader("Content-Type","text/html");
    server.transformIndexHtml("/__learning.html",'<!doctype html><html lang="en"><head><title>Challenge learning</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/challenge-learning.tsx"></script></body></html>').then(html=>res.end(html));
  });}
}],server:{host:"127.0.0.1",port:0}});
await vite.listen();
const url = `http://127.0.0.1:${vite.httpServer.address().port}/__learning.html?lang=${lang}`;
const formats = ["quiz","rhythm","trace","memory","duel"];
const report = {lang,browser:process.env.E2E_BROWSER || "chromium",provenance:"Actual UI with synthetic browser responses; no real attempt, wallet or physical device",formats:[],viewports:[]};
let browser;
function challenge(format) {
  const base={id:"confirmed-attempt",actorId:"example",expiresAt:Date.now()+60000,seedCommitment:"fixed"};
  if(format==="quiz")return {...base,format,questions:[{id:"q",prompt:"A real attempt",choices:["A","B"]}],secondsPerQuestion:20,pass:1};
  if(format==="rhythm")return {...base,format,beats:[2000,3000],beatMs:1000,durationMs:5000};
  if(format==="trace")return {...base,format,points:[[.2,.5],[.5,.3],[.8,.5]],radius:.08,durationMs:20000};
  if(format==="memory")return {...base,format,pads:4,sequence:[0,2,1],showMs:700,showEndsMs:2800};
  return {...base,format,tendency:"guard",monsterHp:10,playerHp:10,power:1,level:1,rounds:3,ringMs:2000,commitment:"fixed"};
}
async function setup({novice=true,boss=false,width=390,height=844}={}) {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<=600,isMobile:width<=600,reducedMotion:"reduce",serviceWorkers:"block"});
  await context.addInitScript(data=>{window.__challengeFixture=data;},{novice,boss});
  const page=await context.newPage();const calls=[];
  await page.route("**/api/**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==="POST")calls.push({path,body:request.postDataJSON()});
    let body;
    const event={id:"week",weekId:"2026-W45",hp:900,maxHp:1200,state:"active",participants:2,hitsForEdition:3,leaderboard:[]};
    if(path==="/api/hunt")body={boss:event,shards:{},shardTotal:0,shardsToday:0,dailyShardCap:12,rollTickets:0,guardianWins:0,craft:{edition:"wardbreaker",shards:10,ready:false,needs:["shards"]}};
    else if(path.endsWith("/boss"))body={event,hit:challenge("quiz")};
    else if(request.method()==="GET")body={actorId:"example",status:{state:"active"},formats,level:1};
    else if(path.endsWith("/challenge"))body={challenge:challenge(request.postDataJSON().format)};
    else body={};
    await route.fulfill({json:body});
  });
  await page.goto(url);await page.getByRole("button",{name:t("Open"),exact:true}).click();
  await page.locator(boss?".boss-pool":".monster-formats").waitFor();
  return {page,context,calls};
}
async function capture(page,name) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"No horizontal overflow");
  await page.locator(".monster-portrait img").waitFor();
  await page.locator(".monster-portrait img").evaluate(img=>img.decode());
  await page.screenshot({path:join(shots,name+".png")});
}
try {
  browser=await(process.env.E2E_BROWSER==="webkit"?webkit:chromium).launch();
  for(const format of formats) {
    const {page,context,calls}=await setup();
    const trigger=page.locator(`[data-challenge-format="${format}"]:not(.format-help)`);
    await trigger.click();await page.locator(".challenge-example").waitFor();
    assert.equal(calls.length,0,"Opening first-time explanation does not start an attempt");
    await page.getByRole("button",{name:t("Play example"),exact:true}).click();
    if(format==="quiz") await page.locator(".challenge-example").getByRole("button",{name:t("Aura"),exact:true}).press("Enter");
    if(format==="rhythm") {const tap=page.locator(".challenge-example .monster-pad");await tap.press("Space");assert.match(await tap.innerText(),/1/);await tap.tap();assert.match(await tap.innerText(),/2/);await page.getByText(t("Example finished. No reward or attempt was used."),{exact:true}).waitFor();}
    if(format==="trace") {const board=page.locator(".challenge-example .trace-board");await board.press("Space");await board.press("ArrowRight");await board.press("Space");await page.getByText(t("Example finished. No reward or attempt was used."),{exact:true}).waitFor();}
    if(format==="memory") {await page.waitForFunction(()=>!document.querySelector(".memory-pad")?.disabled);for(const number of[1,3,2])await page.locator(".challenge-example").getByRole("button",{name:t("Rune {0}",{0:number}),exact:true}).press("Enter");}
    if(format==="duel") {await page.locator(".challenge-example").getByRole("button",{name:t("Trick"),exact:true}).press("Enter");assert.equal(await page.locator(".duel-stances [aria-pressed=true]").count(),1);}
    let touch = format === "rhythm";
    if (["quiz","memory","trace"].includes(format)) {
      await page.locator(".challenge-example").getByRole("button",{name:t("Try again"),exact:true}).click();
      if(format==="quiz") {await page.locator(".challenge-example").getByRole("button",{name:t("Aura"),exact:true}).tap();touch=true;}
      if(format==="memory") {await page.waitForFunction(()=>!document.querySelector(".memory-pad")?.disabled);for(const number of[1,3,2])await page.locator(".challenge-example").getByRole("button",{name:t("Rune {0}",{0:number}),exact:true}).tap();touch=true;}
      if(format==="trace" && process.env.E2E_BROWSER!=="webkit") {
        const box=await page.locator(".trace-board").boundingBox(),cdp=await context.newCDPSession(page);
        const point=(x,y)=>({x:box.x+x*box.width,y:box.y+y*box.height});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point(.2,.5)]});
        for(const [x,y] of [[.35,.4],[.5,.3],[.65,.4],[.8,.5]])await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[point(x,y)]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await cdp.detach();touch=true;
      }
    }
    if(format==="duel") {await page.locator(".challenge-example").getByRole("button",{name:t("Guard"),exact:true}).tap();touch=true;}
    assert.equal(calls.length,0,"Example controls never post an input, reward, encounter or attempt");
    await capture(page,`example-${format}-${lang}`);
    if(format==="quiz") {
      await page.getByRole("button",{name:t("Back"),exact:true}).click();
      await page.waitForFunction(()=>document.activeElement?.getAttribute("data-challenge-format")==="quiz" && !document.activeElement.classList.contains("format-help"));
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,"Back returns focus to the format");
      await trigger.click();
    } else await page.getByRole("button",{name:t("Start challenge"),exact:true}).click();
    await page.locator(".challenge-example").waitFor({state:"hidden"});
    await page.locator(`.monster-${format}`).last().waitFor();
    assert.equal(calls.length,1,"Only the explicit real start creates an attempt; acknowledged format bypasses teaching");
    assert.equal(calls[0].body.format,format);
    assert.equal(await page.locator(".challenge-example").count(),0,"No automatic help during a running challenge");
    report.formats.push({format,examplePosts:0,explicitStartPosts:1,keyboard:true,touch});
    await context.close();
  }
  const veteran=await setup({novice:false});
  await veteran.page.locator('[data-challenge-format="memory"]:not(.format-help)').click();
  await veteran.page.locator(".monster-memory").waitFor();assert.equal(veteran.calls.length,1);assert.equal(await veteran.page.locator(".challenge-example").count(),0);await veteran.context.close();
  for(const[name,width,height]of[["phone-360",360,780],["phone-390",390,844],["landscape",844,390],["desktop",1440,900]]) {
    const {page,context,calls}=await setup({width,height,novice:false});
    await page.locator('[data-challenge-format="rhythm"].format-help').click();
    await page.locator(".challenge-example").waitFor();await capture(page,`${name}-before-start-${lang}`);
    if(width===390){
      await page.addScriptTag({content:axe});
      const issues=await page.evaluate(async()=>(await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"Pre-start accessibility");
      await page.locator(".challenge-example *").evaluateAll(nodes=>nodes.map(el=>[el,getComputedStyle(el).fontSize]).filter(([el])=>[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,size])=>el.style.setProperty("font-size",`${parseFloat(size)*2}px`,"important")));
      await capture(page,`${name}-enlarged-example-${lang}`);
    }
    assert.equal(calls.length,0);report.viewports.push({name,manualHelp:true,posts:0});await context.close();
  }
  const boss=await setup({boss:true});
  await boss.page.locator(".activity-help > summary").click();
  await boss.page.locator(".example-format-label select").selectOption("duel");
  await boss.page.getByRole("button",{name:t("Play example"),exact:true}).click();
  await boss.page.getByRole("button",{name:t("Trick"),exact:true}).click();
  assert.equal(boss.calls.length,0,"Boss teaching and examples never send a strike");
  await capture(boss.page,`boss-help-${lang}`);
  await boss.page.locator(".activity-help > .text-button").click();
  await boss.page.getByRole("button",{name:t("Strike the boss"),exact:true}).click();
  await boss.page.locator(".monster-quiz").waitFor();assert.equal(boss.calls.length,1);assert.equal(await boss.page.locator(".activity-help").count(),0);await boss.context.close();
  report.boss={examplePosts:0,explicitStrikePosts:1};
}catch(error){for(const context of browser?.contexts()||[])for(const page of context.pages()){console.error((await page.locator("body").innerText()).slice(-4000));await capture(page,"failure").catch(()=>{});}throw error;}
finally{await browser?.close();await vite.close();writeFileSync(join(shots,`examples-verification-${lang}.json`),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
