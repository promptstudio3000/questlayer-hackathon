// Actual App; a synthetic spawn-side coin tests the intro's request fence.
// Every coin request is intercepted and aborted, so no reward is requested from the server.
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import assert from "node:assert/strict";
import {chromium} from "playwright";
const root=resolve(import.meta.dirname,".."),dir=mkdtempSync(join(tmpdir(),"questlayer-intro-input-"));
const shots=resolve("output/qa/compact-guidance-2026-11-08/final-guide");mkdirSync(shots,{recursive:true});
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(root,"server/index.mjs")],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:join(dir,"test.sqlite"),DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",DISABLE_BACKGROUND_WORKERS:"1",NEAR_RPC_URL:"http://127.0.0.1:9"},stdio:["ignore","ignore","pipe"]});
let browser,attempts=0,seeded=false,errors="";server.stderr.on("data",d=>errors+=d);
try{
  const until=Date.now()+60000;while(true){try{if((await fetch(url+"/api/health")).ok)break;}catch{}if(Date.now()>until)throw Error(errors.slice(-1000));await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce",serviceWorkers:"block"});
  await page.route("**/api/world",async route=>{
    const response=await route.fetch(),world=await response.json();
    if(world.coins?.length){world.coins[0]={...world.coins[0],lat:49.74745,lng:13.3774};seeded=true;}
    await route.fulfill({response,json:world});
  });
  await page.route("**/api/coins/claim",route=>{attempts++;return route.abort("failed");});
  await page.goto(url);await page.getByPlaceholder("Your explorer name").fill("Mira intro fence");
  await page.getByRole("button",{name:"Start exploring",exact:true}).click();
  await page.locator(".game-intro").waitFor();
  for(let i=0;!seeded&&i<200;i++)await page.waitForTimeout(50);
  assert.ok(seeded,"The UI received a coin within collection distance");
  await page.waitForTimeout(1500);
  assert.equal(attempts,0,"No automatic collection request while the intro is open");
  assert.equal(await page.locator("dialog[open]").count(),1,"The intro stays the only modal");
  await page.getByRole("button",{name:"Let's explore",exact:true}).click();
  for(let i=0;!attempts&&i<100;i++)await page.waitForTimeout(50);
  assert.ok(attempts>0,"Normal collection resumes only after explicit continuation");
  const report={provenance:"Actual App; one synthetic UI coin at spawn, every claim intercepted and aborted",introClaimRequests:0,afterContinueClaimRequests:attempts,serverClaims:0,oneIntroDialog:true};
  writeFileSync(join(shots,"pickup-fence.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();server.kill("SIGTERM");}
