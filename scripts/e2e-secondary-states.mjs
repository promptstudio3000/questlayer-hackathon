// Real components, synthetic local reads and callback spies. No signing or financial settlement.
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium,webkit} from 'playwright';
const root=resolve(import.meta.dirname,'..');const out=resolve(process.env.E2E_SHOTS||'output/qa/secondary-surfaces-2026-11-06/states');mkdirSync(out,{recursive:true});
const engine=process.env.E2E_BROWSER==='webkit'?webkit:chromium;
const vite=await createServer({root,configFile:false,envDir:false,cacheDir:join(mkdtempSync(join(tmpdir(),'questlayer-secondary-vite-')),'vite'),plugins:[react(),{name:'secondary-state-fixture',configureServer(s){s.middlewares.use('/__secondary.html',(_q,r)=>{r.setHeader('Content-Type','text/html');s.transformIndexHtml('/__secondary.html','<!doctype html><html lang="en"><head><title>QuestLayer component state fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script type="module" src="/tests/fixtures/secondary-surfaces.tsx"></script></body></html>').then(html=>r.end(html));});}}],server:{host:'127.0.0.1',port:0}});await vite.listen();const url=`http://127.0.0.1:${vite.httpServer.address().port}`;
const axe=createRequire(import.meta.url)('axe-core').source;const report={engine:engine.name(),provenance:'Real React components with synthetic local read responses. Callback requests are spies, not native or financial confirmations.',viewports:[]};let browser;
try{browser=await engine.launch();
 for(const [name,width,height]of[['phone-360',360,780],['phone-390',390,844],['landscape',844,390],['desktop',1440,900]]){
  if(process.env.E2E_VIEWPORT&&process.env.E2E_VIEWPORT!==name)continue;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});await context.addInitScript(()=>{try{localStorage.setItem("questlayer.playMode","demo")}catch{}});const page=await context.newPage();const faults=[],checks=[];page.on('pageerror',e=>faults.push(e.message));
  await page.addInitScript(()=>{window.__secondaryFixture={player:{id:'local-fixture',name:'Mira',wallets:[],appearance:{},items:[],positions:[],gold_u:0,weighted_u:0,tier:1,level:1}};});
  const shot=async label=>{await page.screenshot({path:join(out,`${name}-${label}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+': page width');assert.equal(await page.locator('dialog[open]').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,label+': dialog width');
   if(width===390){await page.addScriptTag({content:axe});const issues=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));checks.push({label,issues});assert.deepEqual(issues.filter(v=>['serious','critical'].includes(v.impact)),[],label+': accessibility');}};
  for(const kind of ['profile-loading','profile-error','profile-ready','profile-pending','profile-published','account','staking','player','record-ready','record-error','shop','places','confirmation','empty']){
   if(process.env.E2E_CASES&&!process.env.E2E_CASES.split(',').includes(kind))continue;
   let attempts=0;
   await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;
    if(p==='/api/players/card')return route.fulfill({json:{id:'other-explorer',name:'Robin',level:3,self:false,wearables:[],auras:{above:null,below:null},original:false,canWave:true,waveHint:null,phrases:[{key:'hello',text:'Hello!'}]}});
    if(p==='/api/gold/shop'||p==='/api/places'){
     assert.equal(route.request().method(),'GET','Read-only fixture');if(attempts++===0)return route.fulfill({status:503,json:{error:'The connection was interrupted. Nothing has been confirmed.'}});
     return route.fulfill({json:p==='/api/gold/shop'?{version:'fixture',realm:'practice',balanceU:0,emotes:[],cosmetics:[],gear:{perDay:0,boughtToday:0,items:[]},lures:{prices:{},minutes:30,hours:['00:00','23:59'],active:null},look:null}:{radiusKm:3,sort:'latest',prices:{shoutPerDay:1,topicPerDay:1,maxDays:7,freeAuthors:6,postLevel:2},items:[]}});
    }throw Error('Unexpected API operation in UI fixture: '+route.request().method()+' '+p);
   });
   await page.goto(url+'/__secondary.html?case='+kind);await page.locator('#fixture-open').focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();
   if(kind==='profile-error'||kind==='record-error')await page.getByRole('alert').waitFor();
   if(kind==='profile-ready'||kind==='profile-pending'||kind==='profile-published'){
    const publish=page.getByRole('button',{name:/Publish QuestLayer profile|Confirm in your wallet/});await publish.waitFor();assert.ok(await publish.isDisabled(),'Publication requires consent or remains pending');
    if(kind==='profile-ready'){await page.getByLabel('Make this alias and avatar reference public on NEAR testnet.').check();assert.ok(await publish.isEnabled());}
   }
   if(kind==='account'){await page.locator('.account-devices .device-list').waitFor();await page.locator('.account-devices').getByRole('button',{name:'Revoke Travel phone',exact:true}).click();await page.getByRole('button',{name:'Confirm revoke',exact:true}).waitFor();}
   if(kind==='staking'){await page.locator('.staking-create > summary').click();await page.locator('.staking-create select').selectOption('pool.testnet');const create=page.getByRole('button',{name:'Create testnet position',exact:true});assert.ok(await create.isDisabled());await page.getByLabel('I understand the setup reserve and that this is an unaudited testnet pilot.').check();assert.ok(await create.isEnabled());assert.equal(await page.getByRole('slider').inputValue(),'50');}
   if(kind==='player'){await page.getByRole('heading',{name:'Robin',exact:true}).waitFor();await shot('player-ready');await page.getByRole('button',{name:'Block',exact:true}).click();await page.getByRole('button',{name:'Block Robin',exact:true}).waitFor();}
   if(kind==='record-ready'){await page.getByText('Not published yet. Today it lives only in QuestLayer.',{exact:true}).waitFor();const publish=page.getByRole('button',{name:'Publish record',exact:true});assert.equal(await page.locator('input[type=checkbox]:checked').count(),0);assert.ok(await publish.isDisabled());await page.getByLabel('Anyone can read this record.',{exact:true}).check();assert.ok(await publish.isDisabled(),'Permanence consent is independently required');await page.getByLabel('I understand a public record cannot be fully erased later.',{exact:false}).check();assert.ok(await publish.isEnabled());}
   if(kind==='shop'||kind==='places'){await page.getByRole('alert').waitFor();await shot(kind+'-error');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator(kind==='shop'?'.gold-shop':'.place-messages .illustrated-empty').waitFor();assert.equal(attempts,2,'One safe read retry');}
   await shot(kind);
   if(width===390&&['profile-ready','staking','record-ready'].includes(kind)){
    await page.locator('dialog *').evaluateAll(els=>els.map(el=>[el,parseFloat(getComputedStyle(el).fontSize)]).filter(([el])=>el.matches('input,textarea,select')||[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim())).forEach(([el,size])=>el.style.setProperty('font-size',`${size*2}px`,'important')));await shot(kind+'-enlarged-text');
    await page.locator('dialog button').last().scrollIntoViewIfNeeded();await shot(kind+'-enlarged-actions');await page.setViewportSize({width,height:420});await shot(kind+'-keyboard-viewport');await page.setViewportSize({width,height});
   }
   assert.equal(await page.evaluate(()=>window.__secondaryActions?.length||0),0,'No confirmation or financial callback ran');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});await page.waitForTimeout(50);assert.ok(await page.locator('#fixture-open').evaluate(el=>el===document.activeElement),'Focus returns to the opener');await page.unroute('**/api/**');
  }
  assert.deepEqual(faults,[],'No component errors');report.viewports.push({name,width,height,faults,checks});writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));await context.close();console.log(name+': state fixtures passed');
 }
}finally{await browser?.close();await vite.close();}
