// Onboarding and compact-help acceptance against the actual isolated App/API.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const language = process.env.E2E_LANG || "en";
const dict = language === "en" ? {} : JSON.parse(readFileSync(join(root,"src/i18n",language+".json"),"utf8"));
const t = key => dict[key] || key;
const shots = resolve(process.env.E2E_SHOTS || "output/qa/compact-guidance-2026-11-08/guide");
mkdirSync(shots,{recursive:true});
const dir = mkdtempSync(join(tmpdir(),"questlayer-learning-"));
const port = await new Promise(done => { const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>done(p));}); });
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,[join(root,"server/index.mjs")],{
  cwd:dir,env:{PATH:process.env.PATH,HOST:"127.0.0.1",PORT:String(port),APP_ORIGIN:url,DATABASE_PATH:join(dir,"test.sqlite"),DISABLE_RELAYER:"1",DISABLE_NATIVE_ATTESTATIONS:"1",DISABLE_BACKGROUND_WORKERS:"1",NEAR_RPC_URL:"http://127.0.0.1:9"},stdio:["ignore","ignore","pipe"],
});
let errors="",browser;server.stderr.on("data",d=>{errors+=d;});
const report={language,browser:process.env.E2E_BROWSER||"chromium",provenance:"Local App/API; simulated viewport/keyboard, no physical-device or newcomer-study claim",cases:[]};
const axe=createRequire(import.meta.url)("axe-core").source;
const learningState = page => page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith("questlayer.learning:")))));
try {
  const until=Date.now()+60000;
  while(true){try{if((await fetch(url+"/api/health")).ok)break;}catch{}if(Date.now()>until)throw Error(errors.slice(-1000));await new Promise(r=>setTimeout(r,100));}
  browser=await(process.env.E2E_BROWSER==="webkit"?webkit:chromium).launch();
  for(const[name,width,height]of[["phone-360",360,780],["phone-390",390,844],["landscape",844,390],["desktop",1440,900]]){
    if(process.env.E2E_VIEWPORT&&process.env.E2E_VIEWPORT!==name)continue;
    const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce",serviceWorkers:"block"});
    const page=await context.newPage();let claims=0,guideRequests=0;
    page.on("request",r=>{if(r.method()==="POST"&&/\/api\/(quests\/(claim|checkpoint)|actors\/.*challenge)/.test(r.url()))claims++;if(r.url().includes("/guide/hint"))guideRequests++;});
    await page.goto(url+"/?lang="+language);
    await page.getByLabel(t("What should we call you?"),{exact:true}).fill("Mira guide");
    if(width===390){await page.setViewportSize({width,height:420});await page.screenshot({path:join(shots,`${name}-keyboard-welcome.png`)});await page.setViewportSize({width,height});}
    await page.getByRole("button",{name:t("Start exploring"),exact:true}).click();
    const intro=page.getByRole("dialog",{name:t("How to play"),exact:true});await intro.waitFor();
    await page.locator(".game-intro img").evaluateAll(images=>Promise.all(images.map(img=>img.decode().catch(()=>{}))));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Intro has no page overflow");
    if(width===390){await page.addScriptTag({content:axe});const issues=await page.evaluate(async()=>(await window.axe.run(document.querySelector("dialog[open]"))).violations.filter(v=>["critical","serious"].includes(v.impact)).map(v=>v.id));assert.deepEqual(issues,[],"Intro accessibility");}
    await page.screenshot({path:join(shots,`${name}-intro.png`)});
    await intro.getByRole("button",{name:t("Let's explore"),exact:true}).click();
    await page.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
    await page.locator(".first-session .learning-hint").waitFor();
    assert.equal((await learningState(page)).enabled,true);
    assert.equal((await learningState(page)).intro,"done");
    await page.locator(".maplibregl-canvas").waitFor();
    await page.locator(".map-loading").waitFor({state:"hidden",timeout:30000});
    await page.screenshot({path:join(shots,`${name}-guided-map.png`)});
    await page.getByRole("button",{name:t("Hide objective"),exact:true}).click();
    assert.equal((await learningState(page)).seen["movement-arena"],true,"Dismissing the tip acknowledges only the taught control topic");
    await page.reload();await page.locator(".topbar .profile-pill").waitFor();
    assert.equal(await page.locator(".game-intro").count(),0,"Returning session never reopens intro");
    assert.notEqual(await page.locator(".first-session .learning-hint").textContent(),t("Use the pad to move. Side arrows turn your ghost."),"Dismissed controls tip does not replay");
    assert.equal(claims,0);assert.equal(guideRequests,0,"Automatic help does not call the AI guide");
    await context.close();

    const skipped=await browser.newContext({viewport:{width,height},reducedMotion:"reduce",serviceWorkers:"block"});
    const quiet=await skipped.newPage();await quiet.goto(url+"/?lang="+language);
    await quiet.getByLabel(t("What should we call you?"),{exact:true}).fill("Mira knows");
    await quiet.getByRole("button",{name:t("Start exploring"),exact:true}).click();
    await quiet.locator(".game-intro").waitFor();await quiet.keyboard.press("Escape");
    await quiet.locator(".world-loading").waitFor({state:"hidden",timeout:60000});
    assert.equal((await learningState(quiet)).enabled,false);assert.equal((await learningState(quiet)).intro,"skipped");
    assert.equal(await quiet.locator(".first-session").count(),0,"Experienced player has no first-steps coach");
    await quiet.locator(".maplibregl-canvas").waitFor();
    await quiet.locator(".map-loading").waitFor({state:"hidden",timeout:30000});
    await quiet.screenshot({path:join(shots,`${name}-skipped-map.png`)});
    await quiet.reload();await quiet.locator(".topbar .profile-pill").waitFor();assert.equal(await quiet.locator(".game-intro").count(),0);
    await quiet.locator(".topbar .profile-pill").click();await quiet.getByRole("tab",{name:t("Settings"),exact:true}).click();
    const help=quiet.getByRole("button",{name:t("How to play"),exact:true});await help.click();
    await quiet.locator(".game-intro").waitFor();await quiet.keyboard.press("Escape");
    assert.equal(await help.evaluate(el=>el===document.activeElement),true,"Manual help returns focus to its trigger");
    assert.equal((await learningState(quiet)).enabled,false,"Reopening help does not enable automatic tips");
    await help.click();
    if(width===390){
      await quiet.addStyleTag({content:".game-intro p,.game-intro button{font-size:32px!important}.game-intro h1{font-size:52px!important}.game-intro h2{font-size:40px!important}"});
      assert.equal(await quiet.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"Enlarged text has no horizontal overflow");
      await quiet.screenshot({path:join(shots,`${name}-enlarged-intro.png`)});
    }
    await quiet.getByRole("button",{name:t("Back to map"),exact:true}).click();
    assert.equal(await quiet.locator(".game-intro").count(),0);assert.equal((await learningState(quiet)).enabled,false);
    report.cases.push({name,continue:true,skip:true,reload:true,manualHelp:true,focusReturn:true,claims,guideRequests});
    await skipped.close();
  }
  const interrupted = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
  const interruptedPage=await interrupted.newPage();await interruptedPage.goto(url+"/?lang="+language);
  await interruptedPage.getByLabel(t("What should we call you?"),{exact:true}).fill("Mira interrupted");
  await interruptedPage.getByRole("button",{name:t("Start exploring"),exact:true}).click();
  await interruptedPage.locator(".game-intro").waitFor();await interruptedPage.reload();
  await interruptedPage.locator(".topbar .profile-pill").waitFor();
  assert.equal((await learningState(interruptedPage)).enabled,false,"Unfinished introduction never opts into teaching on restore");
  assert.equal((await learningState(interruptedPage)).intro,"done");
  await interruptedPage.locator(".topbar .profile-pill").click();
  await interruptedPage.getByRole("tab",{name:t("Settings"),exact:true}).click();
  await interruptedPage.getByRole("button",{name:t("How to play"),exact:true}).waitFor();
  assert.equal(await interruptedPage.locator(".game-intro").count(),0,"Restoring an unfinished introduction leaves the UI usable");
  assert.equal(await interruptedPage.locator(".first-session").count(),0);
  report.interruptedIntroRestoresQuietly=true;await interrupted.close();
  const linked = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
  const linkPage=await linked.newPage();await linkPage.goto(url+"/?lang="+language+"#task=local-example");
  await linkPage.getByLabel(t("What should we call you?"),{exact:true}).fill("Mira linked");
  await linkPage.getByRole("button",{name:t("Start exploring"),exact:true}).click();
  await linkPage.locator(".topbar .profile-pill").waitFor();
  assert.equal(await linkPage.locator(".game-intro").count(),0,"New account at a deep link is not interrupted by the intro");
  assert.equal(await linkPage.locator(".first-session").count(),0,"Deep-link entry does not enable automatic teaching");
  report.deepLinkUninterrupted=true;await linked.close();
}catch(error){for(const context of browser?.contexts()||[])for(const page of context.pages()){console.error((await page.locator("body").innerText()).slice(-5000));await page.screenshot({path:join(shots,"failure.png")}).catch(()=>{});}throw error;}
finally{await browser?.close();server.kill("SIGTERM");writeFileSync(join(shots,"verification.json"),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
