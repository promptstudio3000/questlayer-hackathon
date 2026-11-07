import { readFileSync } from 'node:fs';
import { collectorStep } from '../server/world-preparation/collector.mjs';
if(process.argv.length!==3)throw Error('Use continue-playable-world.mjs <isolated-config.json>.');
const config=JSON.parse(readFileSync(process.argv[2]));
const steps=config.maxStepsPerRun??1;
if(!Number.isSafeInteger(steps)||steps<1||steps>100)throw Error('maxStepsPerRun must be 1 to 100.');
const deadline=Date.now()+15*60*1000;
for(let i=0;i<steps&&Date.now()<deadline;i++) {
  const state=await collectorStep(config);
  if(state.resourceWait)break;
  // Backoff belongs to the persistent scheduler. Never poll waiting jobs in
  // a tight loop or keep a model running to advance deterministic stages.
  if(!Object.values(state.sources).some(s=>s.stage!=='finished'&&s.nextAttempt<=Date.now()))break;
}
