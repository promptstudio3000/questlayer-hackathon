// Actual App/API; a synchronous world response exercises a delayed React commit.
// It must not be discarded merely because the previous mode is still rendered.
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import assert from "node:assert/strict";
import {chromium,webkit} from "playwright";
const root=resolve(import.meta.dirname,".."),dir=mkdtempSync(join(tmpdir(),"questlayer-mode-"));
const shots=resolve(process.env.E2E_SHOTS||"output/qa/compact-guidance-2026-11-08/world-mode");mkdirSync(shots,{recursive:true});
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`,home={lat:49.74745,lng:13.3774};
const server=spawn(process.execPath,[join(root,"server/index.mjs")],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:join(dir,"test.sqlite"),DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",DISABLE_BACKGROUND_WORKERS:"1",NEAR_RPC_URL:"http://127.0.0.1:9"},stdio:["ignore","ignore","pipe"]});
let browser,errors="";server.stderr.on("data",d=>errors+=d);
const engine=process.env.E2E_BROWSER==="webkit"?webkit:chromium;
try{
 const until=Date.now()+60000;while(true){try{if((await fetch(url+"/api/health")).ok)break;}catch{}if(Date.now()>until)throw Error(errors.slice(-1000));await new Promise(r=>setTimeout(r,100));}
 browser=await engine.launch();const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce",serviceWorkers:"block"});
 const post=async(path,data)=>{const r=await context.request.post(url+"/api"+path,{headers:{Origin:url},data});assert.ok(r.ok());return r.json();};
 await post("/session",{name:"Mira mode"});const gpsWorld=await post("/world",{arena:false,location:home});assert.ok(gpsWorld.zones.length);
 const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem("questlayer.mapAppearance","2d"));
 try{
  await page.goto(url);await page.getByRole("button",{name:"Explore",exact:true}).click();await page.locator(".zone-card").first().waitFor();await page.getByRole("button",{name:"Close panel",exact:true}).click();
  await page.evaluate(({world,home})=>{
   const original=window.fetch.bind(window);window.__worldModeResponses=0;
   window.fetch=(input,options)=>{
    if(String(input).endsWith("/api/world")&&options?.body&&JSON.parse(String(options.body)).arena===false){
     window.__worldModeResponses++;
     const response=new Response(JSON.stringify(world),{headers:{"Content-Type":"application/json"}});
     response.json=()=>Promise.resolve(world);
     return window.__delayGps ? new Promise(resolve=>{window.__finishGps=()=>resolve(response);}) : Promise.resolve(response);
    }
    return original(input,options);
   };
   Object.defineProperty(navigator,"geolocation",{configurable:true,value:{
    getCurrentPosition(success){setTimeout(()=>success({coords:{latitude:home.lat,longitude:home.lng,accuracy:8,heading:null,speed:null},timestamp:Date.now()}),0);},
    watchPosition(){return 1;},clearWatch(){},
   }});
  },{world:gpsWorld,home});
  await page.getByRole("button",{name:"Use GPS, my location",exact:true}).click();
  await page.waitForFunction(()=>window.__worldModeResponses===1);
  await page.locator(".world-loading").waitFor({state:"hidden",timeout:4000});
  await page.getByRole("button",{name:"Explore",exact:true}).click();await page.locator(".zone-card").first().waitFor({timeout:4000});
  await page.locator(".zone-card").filter({hasText:gpsWorld.zones[0].name}).waitFor();
  await page.getByRole("button",{name:"Close panel",exact:true}).click();
  await page.getByRole("button",{name:"Demo, back to city demo",exact:true}).click();await page.locator(".demo-pad").waitFor();
  await page.locator(".world-loading").waitFor({state:"hidden",timeout:10000});
  await page.evaluate(()=>{window.__delayGps=true;});
  await page.getByRole("button",{name:"Use GPS, my location",exact:true}).click();
  await page.waitForFunction(()=>window.__worldModeResponses===2);
  await page.getByRole("button",{name:"Demo, back to city demo",exact:true}).click();
  await page.locator(".world-loading").waitFor({state:"hidden",timeout:10000});
  await page.evaluate(async()=>{window.__finishGps();await Promise.resolve();await Promise.resolve();});
  await page.locator(".demo-pad").waitFor();
  await page.getByRole("button",{name:"Use GPS, my location",exact:true}).waitFor();
  await page.getByRole("button",{name:"Explore",exact:true}).click();await page.locator(".zone-card").first().waitFor();
  const report={browser:engine.name(),fastGpsResponseAccepted:true,demoReturn:true,staleGpsResponseIgnored:true,provenance:"Actual local App/API; asynchronous synthetic GPS and immediate browser world-read response"};
  writeFileSync(join(shots,engine.name()+".json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error((await page.locator("body").innerText()).slice(-2500));await page.screenshot({path:join(shots,engine.name()+"-failure.png")});throw error;}
}finally{await browser?.close();server.kill("SIGTERM");}
