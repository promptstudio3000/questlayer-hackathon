// Explicit global inventory accounting. A list of several ready regions must
// never masquerade as the full approved world source snapshot.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { sha256 } from './canonical.mjs';

export function globalCoverage({index,indexBytes,queue,state,activeKeys,contextHash,sourceContexts=null,approvedInventorySha256,launchScope=null}) {
  const expectedContext=id=>sourceContexts?sourceContexts.get(id)?.hash:contextHash;
  const acceptedCurrent=a=>a&&a.contextHash===expectedContext(a.source)&&a.coverage==='all-mapped-candidate-cells';
  const parents=new Set(index.features.map(f=>f.properties.parent)),allExpected=index.features.filter(f=>f.properties.urls?.pbf&&!parents.has(f.properties.id)).map(f=>f.properties.id).sort();
  const expected=launchScope?launchScope.sources.map(s=>s.id):allExpected;
  const byId=new Map(Object.entries(state.sources).filter(([key])=>activeKeys.has(key)).map(([,s])=>[s.id,s]));
  const owners=new Set(),missingOwners=new Set(),sources=[],summary={awaitingSource:0,indexing:0,planning:0,missingContext:0,preparingRegions:0,complete:0};
  const inventorySha256=sha256(indexBytes),inventoryVerified=!!approvedInventorySha256&&approvedInventorySha256===inventorySha256&&allExpected.length>=100;
  for(const id of expected) {
    const job=queue.jobs[id],source=byId.get(id);let phase='awaitingSource',planned=null,omitted=null;
    if(job?.state==='acquired') {
      phase=!source?.indexFile?'indexing':!source.plan||source.planContextHash!==expectedContext(id)?'planning':'preparingRegions';
      if(source?.plan&&source.planContextHash===expectedContext(id)&&existsSync(source.plan)&&statSync(source.plan).size<=64*1024*1024) {
        const plan=JSON.parse(readFileSync(source.plan));planned=plan.plans.length;omitted=plan.omitted.length;
        for(const entry of [...plan.plans,...plan.omitted])owners.add(entry.id);
        for(const entry of plan.omitted)missingOwners.add(entry.id);
        const unfinished=plan.plans.filter(p=>!acceptedCurrent(state.accepted[p.id]));
        phase=omitted?'missingContext':unfinished.length?'preparingRegions':'complete';
      }
    }
    summary[phase]++;sources.push({id,phase,plannedOwners:planned,omittedOwners:omitted,...(source?.error?{error:'source-processing-failed'}:{})});
  }
  const full=inventoryVerified&&expected.length>0&&summary.complete===expected.length&&(!launchScope||(!launchScope.unmappedCapitals.length&&!launchScope.unmappedCountries?.length));
  return {schema:'questlayer.global-content-coverage/1',inventorySha256,inventoryVerified,scope:launchScope?'selected-launch-footprint':'whole-source-inventory',selection:launchScope?.selection??null,includedCountries:launchScope?.includedCountries??[],unmappedCountries:launchScope?.unmappedCountries??[],launchScopeHash:launchScope?.hash??null,unmappedCapitals:launchScope?.unmappedCapitals??[],globalReadyForContent:full&&!launchScope,selectedScopeReadyForContent:full,status:full?'complete':'incomplete',expectedSources:expected.length,summary,discoveredOwners:owners.size,ownersWithMissingContext:missingOwners.size,acceptedOwners:Object.values(state.accepted).filter(a=>expected.includes(a.source)&&acceptedCurrent(a)).length,sources,fieldReview:'unverified',financialActivation:false};
}
