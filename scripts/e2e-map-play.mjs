// Actual App/API and MapLibre. Test-only Vite instrumentation observes camera/marker state.
// Disposable explorers, synthetic GPS, no keys, network chain actions or financial changes.
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {createRequire} from "node:module";
import assert from "node:assert/strict";
import {createServer as createVite} from "vite";
import react from "@vitejs/plugin-react";
import {chromium,webkit} from "playwright";
import {daytimeOffset} from "./lib/e2e-clock.mjs";
import {metersBetween,headingTo,stepFrom} from "../src/map-motion.ts";
import {containsPoint} from "../server/poi/geo.mjs";

const root=resolve(import.meta.dirname,".."),dir=mkdtempSync(join(tmpdir(),"questlayer-map-play-"));
const before=process.env.E2E_PHASE==="before",engine=process.env.E2E_BROWSER==="webkit"?webkit:chromium;
const shots=resolve(process.env.E2E_SHOTS||"output/qa/map-play-2026-11-07");mkdirSync(shots,{recursive:true});
const offset=daytimeOffset(),home={lat:49.74745,lng:13.3774};
const axe=createRequire(import.meta.url)("axe-core").source;
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const vite=await createVite({root,configFile:false,envDir:false,cacheDir:join(root,"node_modules/.vite-map-play"),plugins:[{
 name:"observe-map-in-test-only",enforce:"pre",transform(code,id){
  if(!id.endsWith("/src/GameMap.tsx"))return;
  return code.replace("export function GameMap(props: GameMapProps) {","export function GameMap(props: GameMapProps) { window.__testPosition=props.position;")
   .replace("map.current = m;",`map.current = m; window.__testMap=m; window.__cameraCalls=[]; const originalEase=m.easeTo.bind(m); m.easeTo=(options,...rest)=>{window.__cameraCalls.push({duration:options.duration,bearing:options.bearing});return originalEase(options,...rest);};`)
   .replace(/avatar\.current = new maplibregl\.Marker\([\s\S]*?\.addTo\(m\);/,"$&\nwindow.__testAvatar=avatar.current;");
 }
},react()],server:{host:"127.0.0.1",port:0,proxy:{"/api":`http://127.0.0.1:${port}`}}});
await vite.listen();const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
const child=spawn(process.execPath,["--import",join(root,"scripts/lib/e2e-clock.mjs"),join(root,"server/index.mjs")],{cwd:dir,env:{PATH:process.env.PATH,HOST:"127.0.0.1",PORT:String(port),APP_ORIGIN:url,DATABASE_PATH:join(dir,"game.sqlite"),DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",NEAR_RPC_URL:"http://127.0.0.1:9",E2E_CLOCK_OFFSET_MS:String(offset)},stdio:["ignore","ignore","pipe"]});
let stderr="",browser;child.stderr.on("data",d=>stderr+=d);
const report={phase:before?"before":"after",engine:engine.name(),provenance:"Actual App/API and MapLibre; test-only camera observation; synthetic GPS",checks:[]};
const angle=(a,b)=>Math.abs(((a-b+540)%360)-180);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function context(motion="reduce",point=home){
 const c=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:motion,serviceWorkers:"block"});
 await c.addInitScript(({offset,point})=>{
  const D=Date;window.Date=class extends D{constructor(...a){super(...(a.length?a:[D.now()+offset]));}static now(){return D.now()+offset;}};
  let p=point,course=null,speed=0,accuracy=5;
  const fix=()=>({coords:{latitude:p.lat,longitude:p.lng,accuracy,heading:course,speed},timestamp:Date.now()});
  navigator.geolocation.getCurrentPosition=ok=>ok(fix());
  navigator.geolocation.watchPosition=ok=>{ok(fix());return setInterval(()=>ok(fix()),200);};
  navigator.geolocation.clearWatch=id=>clearInterval(id);
  window.__gps=(next,h=null,s=0,a=5)=>{p=next;course=h;speed=s;accuracy=a;};
 },{offset,point});return c;
}
async function api(c,path,data){const r=await c.request.fetch(url+"/api"+path,{method:data===undefined?"GET":"POST",headers:{Origin:url},...(data===undefined?{}:{data}),maxRetries:1});return {status:r.status(),data:await r.json()};}
async function ready(page){await page.goto(url);await page.getByRole("button",{name:"Inventory",exact:true}).waitFor({timeout:60000});await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});await page.waitForFunction(()=>window.__testMap?.isStyleLoaded()&&window.__testAvatar,{timeout:60000});}
async function dismissPickup(page){if(await page.locator(".wearable-moment").isVisible())await page.locator(".wearable-moment").getByRole("button",{name:"Continue",exact:true}).click();}
async function pose(page){return page.evaluate(()=>({bearing:window.__testMap.getBearing(),position:[window.__testPosition.lng,window.__testPosition.lat],marker:window.__testAvatar.getLngLat().toArray(),keyboard:window.__testMap.keyboard.isEnabled(),moving:window.__testMap.isMoving()}));}
const point=p=>({lng:p[0],lat:p[1]});
async function keyHold(page,key,ms){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);await page.waitForFunction(()=>!window.__testMap.isMoving(),null,{timeout:15000});}
async function selectRoute(page,zone,q){
 await dismissPickup(page);await page.getByRole("button",{name:"Map tools",exact:true}).click();await page.getByRole("button",{name:"Nearby discoveries",exact:true}).click();
 await page.locator(".zone-card").filter({hasText:zone.name}).first().click();
 if(!await page.locator(".quest-detail").getByRole("heading",{name:q.title,exact:true}).count()){
  await page.locator(`.activity-row[data-quest-id="${q.id}"]`).click();
 }
 await page.locator(".quest-detail").getByRole("heading",{name:q.title,exact:true}).waitFor();
}
async function travel(page,from,to){
 const distance=metersBetween(from,to),heading=headingTo(from,to),steps=Math.max(1,Math.ceil(distance/1.6));
 for(let i=1;i<=steps;i++){const p={lat:from.lat+(to.lat-from.lat)*i/steps,lng:from.lng+(to.lng-from.lng)*i/steps};await page.evaluate(({p,h})=>window.__gps(p,h,8),{p,h:heading});await pause(200);}
 await page.evaluate(p=>window.__gps(p,null,0),to);await pause(250);
 if(heading!==null)await page.waitForFunction(h=>Math.abs(((window.__testMap.getBearing()-h+540)%360)-180)<2,heading,{timeout:10000});
}
try{
 const until=Date.now()+60000;while(true){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{}if(Date.now()>until)throw Error(stderr.slice(-1000));await pause(100);}
 browser=await engine.launch();
 const c=await context("no-preference");await api(c,"/session",{name:"Map keyboard explorer"});await api(c,"/world",{arena:true,location:home});
 const p=await c.newPage();p.setDefaultTimeout(30000);await ready(p);await dismissPickup(p);
 await p.locator(".maplibregl-canvas").focus();const initial=await pose(p);
 if(before)await keyHold(p,"w",650);
 else{
  await p.keyboard.down("w");
  await p.waitForFunction(start=>{const q=window.__testAvatar.getLngLat();return Math.hypot((q.lng-start[0])*Math.cos(q.lat*Math.PI/180),q.lat-start[1])*111320>4;},initial.position,{timeout:10000});
  await p.keyboard.up("w");await p.waitForFunction(()=>!window.__testMap.isMoving(),null,{timeout:15000});
 }
 const walked=await pose(p);
 report.checks.push({name:"focused-map-W",distanceM:metersBetween(point(initial.position),point(walked.position)),bearing:walked.bearing});
 if(!before&&metersBetween(point(initial.position),point(walked.position))<=4){await p.screenshot({path:join(shots,"keyboard-diagnostic.png")});console.error("Keyboard state",JSON.stringify({initial,walked,held:await p.locator(".demo-pad").innerText(),dialog:await p.locator("dialog[open]").allTextContents(),focus:await p.evaluate(()=>document.activeElement?.outerHTML.slice(0,200))}));}
 if(!before){assert.ok(metersBetween(point(initial.position),point(walked.position))>4);assert.ok(angle(walked.bearing,166)<1);assert.equal(walked.keyboard,true);}
 if(before)await keyHold(p,"ArrowRight",400);
 else{await p.keyboard.down("ArrowRight");await p.waitForFunction(b=>Math.abs(((window.__testMap.getBearing()-b+540)%360)-180)>30,walked.bearing,{timeout:10000});await p.keyboard.up("ArrowRight");await p.waitForFunction(()=>!window.__testMap.isMoving(),null,{timeout:15000});}
 const turned=await pose(p);
 if(!before){assert.ok(angle(turned.bearing,walked.bearing)>30);assert.ok(metersBetween(point(walked.position),point(turned.position))<.1);}
 if(!before){
  await p.keyboard.down("w");await p.keyboard.down("ArrowUp");await pause(220);await p.keyboard.up("w");assert.equal(await p.locator(".demo-forward").getAttribute("aria-pressed"),"true");await p.keyboard.up("ArrowUp");
  await p.keyboard.down("w");await p.locator(".demo-forward").hover();await p.mouse.down();await pause(150);await p.mouse.up();assert.equal(await p.locator(".demo-forward").getAttribute("aria-pressed"),"true");await p.keyboard.up("w");
  await p.keyboard.down("w");await p.locator(".daily-board-chip").click();await p.locator("dialog[open]").waitFor();await p.waitForFunction(()=>document.querySelector(".demo-forward")?.getAttribute("aria-pressed")==="false");
  const stopped=await pose(p);await p.keyboard.press("Escape");await p.keyboard.down("w");await pause(250);assert.equal(await p.locator(".demo-forward").getAttribute("aria-pressed"),"false");await p.keyboard.up("w");assert.ok(metersBetween(point(stopped.position),point((await pose(p)).position))<.2);
  await p.getByRole("button",{name:"Community",exact:true}).click();await p.getByRole("tab",{name:"Local chat",exact:true}).click();await p.getByRole("button",{name:"Write a note",exact:true}).click();await p.locator("#map-note-text").fill("WASD stays in this draft.");await p.locator("#map-note-text").press("ArrowLeft");assert.equal(await p.locator("#map-note-text").inputValue(),"WASD stays in this draft.");await p.keyboard.press("Escape");
  const close=p.getByRole("button",{name:"Close panel",exact:true});if(await close.isVisible())await close.click();
  await p.locator(".maplibregl-canvas").focus();const restart=await pose(p);await p.keyboard.down("ArrowUp");
  await p.waitForFunction(start=>{const q=window.__testAvatar.getLngLat();return Math.hypot((q.lng-start[0])*Math.cos(q.lat*Math.PI/180),q.lat-start[1])*111320>2;},restart.position,{timeout:10000});
  await p.keyboard.up("ArrowUp");await p.waitForFunction(()=>!window.__testMap.isMoving(),null,{timeout:15000});const resumed=await pose(p);assert.ok(metersBetween(point(stopped.position),point(resumed.position))>2);
  report.checks.push({name:"aliases-pointer-modal-draft-and-resume",passed:true});
  await p.locator(".maplibregl-canvas").focus();const zoom=await p.evaluate(()=>window.__testMap.getZoom());await p.keyboard.press("=");
  await p.waitForFunction(z=>window.__testMap.getZoom()>z+.4&&!window.__testMap.isMoving(),zoom,{timeout:15000});
  await p.keyboard.press("-");await p.waitForFunction(z=>Math.abs(window.__testMap.getZoom()-z)<.1&&!window.__testMap.isMoving(),zoom,{timeout:15000});
  report.checks.push({name:"native-keyboard-zoom-retained",passed:true});
  await p.getByRole("button",{name:"Map tools",exact:true}).click();await p.getByRole("button",{name:"City overview",exact:true}).click();
  await p.waitForFunction(()=>Math.abs(window.__testMap.getPitch()-35)<1&&!window.__testMap.isMoving(),null,{timeout:15000});
  await p.locator(".maplibregl-canvas").focus();await p.keyboard.down("w");
  await p.waitForFunction(()=>window.__testMap.getPitch()>40&&window.__testMap.getZoom()>16.5,null,{timeout:15000});
  await p.keyboard.up("w");await p.waitForFunction(()=>!window.__testMap.isMoving(),null,{timeout:15000});
  report.checks.push({name:"overview-resumes-street-camera",passed:true});
 }
 for(const [name,width,height] of [["360",360,780],["390",390,844],["landscape",844,390],["desktop",1440,900]]){await p.setViewportSize({width,height});await pause(200);await p.screenshot({path:join(shots,`${name}-camera-demo.png`)});}
 await c.close();
 console.log("Demo camera and keyboard checks passed");

 if(!before){
  const gpsContext=await context("reduce");await api(gpsContext,"/session",{name:"GPS camera explorer"});await api(gpsContext,"/world",{arena:true,location:home});const gpsPage=await gpsContext.newPage();await ready(gpsPage);
  await gpsPage.evaluate(p=>window.__gps(p,90,1.4),home);await gpsPage.getByRole("button",{name:"Use GPS, my location",exact:true}).click();
  const bearing=async h=>gpsPage.waitForFunction(h=>Math.abs(((window.__testMap.getBearing()-h+540)%360)-180)<1,h,{timeout:15000});
  await bearing(90);await pause(1000);const west=stepFrom(home,270,2);
  await gpsPage.evaluate(p=>window.__gps(p,270,1.4),west);await bearing(270);await pause(1000);const north=stepFrom(west,0,4);
  await gpsPage.evaluate(p=>window.__gps(p,null,null),north);await bearing(0);
  await gpsPage.evaluate(p=>window.__gps(p,180,0),stepFrom(north,180,4));await pause(500);assert.ok(angle((await pose(gpsPage)).bearing,0)<1,"Stationary jitter never turns the follow camera");
  assert.equal((await pose(gpsPage)).keyboard,true,"GPS retains map keyboard navigation");
  await gpsPage.screenshot({path:join(shots,"390-camera-gps-course-and-fallback.png")});
  report.checks.push({name:"gps-course-reverse-fallback-and-stationary-jitter",passed:true});await gpsContext.close();
  console.log("GPS course and fallback checks passed");
 }

 if(process.env.E2E_SCOPE==="controls"){
  writeFileSync(join(shots,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }else{

 const routeContext=await context("reduce");await api(routeContext,"/session",{name:"Checkpoint explorer"});let world=(await api(routeContext,"/world",{arena:before,location:home})).data;
 const now=Date.now()+offset;
 const route=world.quests.filter(q=>q.kind==="route"&&q.tier===1&&q.checkpointCount>2&&q.opens_at<=now&&q.closes_at>now).sort((a,b)=>b.checkpointCount-a.checkpointCount)[0];assert.ok(route);
 const zone=world.zones.find(z=>z.id===route.zone_id),targets=route.stops;
 const page=await routeContext.newPage();page.setDefaultTimeout(30000);
 if(before)await api(routeContext,"/quests/checkpoint",{questId:route.id,checkpoint:0,fix:route.nextPoint});
 await ready(page);
 if(!before){await page.evaluate(p=>window.__gps(p,null,0),targets[0]);await page.getByRole("button",{name:"Use GPS, my location",exact:true}).click();await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});}
 await selectRoute(page,zone,route);
 if(before){await page.getByRole("button",{name:"Close panel",exact:true}).click();await page.screenshot({path:join(shots,"390-checkpoint-after-first.png")});report.checks.push({name:"checkpoint-numbering-after-first",markers:await page.locator(".quest-route-stop").allTextContents()});}
 else{
  await page.locator(".quest-detail").getByRole("button",{name:"Start quest",exact:true}).click();
  let location=targets[0];
  for(let i=0;i<targets.length;i++){
   if(i){
    await page.locator(".quest-detail").getByRole("button",{name:"Guide me",exact:true}).click();
    const near=Array.from({length:24},(_,j)=>stepFrom(targets[i],j*15,8)).find(p=>containsPoint(zone.geometry,[p.lng,p.lat]))||targets[i];
    await travel(page,location,near);location=near;await dismissPickup(page);
    if(i===1){for(const [name,width,height] of [["360",360,780],["390",390,844],["landscape",844,390],["desktop",1440,900]]){await page.setViewportSize({width,height});await pause(150);await page.screenshot({path:join(shots,`${name}-checkpoint-current-map.png`)});}await page.setViewportSize({width:390,height:844});}
    const objective=page.locator(".compact-selection:visible,.nearby-open:visible");await objective.first().click();
   }
   await page.locator(".quest-brief-progress").getByText(new RegExp(`Stop ${i+1} of ${targets.length}`)).waitFor();
   const confirmation=page.getByRole("button",{name:`Confirm stop ${i+1}`,exact:true});await confirmation.waitFor();
   const distance=metersBetween(location,targets[i]);assert.ok(distance<=25);
   const response=page.waitForResponse(r=>r.url().endsWith("/quests/checkpoint"));await confirmation.click();const receipt=await(await response).json();assert.equal(receipt.progress.completed,i+1);
   if(i<targets.length-1){
    await page.locator(".quest-brief-progress").getByText(new RegExp(`Stop ${i+2} of ${targets.length}`)).waitFor();
    const numbers=await page.locator(".quest-route-stop").evaluateAll(els=>els.flatMap(el=>el.dataset.stops.split(",").map(Number)));
    assert.deepEqual(numbers.sort((a,b)=>a-b),Array.from({length:targets.length-i-1},(_,n)=>n+i+2));
    const wrong=await api(routeContext,"/quests/checkpoint",{questId:route.id,checkpoint:i+1,fix:{...location,accuracy:5,timestamp:Date.now()+offset}});assert.equal(wrong.status,422,"A later/already visited location cannot confirm the next ordered stop");
    const unchanged=(await api(routeContext,"/world?id="+encodeURIComponent(world.id))).data.quests.find(q=>q.id===route.id);assert.equal(unchanged.checkpoint,i+1);
    if(i===0){
     for(const [name,width,height] of [["360",360,780],["390",390,844],["landscape",844,390],["desktop",1440,900]]){await page.setViewportSize({width,height});await page.screenshot({path:join(shots,`${name}-checkpoint-next-detail.png`)});}await page.setViewportSize({width:390,height:844});
     if(metersBetween(targets[0],targets.at(-1))<.5){
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      const markerTargets=await page.locator(".quest-route-stop").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,label:el.getAttribute("aria-label")};}));
      assert.ok(markerTargets.every(t=>t.width>=48&&t.height>=48&&t.label),"Every checkpoint has a labelled 48px target");
      await page.addScriptTag({content:axe});
      const issues=await page.evaluate(async()=>(await window.axe.run()).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
      assert.deepEqual(issues,[],"Checkpoint map accessibility");
      const later=page.locator(`.quest-route-stop[data-stops="${targets.length}"]`);await later.click();
      await page.locator(".quest-brief-progress").getByText(new RegExp(`Stop 2 of ${targets.length}`)).waitFor();
      assert.equal(await page.getByRole("button",{name:`Confirm stop ${targets.length}`,exact:true}).count(),0,"A later return marker opens the current requirement, not a skip action");
      report.checks.push({name:"future-return-marker-opens-current-requirement",passed:true});
     }
    }
   }else{await page.locator(".adventure-results-dialog").waitFor();assert.equal(receipt.result.status,"confirmed");assert.equal(await page.locator("dialog[open]").count(),1);}
   report.checks.push({name:`confirmed-stop-${i+1}`,withinM:distance,serverProgress:receipt.progress});
   console.log(`Checkpoint ${i+1}/${targets.length} confirmed`);
  }
  const replay=await api(routeContext,"/quests/checkpoint",{questId:route.id,checkpoint:targets.length-1,fix:{...location,accuracy:5,timestamp:Date.now()+offset}});assert.equal(replay.data.replayed,true);
  assert.ok((await page.evaluate(()=>window.__cameraCalls)).filter(c=>c.duration!==undefined).every(c=>c.duration===0),"Reduced-motion camera calls never animate");
  await page.screenshot({path:join(shots,"390-route-confirmed.png")});
 }
 await routeContext.close();writeFileSync(join(shots,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}catch(error){
 const page=browser?.contexts().flatMap(c=>c.pages()).at(-1);
 if(page){await page.screenshot({path:join(shots,"failure-state.png")}).catch(()=>{});report.failure={message:error.message,dialogs:await page.locator("dialog[open]").allTextContents().catch(()=>[])};}
 writeFileSync(join(shots,"partial-report.json"),JSON.stringify(report,null,2));throw error;
}finally{await browser?.close();child.kill("SIGTERM");await vite.close();}
