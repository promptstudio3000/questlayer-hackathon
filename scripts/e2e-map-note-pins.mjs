// Actual local App and API; disposable session. A note left from the map's
// Actions menu stands on the map as a pin, and tapping it opens that note.
import {spawn} from "node:child_process";
import {mkdtempSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {chromium} from "playwright";
import assert from "node:assert/strict";

const root=resolve(import.meta.dirname,".."), dir=mkdtempSync(join(tmpdir(),"questlayer-note-pins-"));
const shots=resolve(process.env.E2E_SHOTS||"output/qa/map-note-pins");mkdirSync(shots,{recursive:true});
const port=await new Promise(done=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(root,"server/index.mjs")],{cwd:dir,env:{PATH:process.env.PATH,PORT:String(port),HOST:"127.0.0.1",APP_ORIGIN:url,DATABASE_PATH:join(dir,"game.sqlite"),DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",NEAR_RPC_URL:"http://127.0.0.1:9"},stdio:["ignore","ignore","pipe"]});
let errors="";server.stderr.on("data",d=>errors+=d);
let browser;
try {
  const until=Date.now()+60000;
  while(true){try{const h=await(await fetch(url+"/api/health")).json();if(h.worldPreparation?.days?.some(d=>d.state==="ready"))break;}catch{}
    if(Date.now()>until)throw Error(errors.slice(-1200));await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});const page=await context.newPage();
  const faults=[];page.on("pageerror",e=>faults.push(e.message));
  const session=await context.request.post(url+"/api/session",{headers:{Origin:url},data:{name:"Note pins"}});assert.ok(session.ok());
  await page.goto(url);
  await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
  await page.locator(".map-loading").waitFor({state:"hidden",timeout:30000});
  assert.equal(await page.locator(".gold-place-pin.kind-note").count(),0,"No notes yet");
  await page.getByRole("button",{name:"Actions",exact:true}).click();
  await page.getByRole("button",{name:/Leave a note/}).click();
  const text="Fresh bread at the corner bakery";
  await page.locator(".quick-create textarea").fill(text);
  await page.getByRole("button",{name:"Leave the note here"}).click();
  const pin=page.locator(".gold-place-pin.kind-note.is-own",{hasText:text});
  await pin.waitFor({timeout:10000});
  assert.equal(await pin.getAttribute("aria-label"),`Your note: ${text}`);
  await page.screenshot({path:join(shots,"phone-390-note-pin.png")});
  await pin.click();
  const row=page.locator(".map-note.is-focused",{hasText:text});
  await row.waitFor({timeout:10000});
  await page.screenshot({path:join(shots,"phone-390-note-opened.png")});
  assert.deepEqual(faults,[]);
  console.log("map note pins: ok");
} finally { await browser?.close(); server.kill(); }
