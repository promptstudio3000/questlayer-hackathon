// One deterministic background step: acquire receipts -> playable content.
// Explicit directories only; no production defaults, deploys, keys or model calls.
import { existsSync, readFileSync, mkdirSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bbox, bboxPolygon, booleanIntersects, feature } from '@turf/turf';
import { FILTERS, EXTRACT_VERSION } from '../../scripts/poi/extract-osm.mjs';
import { planSourceRegions, exportGeographyRegion, EXPORT_POLICY } from './export.mjs';
import { globalCoverage } from './coverage.mjs';
import { readLaunchScope, launchOwnerFilter } from './launch-scope.mjs';
import { buildSourceIndex } from './source-index.mjs';
import { sourceContexts, overlapsBounds } from './source-context.mjs';
import { auditFilteredGeometry, quarantineGeometry } from './source-audit.mjs';
import { prepareGeographicDay } from './geography.mjs';
import { verifyPreparedActivities } from './verify-activities.mjs';
import { canonical, digest, requireValue, sha256 } from './canonical.mjs';
import { atomicFile, immutableFile, lockDirectory, inputFile } from './storage.mjs';

export const COLLECTOR_POLICY = 'playable-global-source-collector/1';
// libosmium otherwise sizes its pool from the host CPU count, which can
// exhaust a constrained container's task quota. Never inherit an unsafe size.
const OSMIUM_ENV = {...process.env,OSMIUM_POOL_THREADS:'2'};
const ROLES = ['pois','paths','exclusions'];
const date = now => new Date(now).toISOString().slice(0,10);
const nextDate = now => date(now + 86400000);
const read = p => JSON.parse(readFileSync(p));
const write = (p,v) => atomicFile(p,Buffer.from(canonical(v)));
async function hashFile(file) { const h=createHash('sha256'); for await(const b of createReadStream(file))h.update(b);return h.digest('hex'); }
const resources = root => {
  // Production scheduling checks are enforced by the scoped host wrapper too.
  const p='/sys/fs/cgroup/pids.current',limit='/sys/fs/cgroup/pids.max';
  if(existsSync(p)&&existsSync(limit)&&readFileSync(limit,'utf8').trim()!=='max'){
    const tasks=Number(readFileSync(p)),maximum=Number(readFileSync(limit)),headroom=maximum-tasks;
    if(headroom<24)return {ready:false,reason:'process-headroom',tasks,maximum,headroom};
  }
  return {ready:true};
};
function sourceCountries(properties,all) {
  const seen=new Set();let p=properties;
  while(p&&!seen.has(p.id)){seen.add(p.id);if(p['iso3166-1:alpha2']?.length)return p['iso3166-1:alpha2'];p=all.get(p.parent);}
  return [];
}
export async function extractPlayableSource({pbf,sha,root,osmium='osmium'}) {
  mkdirSync(root,{recursive:true}); const outputs={};
  for(const role of ROLES){
    const file=resolve(root,`${role}.geojsonseq`), marker=file+'.receipt.json';outputs[role]=file;
    // Broader grounds context uses the existing safety taxonomy. In particular
    // private-access areas must not disappear because they are not named POIs.
    const filters=role==='exclusions'?[...FILTERS.exclusions,'wr/access','wr/foot','wr/amenity','wr/leisure','wr/building=church,chapel,cathedral,mosque,synagogue,temple,shrine,basilica','wr/railway']:role==='paths'?['w/highway']:FILTERS[role];
    const attributes='type,id,version,timestamp';
    const auditCode=digest(['./source-audit.mjs','../poi/safety.mjs','../../scripts/poi/audit-geometry.py'].map(path=>[path,sha256(readFileSync(new URL(path,import.meta.url)))]));
    const binding=digest({sha,filters,version:EXTRACT_VERSION,policy:COLLECTOR_POLICY,attributes,auditCode,geometryErrors:'fail-closed'});
    if(existsSync(marker)&&read(marker).binding===binding){requireValue(read(marker).sha256===await hashFile(file),'Extract checkpoint checksum mismatch.');requireValue(read(marker).geometryAudit===await hashFile(resolve(root,`${role}.geometry-audit.json`)),'Geometry audit checkpoint mismatch.');continue;}
    const filtered=resolve(root,`${role}.filtered.pbf`),part=file+'.part';
    execFileSync(osmium,['tags-filter',pbf,...filters,'-o',filtered,'--overwrite','--no-progress'],{env:OSMIUM_ENV,stdio:['ignore','ignore','pipe'],maxBuffer:65536,timeout:600000});
    let geometryInput=filtered;
    const audit=role==='paths'?{schema:'questlayer.geometry-reference-audit/1',incompleteAreas:[]}:await auditFilteredGeometry({osmium,pbf:filtered});
    const quarantined=quarantineGeometry(audit);
    write(resolve(root,`${role}.geometry-audit.json`),{...audit,...quarantined});
    if(quarantined.rejected.length) {
      geometryInput=resolve(root,`${role}.geometry-checked.pbf`);
      execFileSync(osmium,['removeid',filtered,...quarantined.rejected.map(r=>r.id.slice(4)),'-o',geometryInput,'--overwrite','--no-progress'],{env:OSMIUM_ENV,stdio:['ignore','ignore','pipe'],maxBuffer:65536,timeout:600000});
    }
    execFileSync(osmium,['export',geometryInput,'-f','geojsonseq','-x','print_record_separator=false','--attributes',attributes,`--geometry-types=${role==='paths'?'linestring':role==='exclusions'?'polygon':'point,linestring,polygon'}`,'-i',`sparse_file_array,${root}/${role}.idx`,'-o',part,'--overwrite','--no-progress','--stop-on-error'],{env:OSMIUM_ENV,stdio:['ignore','ignore','pipe'],maxBuffer:65536,timeout:600000});
    // Retain intermediates on failure; this extractor never touches raw sources.
    renameSync(part,file);write(marker,{binding,sha256:await hashFile(file),geometryAudit:await hashFile(resolve(root,`${role}.geometry-audit.json`))});
    // Only our reproducible intermediate/index files; all source and exported
    // geography is retained. Failed stages leave evidence in this directory.
    for(const temp of [...(quarantined.rejected.length?[]:[filtered]),`${root}/${role}.idx`])if(existsSync(temp))unlinkSync(temp);
  }
  return outputs;
}
function receiptPath(root,path){const base=realpathSync(root),rel=relative(base,realpathSync(path));requireValue(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../'),'Acquisition receipt must stay in its isolated root.');return inputFile(base,rel);}

export async function collectorStep(config,{now=Date.now(),extract=extractPlayableSource,resourceCheck=resources,prepareOnly=false}={}) {
  const {acquisitionDir,workDir,daysDir,sourceCommit}=config;
  requireValue([acquisitionDir,workDir,daysDir].every(p=>typeof p==='string'&&isAbsolute(p))&&/^[a-f0-9]{40}$/.test(sourceCommit),'Explicit isolated directories and source commit required.');
  const release=lockDirectory(workDir),stateFile=resolve(workDir,'state.json');
  const state=existsSync(stateFile)?read(stateFile):{policy:COLLECTOR_POLICY,sources:{},accepted:{},days:{}};
  requireValue(state.policy===COLLECTOR_POLICY,'Use an isolated work directory for the current collector policy.');
  const save=()=>write(stateFile,state), report=(phase,extra={})=>write(resolve(workDir,'status.json'),{policy:COLLECTOR_POLICY,at:new Date(now).toISOString(),phase,financialActivation:false,...extra});
  try{
    const availability=resourceCheck(workDir);
    if(!availability.ready){state.resourceWait=availability;save();report('waiting-resources',availability);return state;}
    delete state.resourceWait;
    const q=read(resolve(acquisitionDir,'queue.json')),indexBytes=readFileSync(resolve(acquisitionDir,'index-v1.json')),index=JSON.parse(indexBytes),all=new Map(index.features.map(f=>[f.properties.id,f.properties]));
    const sourceFeatures=new Map(index.features.map(f=>[f.properties.id,f]));
    const launchScope=config.launchScopeFile?readLaunchScope(config.launchScopeFile,indexBytes):null;
    const selectedSources=launchScope?new Set(launchScope.sources.map(s=>s.id)):null;
    const activeKeys=new Set();
    for(const [id,job] of Object.entries(q.jobs).filter(([,j])=>j.state==='acquired')){
      if(selectedSources&&!selectedSources.has(id))continue;
      const receipt=read(receiptPath(acquisitionDir,job.receipt)),key=digest({id,sha:receipt.sha256,policy:COLLECTOR_POLICY});
      activeKeys.add(key);
      state.sources[key]??={id,key,receipt:job.receipt,stage:'extract',steps:0,attempts:0,nextAttempt:0,acquiredAt:receipt.retrievedAt};
    }
    save();
    const contextSources=Object.entries(state.sources).filter(([key,s])=>activeKeys.has(key)&&s.indexFile&&sourceFeatures.has(s.id)).map(([,s])=>s).map(s=>({id:s.id,indexFile:s.indexFile,geometry:sourceFeatures.get(s.id).geometry})).sort((a,b)=>a.id.localeCompare(b.id));
    const contextHash=digest({sources:contextSources.map(s=>[s.id,s.indexFile]),launchScope:launchScope?.hash??null});
    const neighborhoodContexts=sourceContexts(contextSources,launchScope?.hash??null);
    const currentContext=id=>neighborhoodContexts.get(id)?.hash??null;
    // A newly indexed neighbor can supply missing paths/grounds or mapped
    // cells across an extract edge. Replan unpublished coverage explicitly.
    for(const source of Object.values(state.sources)) if(activeKeys.has(source.key)&&source.indexFile&&source.contextHash!==currentContext(source.id)&&source.stage!=='extract') {
      source.stage='plan';source.nextAttempt=0;source.attempts=0;source.contextHash=currentContext(source.id);
    }
    // Finish the first candidate of an already started source before opening
    // more expensive extractions. Then rotate to untouched sources, rather
    // than exhausting one country's complete owner inventory first.
    const bootstrap=s=>s.steps>0&&s.steps<3?0:1;
    const jobs=Object.entries(state.sources).filter(([key,s])=>activeKeys.has(key)&&s.stage!=='finished'&&s.nextAttempt<=now).map(([,s])=>s).sort((a,b)=>bootstrap(a)-bootstrap(b)||a.steps-b.steps||a.acquiredAt.localeCompare(b.acquiredAt)||a.id.localeCompare(b.id));
    // Keep playable exports advancing while acquisitions add new sources.
    // Three turns favor ready indexed work, one favors a new extraction.
    const readyJobs=jobs.filter(s=>s.stage!=='extract'),extractJobs=jobs.filter(s=>s.stage==='extract');
    const turn=state.workTurns??0;
    const s=prepareOnly?null:((turn%4===0?extractJobs[0]:readyJobs[0])??readyJobs[0]??extractJobs[0]);
    if(s){
      state.workTurns=turn+1;
      const root=resolve(workDir,'sources',s.key);mkdirSync(root,{recursive:true});s.steps++;s.attempts++;save();
      report(s.stage,{source:s.id});
      const previousStage=s.stage;
      try{
        const receipt=read(receiptPath(acquisitionDir,s.receipt));
        if(s.stage==='extract'){
          const pbf=receiptPath(acquisitionDir,receipt.path);requireValue(await hashFile(pbf)===receipt.sha256,'Bulk source receipt hash mismatch.');
          const inputs=await extract({pbf,sha:receipt.sha256,root:resolve(root,'extract')});
          requireValue(inputs&&ROLES.every(r=>typeof inputs[r]==='string'&&existsSync(inputs[r])),'Extractor omitted a geometry companion.');
          const provenance={pbfSha256:receipt.sha256,roles:Object.fromEntries(await Promise.all(ROLES.map(async role=>[role,existsSync(resolve(root,'extract',`${role}.geometry-audit.json`))?await hashFile(resolve(root,'extract',`${role}.geometry-audit.json`)):null])))};
          const index=await buildSourceIndex({inputs,outputDir:resolve(root,'spatial-index'),provenance});
          s.inputs=inputs;s.indexFile=index.file;s.stage='plan';
        }else if(s.stage==='plan'){
          const neighbors=neighborhoodContexts.get(s.id).sources.filter(n=>n.id!==s.id);
          const result=await planSourceRegions({pois:s.inputs.pois,sourceGeometry:sourceFeatures.get(s.id)?.geometry,sourceIndexFile:s.indexFile,neighbors,selectOwner:launchOwnerFilter(launchScope,s.id)});
          const version=digest({index:s.indexFile,contextHash:s.contextHash});s.plan=resolve(root,'plans',version+'.json');
          immutableFile(s.plan,Buffer.from(canonical(result)));s.planVersion=version;s.planContextHash=s.contextHash;s.plannedRegions=result.plans.length;s.omittedRegions=result.omitted.length;s.cursor=0;s.stage='regions';
        }else{
          const plan=read(s.plan).plans[s.cursor];
          if(!plan){s.stage='finished';}
          else{
            const countries=launchScope?.sources.find(p=>p.id===s.id)?.countries??sourceCountries(all.get(s.id),all);requireValue(countries.length,'Source lacks country attribution; needs explicit upstream mapping.');
            const outputDir=resolve(root,'regions',plan.id,s.planVersion),candidate=resolve(outputDir,'candidate',date(now));
            const contexts=plan.sections.map(p=>p.contextBounds),bounds=[Math.min(...contexts.map(b=>b[0])),Math.min(...contexts.map(b=>b[1])),Math.max(...contexts.map(b=>b[2])),Math.max(...contexts.map(b=>b[3]))];
            const sourceIndexFiles=neighborhoodContexts.get(s.id).sources.filter(n=>overlapsBounds(bounds,n.bounds)&&booleanIntersects(bboxPolygon(bounds),feature(n.geometry))).map(n=>n.indexFile);
            const result=await exportGeographyRegion({inputs:s.inputs,outputDir:resolve(outputDir,'export'),plan,countries,sourceDate:receipt.sourceLastModified,sourceCommit,sourceIndexFiles});
            const built=await prepareGeographicDay({catalogFile:result.catalogFile,outputDir:candidate,day:date(now)});
            requireValue(built.state==='content-prepared','Region content preparation incomplete.');
            const verified=verifyPreparedActivities(resolve(candidate,date(now),'manifest.json'));
            // Existing owner identities are reused, never another set per source.
            const previous=state.accepted[plan.id];
            if(!previous||previous.contextHash!==currentContext(previous.source)||s.id<=previous.source)state.accepted[plan.id]={owner:plan.id,source:s.id,catalogFile:result.catalogFile,counts:built.counts,availability:built.counts.quest?'playable':'no-safe-mapped-objectives',coverage:'all-mapped-candidate-cells',contextHash:s.contextHash,verified,acceptedAt:new Date(now).toISOString()};
            write(resolve(outputDir,'acceptance.json'),{counts:built.counts,verified,day:date(now),catalogFile:result.catalogFile});
            s.cursor++;s.attempts=0;if(s.cursor>=read(s.plan).plans.length)s.stage='finished';
          }
        }
        if(s.stage!==previousStage)s.attempts=0;
        s.nextAttempt=0;delete s.error;save();
      }catch(error){s.error=error.message;s.nextAttempt=now+Math.min(3600000,60000*2**Math.min(s.attempts,6));
        // A failed bounded region must not starve the remaining global queue.
        if(s.stage==='regions'&&s.attempts>=3){s.rejected??=[];s.rejected.push({plan:read(s.plan).plans[s.cursor]?.id,reason:error.message});s.cursor++;s.attempts=0;}
        save();report('retry',{source:s.id,stage:s.stage,reason:error.message});
      }
    }
    const coverage=globalCoverage({index,indexBytes,queue:q,state,activeKeys,contextHash,sourceContexts:neighborhoodContexts,approvedInventorySha256:config.globalInventorySha256,launchScope});
    write(resolve(workDir,'coverage.json'),coverage);
    const accepted=Object.values(state.accepted).filter(a=>a.contextHash===currentContext(a.source)&&(!selectedSources||selectedSources.has(a.source))&&launchOwnerFilter(launchScope,a.source)(a.owner)).sort((a,b)=>a.owner.localeCompare(b.owner));
    const targets=[date(now),...(new Date(now).getUTCHours()*60+new Date(now).getUTCMinutes() >= (config.nextDayMinuteUTC??1410)?[nextDate(now)]:[])];
    for(const day of targets){
      try {
      const file=resolve(daysDir,day,'manifest.json');
      if(existsSync(file)){const manifest=read(file);requireValue(manifest.epoch.day===day,'Published epoch differs from directory.');const verified=verifyPreparedActivities(file);state.days[day]={state:'prepared',inputHash:manifest.inputHash,counts:manifest.counts,verified};continue;}
      if(accepted.length<(config.minimumRegions??1)||!accepted.some(a=>a.counts.zone>0))continue;
      requireValue(!config.requireGlobalCoverage||coverage.globalReadyForContent,'Global source inventory is incomplete; refusing a partial-world release.');
      requireValue(!config.requireSelectedScopeCoverage||coverage.selectedScopeReadyForContent,'Selected launch footprint is incomplete; refusing activation.');
      const frozen=resolve(workDir,'days',day);mkdirSync(frozen,{recursive:true});
      let catalogFile=resolve(frozen,'catalog.json');
      if(!existsSync(catalogFile)){
        const regions=[];
        for(const entry of accepted){
          const c=read(entry.catalogFile),d=structuredClone(c.regions[0]);
          for(const part of d.sections||[d]) for(const role of ROLES){const ref=part.inputs[role],bytes=readFileSync(inputFile(dirname(entry.catalogFile),ref.file)),hash=sha256(bytes),relativeFile=`inputs/${hash}.geojsonseq${ref.file.endsWith('.gz')?'.gz':''}`;immutableFile(resolve(frozen,relativeFile),bytes);part.inputs[role]={file:relativeFile,sha256:hash};}
          regions.push(d);
        }
        immutableFile(catalogFile,Buffer.from(canonical({schema:'questlayer.geography-catalog/1',sourceCommit,version:`${COLLECTOR_POLICY}:${digest(regions)}`,closures:[],recentPoiIds:[],regions})));
      }
      const staging=resolve(frozen,'build');
      const built=await prepareGeographicDay({catalogFile,outputDir:staging,day});requireValue(built.state==='content-prepared','Aggregate day incomplete.');
      requireValue(built.counts.zone>0&&built.counts.quest>0,'Aggregate has no playable polygon objectives.');
      const verified=verifyPreparedActivities(resolve(staging,day,'manifest.json'));
      mkdirSync(daysDir,{recursive:true});requireValue(!existsSync(resolve(daysDir,day)),'Refusing to replace an existing published day.');
      renameSync(resolve(staging,day),resolve(daysDir,day));
      state.days[day]={state:'prepared',inputHash:built.inputHash,counts:built.counts,verified};save();
      } catch(error) {
        state.days[day]={state:'incomplete',reason:error.message};save();
      }
    }
    save();report('waiting-next-step',{sources:Object.keys(state.sources).length,acceptedRegions:accepted.length,days:state.days,queued:jobs.length,failedSources:Object.values(state.sources).filter(s=>s.error).map(s=>({id:s.id,stage:s.stage,reason:s.error})),coverage:{status:coverage.status,inventoryVerified:coverage.inventoryVerified,expectedSources:coverage.expectedSources,summary:coverage.summary,acceptedOwners:coverage.acceptedOwners}});
    return state;
  }finally{release();}
}
