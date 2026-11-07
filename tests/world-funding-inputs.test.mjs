import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('funding input sync verifies exact finalized receipts, rejects incomplete money and never double-counts replay',()=>{
 const source=String.raw`
import importlib.util,json
spec=importlib.util.spec_from_file_location('sync','output/qa/global-release/runtime-20261107/sync-world-funding.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ref={'hash':'synthetic-transaction','signerId':'owner.testnet'}
def receipt(executor,source='realized_yield',amount='100000000000000000000000000000001'):
 return {'id':'synthetic-receipt','block_hash':'synthetic-block','outcome':{'executor_id':executor,'status':{'SuccessValue':''},'logs':['EVENT_JSON:'+json.dumps({'standard':'questlayer_rewards','event':'funded','data':[{'sender':'vault.testnet','receipt_id':'vault-1','source':source,'amount':amount}]})]}}
tx={'transaction':{'hash':ref['hash'],'signer_id':ref['signerId']},'status':{'SuccessValue':''},'receipts_outcome':[receipt('evil.testnet'),receipt(m.REWARDS)]}
p=m.funding_events(tx,ref,lambda _:12);assert len(p)==1 and p[0]['source']=='realized_yield'
n=int(p[0]['amountYocto']);treasury={'funded':str(n),'coins':{'available':str(n//2-7),'reserved':'5','awarded':'2'},'zones':{'available':str(n-n//2),'reserved':'0','awarded':'0'}}
assert len(m.reconcile(p+p,treasury))==1
for bad in ['1.5','-1','01',12,True,str(2**128)]:
 try:m.amount(bad);raise RuntimeError('Invalid money accepted')
 except AssertionError:pass
for variant in [{**tx,'status':{'Failure':{}}},{**tx,'transaction':{**tx['transaction'],'signer_id':'evil.testnet'}},{**tx,'receipts_outcome':[receipt(m.REWARDS,'yield')]}]:
 try:m.funding_events(variant,ref,lambda _:12);raise RuntimeError('Unconfirmed or incompatible source accepted')
 except AssertionError:pass
try:m.reconcile(p,{**treasury,'funded':str(n+1)});raise RuntimeError('Missing income accepted')
except AssertionError:pass
try:m.reconcile(p,[treasury]);raise RuntimeError('Wrong treasury shape accepted')
except (AssertionError,TypeError):pass
changed={**p[0],'amountYocto':str(n+1)}
try:m.reconcile(p+[changed],treasury);raise RuntimeError('Conflicting source accepted')
except AssertionError:pass
print('passed')
`;
 assert.equal(execFileSync('python3',['-B','-c',source],{encoding:'utf8'}).trim(),'passed');
});
