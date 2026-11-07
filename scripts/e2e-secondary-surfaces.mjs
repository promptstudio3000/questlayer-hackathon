// Actual local application with disposable accounts. No signing, production state or chain writes.
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const root=resolve(import.meta.dirname,'..');
const phase=process.env.E2E_PHASE||'after';
const engine=process.env.E2E_BROWSER==='webkit'?webkit:chromium;
const shots=resolve(process.env.E2E_SHOTS||`output/qa/secondary-surfaces-2026-11-06/${phase}`);mkdirSync(shots,{recursive:true});
const state=mkdtempSync(join(tmpdir(),'questlayer-secondary-'));
const port=await new Promise(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>done(p));});});
const url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(root,'server/index.mjs')],{cwd:state,env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:url,DATABASE_PATH:join(state,'demo.sqlite'),DISABLE_RELAYER:'1',DISABLE_NATIVE_ATTESTATIONS:'1',NEAR_RPC_URL:'http://127.0.0.1:9',CREATOR_COMMUNITY_ENABLED:'1',CREATOR_POLICY_VERSION:'e2e-secondary',CREATOR_XP_COMMITMENT:'200',CREATOR_MODERATORS:'local-reviewer',CREATOR_COMPLETION_AUTHORITIES:'local-validator'},stdio:['ignore','ignore','pipe']});
let errors='';server.stderr.on('data',d=>errors+=d);
const axe=createRequire(import.meta.url)('axe-core').source;
const report={phase,engine:engine.name(),provenance:'Actual local app and disposable demo services. No financial confirmation is submitted.',viewports:[]};let browser;
try{
 const deadline=Date.now()+60000;while(true){try{if((await fetch(url+'/api/health')).ok)break;}catch{}if(Date.now()>deadline)throw Error(errors.slice(-1000));await new Promise(r=>setTimeout(r,100));}
 browser=await engine.launch();
 for(const [name,width,height] of [['phone-360',360,780],['phone-390',390,844],['landscape',844,390],['desktop',1440,900]]){
  if(process.env.E2E_VIEWPORT&&process.env.E2E_VIEWPORT!==name)continue;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});const page=await context.newPage();const faults=[],scans=[],measurements={};page.on('pageerror',e=>faults.push(e.message));
  const shot=async label=>{
   await page.screenshot({path:join(shots,`${name}-${label}.png`)});
   const sideways=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   if(phase!=='before')assert.equal(sideways,false,label+': page fits');
   if(width===390&&phase!=='before'){
    await page.addScriptTag({content:axe});const issues=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));
    scans.push({label,issues});assert.deepEqual(issues.filter(v=>['serious','critical'].includes(v.impact)),[],label+': accessibility');
   }
  };
  const close=async()=>page.getByRole('button',{name:'Close panel',exact:true}).click();
  const profile=async()=>{await page.locator('.topbar .profile-pill').click();await page.getByRole('tablist',{name:'Profile',exact:true}).waitFor();};
  const community=async()=>{await page.locator('.nav-rail').getByRole('button',{name:'Community',exact:true}).click();await page.getByRole('tablist',{name:'Community',exact:true}).waitFor();};
  const enlarge=async selector=>page.locator(selector+' *').evaluateAll(els=>{
   const saved=els.map(el=>[el,el.style.fontSize,el.style.getPropertyPriority('font-size'),parseFloat(getComputedStyle(el).fontSize)]);
   window.__restoreSecondaryText=()=>saved.forEach(([el,size,priority])=>{el.style.removeProperty('font-size');if(size)el.style.setProperty('font-size',size,priority);});
   saved.filter(([el])=>el.matches('input,textarea,select')||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,,,size])=>el.style.setProperty('font-size',`${size*2}px`,'important'));
  });
  if (!process.env.E2E_PUBLIC_ONLY) {
  await page.goto(url);await page.getByLabel('What should we call you?',{exact:true}).fill('Mira');await page.getByRole('button',{name:'Start exploring',exact:true}).click();await page.locator('.topbar .profile-pill').waitFor();await page.locator('.world-loading').waitFor({state:'detached'});
  await profile();await page.getByRole('tab',{name:'Badges',exact:true}).click();await page.locator('.badge-medal').first().waitFor();await shot('badges');await page.locator('.badge-medal').first().click();await page.getByRole('dialog').waitFor();await shot('badge-detail');await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Settings',exact:true}).click();await shot('settings');
  await page.getByText('Account and devices',{exact:true}).click();await page.locator('.account-sessions').waitFor();await page.locator('.account-sessions').scrollIntoViewIfNeeded();await shot('account-devices');
  const link=page.locator('.account-sessions').getByText('Link a NEAR account',{exact:true});
  if(await link.isVisible()){await link.click();await page.locator('.account-sessions').getByRole('button',{name:'Link NEAR account',exact:true}).click();await page.locator('.wallet-select').waitFor();await shot('wallet-choice');await page.keyboard.press('Escape');}
  await page.getByRole('button',{name:'Help & guide',exact:true}).click();await page.locator('.npc-modal').waitFor();await shot('guide');
  if(phase!=='before'){const closeSize=await page.locator('.npc-modal .close').boundingBox();assert.ok(closeSize.width>=47.9&&closeSize.height>=47.9,'Guide close has a 48px target');const font=await page.locator('.npc-modal input').evaluate(el=>({input:getComputedStyle(el).fontSize,placeholder:getComputedStyle(el,'::placeholder').fontSize}));assert.ok(parseFloat(font.input)>=16,'Guide input starts at 16px');measurements.guide={...font,closeWidth:closeSize.width,closeHeight:closeSize.height};}
  if(width===390){await enlarge('.npc-modal');await shot('guide-enlarged-text');await page.evaluate(()=>window.__restoreSecondaryText());await page.setViewportSize({width,height:420});await page.locator('.npc-modal input').focus();await page.locator('.npc-modal input').scrollIntoViewIfNeeded();await shot('guide-keyboard');await page.setViewportSize({width,height});}
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Game economy',exact:false}).click();await page.locator('.play-economy').waitFor();await shot('game-economy');await page.getByText('Practice economy simulation',{exact:true}).click();await page.locator('.fund-hero').waitFor();await shot('practice-economy');await close();
  await profile();await page.getByRole('tab',{name:'Stake',exact:true}).click();await page.locator('.fuel').waitFor();await shot('stake');await page.getByRole('tab',{name:'Rewards',exact:true}).click();await page.waitForTimeout(500);await shot('rewards');await close();
  await page.locator('.nav-rail').getByRole('button',{name:'Inventory',exact:true}).click();await page.getByRole('tab',{name:'Shop',exact:true}).click();await page.locator('.gold-shop').waitFor();await shot('shop');await page.getByRole('tab',{name:'Market',exact:true}).click();await page.waitForTimeout(500);await shot('market');await close();
  await community();await page.getByRole('tab',{name:'Creators',exact:true}).click();await page.getByRole('button',{name:'My creations',exact:true}).click();await page.getByRole('button',{name:'New quest',exact:true}).waitFor();await shot('creations-empty');await page.getByRole('button',{name:'New quest',exact:true}).click();await page.locator('.creator-form').waitFor();await shot('creator-form');
  if(width===390){await enlarge('.creator-form');await shot('creator-form-enlarged-text');await page.evaluate(()=>window.__restoreSecondaryText());await page.setViewportSize({width,height:420});await page.locator('.creator-form input').first().focus();await shot('creator-form-keyboard');await page.setViewportSize({width,height});}
  await page.getByRole('tab',{name:'Tasks',exact:true}).click();await page.waitForTimeout(400);await shot('tasks');await page.getByRole('tab',{name:'Places',exact:true}).click();await page.waitForTimeout(400);await shot('places');
  }
  for(const [path,selector] of [['how-it-works','.hiw'],['wiki','.wk'],['economy','.eco'],['treasury','.tr']]){
   await page.goto(url+'/'+path);await page.locator(selector).waitFor();await page.waitForTimeout(300);await shot(path);
   if(path==='wiki'){
    const search=page.locator('input[type=search]');await search.fill('zzzz-no-matching-chapter');await page.locator('.wk-empty-search').waitFor();await shot('wiki-no-results');
    if(width===390){await enlarge('.wk-search');await shot('wiki-search-enlarged-text');await page.evaluate(()=>window.__restoreSecondaryText());await page.setViewportSize({width,height:420});await search.focus();await search.scrollIntoViewIfNeeded();await shot('wiki-search-keyboard');await page.setViewportSize({width,height});}
    await search.fill('');const figure=page.locator('.wk-scroll').first();await figure.scrollIntoViewIfNeeded();
    if(phase!=='before'&&await figure.evaluate(el=>el.scrollWidth>el.clientWidth+1)){
     await figure.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.ok(await figure.evaluate(el=>el.scrollLeft>0),'Wiki diagram scrolls with keyboard');
     await page.keyboard.press('Home');assert.ok(await figure.evaluate(el=>Math.abs(el.scrollLeft)<1),'Home returns to the diagram start');
     await page.keyboard.press('End');assert.ok(await figure.evaluate(el=>el.scrollLeft>=el.scrollWidth-el.clientWidth-1),'End reaches the diagram end');
     const end=await figure.evaluate(el=>el.scrollLeft);await page.keyboard.press('ArrowLeft');assert.ok(await figure.evaluate(el=>el.scrollLeft)<end,'ArrowLeft moves back');await shot('wiki-diagram-keyboard');
    }
   }
   if(path==='treasury'){await page.locator('#tr-model').scrollIntoViewIfNeeded();await shot('treasury-model');const slider=page.locator('.tr-sim input[type=range]').first();await slider.focus();const old=await slider.inputValue();await page.keyboard.press('ArrowRight');assert.notEqual(await slider.inputValue(),old,'Read-only model responds to keyboard');}
  }
  assert.deepEqual(faults,[],'No uncaught browser errors');report.viewports.push({name,width,height,faults,scans,measurements});writeFileSync(join(shots,'report.json'),JSON.stringify(report,null,2));await context.close();console.log(name+': secondary routes and dialogs passed');
 }
}finally{await browser?.close();server.kill('SIGTERM');}
