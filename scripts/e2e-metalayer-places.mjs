// A fresh explorer discovers the authored world through the built UI, real
// keyboard movement and authenticated presence. No position or inventory fixture.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root=resolve(import.meta.dirname,".."), out=resolve(process.env.LAYER_QA_OUT || "output/qa/metalayer-world-2026-11-13");
mkdirSync(out,{recursive:true});
const lang=process.env.E2E_LANG || "en";
const dictionary=lang==="en" ? {} : JSON.parse(readFileSync(join(root,`src/i18n/${lang}.json`)));
const t=key=>dictionary[key]||key;
const temporary=mkdtempSync(join(tmpdir(),"metalayer-places-ui-")), guard=join(temporary,"loopback.mjs");
writeFileSync(guard,`const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return Promise.reject(Error('World QA permits loopback only'));return original(input,options);};`);
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,["server/index.mjs"],{cwd:root,env:{PATH:dirname(process.execPath)+":/usr/bin:/bin",PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:base,DATABASE_PATH:join(temporary,"game.sqlite"),DISABLE_NATIVE_ATTESTATIONS:"1",DISABLE_BACKGROUND_WORKERS:"1",DISABLE_RELAYER:"1",NPC_TRADER_ENABLED:"0",QGOLD_KEEPER_ENABLED:"0",QGOLD_KEEPER_EXECUTE:"0",NEAR_RPC_URL:"http://127.0.0.1:9",NODE_ENV:"test",LAYER_ENABLED:"1",LAYER_DEMO_ACTORS:"1",NODE_OPTIONS:`--import=${guard}`},stdio:["ignore","pipe","pipe"]});
let logs=""; server.stdout.on("data",b=>logs+=b);server.stderr.on("data",b=>logs+=b);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let browser,page;const captures=[],errors=[],scans=[];
try {
  const deadline=Date.now()+30000;
  while(true){try{if((await fetch(base+"/api/health")).ok)break;}catch{}if(Date.now()>deadline)throw Error(logs.slice(-3000));await sleep(200);}
  browser=await chromium.launch({headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,reducedMotion:"reduce",serviceWorkers:"block"});
  await context.addInitScript(()=>localStorage.setItem("questlayer.playMode","demo"));
  page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base+`/?lang=${lang}`);await page.locator("#nickname").fill("Mira wayfinder");
  await page.getByRole("button",{name:t("Start exploring"),exact:true}).click();
  await page.getByRole("dialog",{name:t("How to play"),exact:true}).getByRole("button",{name:t("Let's explore"),exact:true}).click();
  await page.locator(".topbar .world-switcher").click();await page.getByRole("button",{name:/MetaLayer/}).click();
  const stage=page.locator('[data-testid="layer-stage"][data-ready=true]');await stage.waitFor({timeout:30000});
  const shot=async name=>{await page.locator(".ml-sheet img").evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))));await page.screenshot({path:join(out,name+".png")});captures.push(name+".png");};
  const state=()=>page.evaluate(async()=> (await fetch("/api/layer/expedition/state?x=0&z=0")).json());
  const pose=async()=>JSON.parse(await stage.getAttribute("data-position"));
  async function walk(x,z,tolerance=1.3){
    await page.locator(".layer-canvas").focus(); const deadline=Date.now()+30000;
    for(let i=0;Date.now()<deadline;i++){
      // Native dialogs restore their opener on close. Deliberately move focus
      // back to the world, as a player clicking the canvas would do.
      await page.locator(".layer-canvas").focus();
      const p=await pose(), distance=Math.hypot(x-p.x,z-p.z);if(distance<tolerance)return;
      const yaw=Number(await stage.getAttribute("data-heading")),wanted=Math.atan2(p.x-x,p.z-z),diff=Math.atan2(Math.sin(wanted-yaw),Math.cos(wanted-yaw));
      if(Math.abs(diff)>.09){const key=diff>0?"a":"d";await page.keyboard.down(key);await sleep(Math.min(180,Math.max(30,Math.abs(diff)/2.6*1000)));await page.keyboard.up(key);}
      else{await page.keyboard.down("w");await sleep(Math.min(200,distance/8.5*1000));await page.keyboard.up("w");}
    }
    throw Error(`Normal walk failed: ${JSON.stringify(await pose())} -> ${x},${z}`);
  }
  async function scan(name){
    await page.addScriptTag({content:createRequire(import.meta.url)("axe-core").source});
    const violations=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.filter(v=>["serious","critical"].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    scans.push({name,violations});assert.deepEqual(violations,[],name);
  }
  assert.equal(await page.locator(".ml-map-tools").count(),0);
  await shot("390-arrival-guide-and-demo");
  await page.setViewportSize({width:360,height:640});await shot("360-arrival-guide-and-demo");
  await page.setViewportSize({width:740,height:360});await shot("landscape-arrival");
  await page.setViewportSize({width:1440,height:900});await shot("desktop-arrival");
  await page.setViewportSize({width:390,height:844});
  // The camera faces Nera on arrival. Probe her visible centre column through
  // the ordinary pointer path; clicking empty ground never changes world state.
  let tappedGuide=false;
  for(const y of [270,240,300,210,330]) {
    await page.mouse.click(195,y); await sleep(150);
    if(await page.getByRole("dialog",{name:t("Keeper Nera"),exact:true}).isVisible()) {tappedGuide=true;break;}
  }
  assert.ok(tappedGuide,"the rendered guide can be tapped directly");
  await page.keyboard.press("Escape");
  await walk(12.5,-4.5);
  await page.locator(".ml-objective").click();await page.getByRole("heading",{name:t("Keeper Nera"),exact:true}).waitFor();
  await shot("390-nera-greeting");await scan("Nera greeting");
  await page.getByText(t("Meet the square"),{exact:true}).click();await shot("390-independent-tour");
  await page.getByRole("button",{name:t("Accept expedition"),exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});assert.notEqual((await state()).quest.state,"available");
  await walk(12.5,-4.5);await walk(-5.5,-4.5);
  await page.waitForFunction(async()=> (await(await fetch("/api/layer/expedition/state?x=0&z=0")).json()).discoveries.includes("treasury"));
  await shot("390-golden-vault-world");await page.locator(".ml-objective").click();
  await page.getByRole("heading",{name:t("MetaGold treasury"),exact:true}).waitFor();
  await page.getByText(t("Treasury inactive"),{exact:true}).waitFor();await shot("390-treasury-inactive");await scan("Treasury inactive");
  await page.keyboard.press("Escape");
  await walk(-12.5,-4.5);await walk(-12.5,32.5);await walk(-22.5,32.5);
  await page.waitForFunction(async()=> (await(await fetch("/api/layer/expedition/state?x=0&z=0")).json()).discoveries.includes("workshop"));
  await shot("390-luma-workshop-world");await page.locator(".ml-objective").click();await page.getByRole("heading",{name:t("Luma's workshop"),exact:true}).waitFor();
  await shot("390-workshop-building");await page.getByRole("button",{name:t("Build it myself"),exact:true}).click();
  assert.equal(await page.locator(".layer-screen").getAttribute("data-building"),"true");
  await page.getByRole("button",{name:t("Actions"),exact:true}).click();await page.getByRole("button",{name:t("Mine blocks"),exact:true}).click();
  await walk(-12.5,32.5);await walk(-12.5,-39.5);await walk(-2.5,-43.5);
  await page.waitForFunction(async()=> (await(await fetch("/api/layer/expedition/state?x=0&z=-47")).json()).discoveries.includes("hollow"));
  await shot("390-physical-hollow-board");await page.locator(".ml-objective").click();
  await page.getByRole("heading",{name:t("The Quiet Beacon"),exact:true}).waitFor();await shot("390-hollow-quest-at-location");
  await page.keyboard.press("Escape");
  await page.locator(".layer-screen .ml-nav").getByRole("button",{name:t("Community"),exact:true}).click();
  await page.getByRole("tab",{name:t("Field journal"),exact:true}).click();await page.getByText(t("Places in this world"),{exact:true}).click();await shot("390-place-directory");
  assert.equal(await page.locator(".ml-place-list li").count(),10);
  await page.getByRole("button",{name:new RegExp(t("Spore Garden"))}).click();
  await page.getByRole("heading",{name:t("Spore Garden"),exact:true}).waitFor();await page.getByText(t("Continue the current chapter with Nera before tuning this place."),{exact:true}).waitFor();await shot("390-later-chapter-state");
  const final=await state();assert.ok(final.discoveries.includes("nera")&&final.discoveries.includes("treasury")&&final.discoveries.includes("workshop")&&final.discoveries.includes("hollow"));
  assert.deepEqual(final.inventory,{diamonds:0,stone:0});assert.equal(final.settlement,"not-configured");
  await page.reload();await stage.waitFor({timeout:30000});assert.deepEqual((await state()).discoveries,final.discoveries);
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,"world-ui.json"),JSON.stringify({status:"passed",lang,checks:["fresh solo entry","direct rendered-guide tap","nearby physical Nera greeting","quest acceptance","real keyboard travel","inactive visible treasury","independent personal discoveries","workshop Build action","physical cave quest board","locked later chapter","ten-place directory","reload persistence"],fixtures:[],captures,scans,errors,hardware:false,liveNearTransaction:false},null,2)+"\n");
  console.log("MetaLayer world places journey passed.");
}catch(error){console.error("Browser errors:",errors);console.error("Local server:",logs.slice(-5000));if(page){console.error("World diagnostics:",await page.locator('[data-testid="layer-stage"]').evaluate(e=>({...e.dataset})).catch(()=>null));await page.screenshot({path:join(out,"failed-state.png")}).catch(()=>{});console.error(await page.locator(".ml-sheet").innerText().catch(()=>"No sheet"));}throw error;}
finally{await browser?.close();server.kill("SIGTERM");await new Promise(r=>{if(server.exitCode!==null)r();else server.once("exit",r);});rmSync(temporary,{recursive:true,force:true});}
