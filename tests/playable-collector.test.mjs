import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { collectorStep } from '../server/world-preparation/collector.mjs';
import { sha256 } from '../server/world-preparation/canonical.mjs';
const now=Date.parse('2026-11-07T12:00:00Z');
function setup(t){const root=mkdtempSync(resolve(tmpdir(),'ql-playable-collector-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const acq=resolve(root,'acquisition');mkdirSync(acq);const config={acquisitionDir:acq,workDir:resolve(root,'work'),daysDir:resolve(root,'days'),sourceCommit:'0'.repeat(40),minimumRegions:2};return {root,config};}
function addSource(config,id,lat,lng,country,n){
 const root=resolve(config.acquisitionDir,id);mkdirSync(root);let pbf=resolve(root,'source.pbf');writeFileSync(pbf,`Synthetic bulk fixture ${id}`);pbf=realpathSync(pbf);const receipt=resolve(root,'receipt.json');writeFileSync(receipt,JSON.stringify({sha256:sha256(readFileSync(pbf)),path:pbf,retrievedAt:`2026-11-06T00:00:0${n}Z`,sourceLastModified:'2026-11-06T00:00:00Z'}));
 const qp=resolve(config.acquisitionDir,'queue.json'),q=existsSync(qp)?JSON.parse(readFileSync(qp)):{jobs:{}};q.jobs[id]={state:'acquired',receipt};writeFileSync(qp,JSON.stringify(q));
 const indexp=resolve(config.acquisitionDir,'index-v1.json'),index=existsSync(indexp)?JSON.parse(readFileSync(indexp)):{features:[]};index.features.push({properties:{id,'iso3166-1:alpha2':[country]},geometry:{type:'Polygon',coordinates:[[[lng-1,lat-1],[lng+1,lat-1],[lng+1,lat+1],[lng-1,lat+1],[lng-1,lat-1]]]}});writeFileSync(indexp,JSON.stringify(index));
 const ring=[[lng-.001,lat-.001],[lng+.001,lat-.001],[lng+.001,lat+.001],[lng-.001,lat+.001],[lng-.001,lat-.001]],f=(i,g,tags)=>({type:'Feature',id:`osm:w${n*10+i}`,geometry:g,properties:{tags}});
 const values={pois:[f(1,{type:'MultiPolygon',coordinates:[[ring]]},{leisure:'park',name:`Fixture park ${id}`,access:'yes'})],paths:[f(2,{type:'LineString',coordinates:[[lng-.03,lat],[lng+.03,lat]]},{highway:'footway',access:'yes'})],exclusions:[]};const inputs={};for(const [role,features] of Object.entries(values)){inputs[role]=resolve(root,role+'.seq');writeFileSync(inputs[role],features.map(f=>JSON.stringify(f)+'\n').join(''));}return {pbf,inputs};
}
test('scheduled steps progress two source receipts into real polygons, runtime-checked quests and an immutable day',async t=>{
 const {config}=setup(t),a=addSource(config,'a',52.514,13.355,'DE',1),b=addSource(config,'b',40.731,-73.997,'US',2);
 const inputs=new Map([[a.pbf,a.inputs],[b.pbf,b.inputs]]),extract=async ({pbf})=>inputs.get(pbf),step=()=>collectorStep(config,{now,extract});
 for(let i=0;i<6;i++)await step();
 assert.equal(Object.keys(JSON.parse(readFileSync(resolve(config.workDir,'state.json'))).accepted).length,2,readFileSync(resolve(config.workDir,'state.json'),'utf8'));
 const manifestFile=resolve(config.daysDir,'2026-11-07/manifest.json'),first=readFileSync(manifestFile),manifest=JSON.parse(first);
 assert.equal(manifest.counts.zone,2);assert.equal(manifest.counts.quest,2);
 let state=JSON.parse(readFileSync(resolve(config.workDir,'state.json')));assert.equal(Object.keys(state.accepted).length,2);assert.equal(state.days['2026-11-07'].verified.visits,2);
 const c=addSource(config,'c',35.69,139.69,'JP',3);inputs.set(c.pbf,c.inputs);
 for(let i=0;i<3;i++)await step();
 state=JSON.parse(readFileSync(resolve(config.workDir,'state.json')));assert.equal(Object.keys(state.accepted).length,3);assert.deepEqual(readFileSync(manifestFile),first);
 await collectorStep(config,{now:Date.parse('2026-11-07T23:31:00Z'),extract});
 const tomorrow=JSON.parse(readFileSync(resolve(config.daysDir,'2026-11-08/manifest.json')));assert.equal(tomorrow.counts.zone,3);assert.deepEqual(readFileSync(manifestFile),first);
});
test('failed exclusions stay unavailable while another source advances, and recovery resumes',async t=>{
 const {config}=setup(t),a=addSource(config,'a',52.514,13.355,'DE',1),b=addSource(config,'b',40.731,-73.997,'US',2);writeFileSync(a.inputs.exclusions,'bad JSON\n');const inputs=new Map([[a.pbf,a.inputs],[b.pbf,b.inputs]]),extract=async ({pbf})=>inputs.get(pbf);
 for(let i=0;i<6;i++)await collectorStep(config,{now,extract});
 let s=JSON.parse(readFileSync(resolve(config.workDir,'state.json')));assert.equal(Object.keys(s.accepted).length,1);assert.equal(existsSync(resolve(config.daysDir,'2026-11-07/manifest.json')),false);assert.match(Object.values(s.sources).find(s=>s.id==='a').error,/Malformed/);
 writeFileSync(a.inputs.exclusions,'');for(let i=0;i<3;i++)await collectorStep(config,{now:now+300000,extract});
 s=JSON.parse(readFileSync(resolve(config.workDir,'state.json')));assert.equal(Object.keys(s.accepted).length,2);assert.equal(s.days['2026-11-07'].state,'prepared');
});

test('a corrupt published day is reported incomplete and cannot prevent tomorrow from preparing',async t=>{
 const {config}=setup(t),a=addSource(config,'a',52.514,13.355,'DE',1),b=addSource(config,'b',40.731,-73.997,'US',2),inputs=new Map([[a.pbf,a.inputs],[b.pbf,b.inputs]]),extract=async ({pbf})=>inputs.get(pbf);
 for(let i=0;i<6;i++)await collectorStep(config,{now,extract});
 const file=resolve(config.daysDir,'2026-11-07/manifest.json');const manifest=JSON.parse(readFileSync(file));writeFileSync(resolve(config.daysDir,'2026-11-07',manifest.regions[0].public.path),'corrupt');
 const state=await collectorStep(config,{now:Date.parse('2026-11-07T23:31:00Z'),extract});assert.equal(state.days['2026-11-07'].state,'incomplete');assert.equal(state.days['2026-11-08'].state,'prepared');assert.equal(readFileSync(resolve(config.daysDir,'2026-11-07',manifest.regions[0].public.path),'utf8'),'corrupt');
});

test('receipt corruption fails before extraction and concurrent steps cannot acquire the same worker',async t=>{
 const {config}=setup(t),a=addSource(config,'a',52.514,13.355,'DE',1);writeFileSync(a.pbf,'changed source');let called=false;
 let state=await collectorStep(config,{now,extract:async()=>{called=true;return a.inputs;}});assert.equal(called,false);assert.match(Object.values(state.sources)[0].error,/hash mismatch/);
 writeFileSync(a.pbf,'Synthetic bulk fixture a');let started;const entered=new Promise(r=>started=r);let finish;const blocked=new Promise(r=>finish=r);
 const running=collectorStep(config,{now:now+300000,extract:async()=>{started();await blocked;return a.inputs;}});await entered;
 await assert.rejects(collectorStep(config,{now:now+300000,extract:async()=>a.inputs}),/locked|another|active|running/i);finish();state=await running;assert.equal(Object.values(state.sources)[0].stage,'plan');
});

test('resource pressure reports a resumable wait without creating a false prepared day',async t=>{
 const {config}=setup(t);let called=false;
 const state=await collectorStep(config,{now,extract:async()=>{called=true;},resourceCheck:()=>({ready:false,reason:'process-headroom',headroom:10})});
 assert.equal(called,false);assert.equal(state.resourceWait.reason,'process-headroom');
 assert.equal(JSON.parse(readFileSync(resolve(config.workDir,'status.json'))).phase,'waiting-resources');
 assert.equal(existsSync(resolve(config.daysDir,'2026-11-07/manifest.json')),false);
});
