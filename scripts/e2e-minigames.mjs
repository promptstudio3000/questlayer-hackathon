// Real controls, deterministic clocks and server scorers. Duel transport is a
// fixture: the separate encounters journey proves real API quiz settlement.
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {chromium} from "playwright";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import assert from "node:assert/strict";
import {createTrace,scoreTrace,createRhythm,scoreRhythm,createMemory,scoreMemory} from "../server/actors/challenges/minigames.mjs";
const root=resolve(import.meta.dirname,"..");
const dir=mkdtempSync(join(tmpdir(),"questlayer-input-"));
const shots=resolve(process.env.E2E_SHOTS || "output/qa/weekend-2026-11-05/minigames");mkdirSync(shots,{recursive:true});
const server=await createServer({root,configFile:false,envDir:false,cacheDir:dir,plugins:[react(),{name:"input-fixture",configureServer(vite){vite.middlewares.use("/__input.html",(_req,res)=>{
 const html='<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Input acceptance</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/weekend-minigame.tsx"></script></body></html>';
 res.setHeader("Content-Type","text/html");vite.transformIndexHtml("/__input.html",html).then(x=>res.end(x));
});}}],server:{host:"127.0.0.1",port:0}});await server.listen();
const url=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch();const results=[];
try{
for(const input of ["keyboard","touch"])for(const format of ["quiz","memory","rhythm","trace","duel"]){
 console.log(`${format}: ${input}`);
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:"reduce"});const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+100));
 const fields=format==="trace"?createTrace("corner"):format==="rhythm"?createRhythm("input"):format==="memory"?createMemory("input"):
 format==="quiz"?{questions:[{id:"one",prompt:"Choose the rune",choices:["Rune","Stone"]}],secondsPerQuestion:20,pass:1}:
 {tendency:"strike",monsterHp:100,playerHp:100,power:10,level:1,rounds:3,ringMs:1000};
 const challenge={...fields,id:"input-fixture",actorId:"fixture",format,expiresAt:Date.now()+600000,seedCommitment:"fixture"};
 await page.addInitScript(c=>{window.__gameFixture=c;},challenge);
 const rounds=[];
 if(format==="duel")await page.route("**/api/actors/fixture/challenge/input-fixture/round",async route=>{
  rounds.push(route.request().postDataJSON());const round=rounds.length;
  await route.fulfill({json:{duel:{round,playerHp:100,monsterHp:100-round*25,ringMs:1000,last:{stance:rounds.at(-1).stance,monster:"guard",outcome:"win",skill:1,dealt:25,taken:0}},...(round===3?{result:{challengeId:challenge.id,outcome:"won",score:3,max:3,format},detail:{}}:{})}});
 });
 await page.goto(url+"/__input.html");await page.getByRole("dialog").waitFor();
 if (input==="keyboard") {
  for(const [name,width,height] of [["360",360,780],["390",390,844],["landscape",844,390],["desktop",1440,900]]){
   await page.setViewportSize({width,height});
   assert.equal(await page.locator("dialog[open]").evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
   await page.screenshot({path:join(shots,`${format}-ready-${name}.png`)});
  }await page.setViewportSize({width:390,height:844});
 }
 const press=async button=>{if(input==="keyboard"){await button.focus();await page.keyboard.press("Enter");}else await button.tap({force:true});};
 if(format==="quiz"){await page.clock.runFor(1800);await press(page.getByRole("button",{name:"Rune",exact:true}));}
 if(format==="memory"){
  await page.clock.runFor(challenge.showEndsMs+100);await page.waitForTimeout(100);
  assert.equal(await page.locator(".memory-pad").first().isEnabled(),true,"memory input opens after the cue");
  for(const pad of challenge.sequence){await press(page.getByRole("button",{name:`Rune ${pad+1}`,exact:true}));await page.clock.runFor(200);}
 }
 if(format==="rhythm"){
  let at=0;for(const beat of challenge.beats){await page.clock.runFor(beat-at);at=beat;await press(page.locator(".monster-pad"));}
  await page.clock.runFor(challenge.durationMs-at+400);
 }
 if(format==="trace"){
  const board=page.locator(".trace-board");await board.waitFor();
  if(input==="keyboard"){
   await board.focus();await page.keyboard.press("Space");let cursor=[...challenge.points[0]];
   for(const target of challenge.points.slice(1)){let guard=0;
    while(Math.hypot(target[0]-cursor[0],target[1]-cursor[1])>0.018){assert.ok(++guard<300);const dx=target[0]-cursor[0],dy=target[1]-cursor[1];
     const key=Math.abs(dx)>Math.abs(dy)?dx>0?"ArrowRight":"ArrowLeft":dy>0?"ArrowDown":"ArrowUp";
     await page.clock.runFor(35);await page.keyboard.press(key);
     if(key==="ArrowRight")cursor[0]+=0.025;if(key==="ArrowLeft")cursor[0]-=0.025;if(key==="ArrowDown")cursor[1]+=0.025;if(key==="ArrowUp")cursor[1]-=0.025;
    }
   }await page.keyboard.press("Space");
  }else{
   const box=await board.boundingBox();const cdp=await context.newCDPSession(page);
   const send=async(type,p)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:p?[{x:box.x+p[0]*box.width,y:box.y+p[1]*box.height}]:[]});
   await send("touchStart",challenge.points[0]);
   for(let i=1;i<challenge.points.length;i++)for(let k=1;k<=20;k++){
    const a=challenge.points[i-1],b=challenge.points[i];await page.clock.runFor(35);await send("touchMove",[a[0]+(b[0]-a[0])*k/20,a[1]+(b[1]-a[1])*k/20]);
   }await send("touchEnd");
  }
 }
 if(format==="duel"){
  for(const stance of ["Strike","Guard","Trick"]){await page.clock.runFor(1000);await press(page.getByRole("button",{name:stance,exact:true}));await page.waitForTimeout(20);}
  await page.clock.runFor(50);assert.ok(await page.evaluate(()=>window.__gameResult),"duel delivered result");assert.equal(rounds.length,3);assert.deepEqual(rounds.map(r=>r.stance),["strike","guard","trick"]);
 }else{
  await page.clock.runFor(50);const moves=await page.evaluate(()=>window.__gameInput);
  assert.ok(moves,`${format} ${input}: input submitted`);
  const verdict=format==="trace"?scoreTrace(challenge,moves):format==="rhythm"?scoreRhythm(challenge,moves):format==="memory"?scoreMemory(challenge,moves):{won:moves.answers[0].choice===0};
  assert.equal(verdict.won,true,`${format} ${input}: ${JSON.stringify(verdict)}`);
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:join(shots,`${format}-${input}.png`)});results.push({format,input,passed:true});await context.close();
}
writeFileSync(join(shots,"report.json"),JSON.stringify({provenance:"Real browser controls; deterministic clock; actual server scorers; duel response fixture",results},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await server.close();}
