import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('collector timeout recovery preserves inputs, bounds repeated failures and respects another writer',()=>{
 const source=String.raw`
import importlib.util,json,pathlib,tempfile,os
spec=importlib.util.spec_from_file_location('supervisor','output/qa/global-release/runtime-20261107/run-playable-step.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp);plan=root/'plan.json';plan.write_text(json.dumps({'plans':[{'id':'a'},{'id':'b'}]}));pid=2000000000
 def setup(attempts=1,lockpid=pid):
  (root/'.prepare.lock').write_text(json.dumps({'pid':lockpid}));(root/'status.json').write_text(json.dumps({'at':'2026-11-07T17:00:00Z','phase':'regions','source':'pilot'}))
  state={'sources':{'pilot':{'id':'pilot','stage':'regions','attempts':attempts,'cursor':0,'plan':str(plan)}},'accepted':{'earlier':{'hash':'preserved'}},'days':{'published':'preserved'}}
  (root/'state.json').write_text(json.dumps(state));return (root/'state.json').read_bytes()
 def current():return json.loads((root/'state.json').read_text())
 setup();assert m.record_interruption(root,'time-slice',0,pid,now=100)
 s=current();assert s['sources']['pilot']['cursor']==0 and s['sources']['pilot']['nextAttempt']==220000 and s['accepted']=={'earlier':{'hash':'preserved'}} and s['days']=={'published':'preserved'}
 before=(root/'state.json').read_bytes();assert m.record_interruption(root,'time-slice',0,pid,now=200) is None;assert before==(root/'state.json').read_bytes()
 setup(3);m.record_interruption(root,'time-slice',0,pid,now=100);s=current()['sources']['pilot'];assert s['cursor']==1 and s['attempts']==0 and s['rejected'][0]['plan']=='a';assert plan.exists()
 setup(3);m.record_interruption(root,'resource-floor',0,pid,now=100);s=current()['sources']['pilot'];assert s['cursor']==0 and s['attempts']==2 and 'rejected' not in s
 for kwargs in [{'attempts':0},{'lockpid':os.getpid()}]:
  before=setup(**kwargs);assert m.record_interruption(root,'time-slice',0,pid,now=100) is None;assert before==(root/'state.json').read_bytes()
 before=setup();assert m.record_interruption(root,'time-slice',9999999999,pid,now=100) is None;assert before==(root/'state.json').read_bytes()
 assert not (root/'.prepare.lock.recovery').exists()
print('passed')
`;
 assert.equal(execFileSync('python3',['-B','-c',source],{encoding:'utf8'}).trim(),'passed');
});
