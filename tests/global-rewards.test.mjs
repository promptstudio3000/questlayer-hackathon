import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {latLngToCell,gridDisk} from 'h3-js';
import {openDatabase,createPlayer} from '../server/database.mjs';
import {claimQuest} from '../server/game.mjs';
import {installGlobalActivityDay} from '../server/global-activities.mjs';
import {prepareGeographicDay,GEOGRAPHY_SCHEMA} from '../server/world-preparation/geography.mjs';
import {ownerCell} from '../server/world-preparation/schema.mjs';
import {canonical,digest,sha256} from '../server/world-preparation/canonical.mjs';
import {availableFunding,allocateExactZones,decimalAmount} from '../server/map-rewards/global-plan.mjs';
import {activateGlobalRewards,globalRewardReceipt,globalEarnedTotals,prepareGlobalPayout,confirmGlobalConversion,formatYoctoNear} from '../server/global-rewards.mjs';
import {runGlobalRewardWorker,fundingEvents} from '../server/global-reward-worker.mjs';
import {NETWORK} from '../server/native/network.mjs';
const financialTest=(name,fn)=>test(NETWORK==='testnet'?name:`mainnet refuses testnet-only flow: ${name}`,NETWORK==='testnet'?fn:async()=>{
 assert.throws(()=>activateGlobalRewards(null,{},null,{contractId:'rewards.testnet'}),/reviewed testnet contract/);
 await assert.rejects(runGlobalRewardWorker(null,{contractId:'rewards.testnet'}),/testnet-only/);
});

test('received funding accounts for every prior bucket obligation and never treats a cap as income',()=>{
 const receipts=[{id:'sponsor-proof',source:'sponsor',amountYocto:'100',finalized:true,blockHeight:1},{id:'yield-proof',source:'realized_yield',amountYocto:'20',finalized:true,blockHeight:2}];
 const treasury={funded:'120',coins:{available:'15',reserved:'30',awarded:'15'},zones:{available:'40',reserved:'20',awarded:'0'}};
 const lots=availableFunding({receipts,treasury});assert.deepEqual(lots.map(l=>[l.source,l.coins,l.zones]),[['sponsor',5n,30n],['realized_yield',10n,10n]]);
 assert.throws(()=>availableFunding({receipts:receipts.slice(0,1),treasury}),/inventory does not reconcile/);
 assert.throws(()=>decimalAmount(100),/decimal yocto/);assert.throws(()=>decimalAmount('1.0'),/decimal yocto/);
 assert.equal(formatYoctoNear('1000000000000000'),'0.000000001');
});

test('global zone allocation uses exact monetary integers while retaining cell and area caps',()=>{
 const cells=gridDisk(latLngToCell(52.51,13.35,7),6),budget='100000000000000000000000000000000000';
 const zones=cells.map((cell,i)=>({id:`zone-${i}`,questId:`quest-${i}`,cell}));
 const a=allocateExactZones({zones,budgetYocto:budget,seed:'fixed',potential:new Map(cells.map(c=>[c,50]))});
 assert.equal(a.objects.length,zones.length);assert.ok(a.objects.every(o=>BigInt(o.amountYocto)<=BigInt(budget)/100n));
 assert.ok(BigInt(a.totalYocto)<=BigInt(budget));assert.equal(BigInt(a.totalYocto)+BigInt(a.unallocatedYocto),BigInt(budget));
 assert.deepEqual(allocateExactZones({zones:zones.slice().reverse(),budgetYocto:budget,seed:'fixed',potential:new Map(cells.map(c=>[c,50]))}),a);
 assert.equal(allocateExactZones({zones,budgetYocto:'0',seed:'fixed'}).totalYocto,'0');
});

async function fixture(t){
 const root=mkdtempSync(resolve(tmpdir(),'ql-global-money-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const lat=52.514,lng=13.355,geometry={type:'Polygon',coordinates:[[[lng-.0012,lat-.0012],[lng+.0012,lat-.0012],[lng+.0012,lat+.0012],[lng-.0012,lat+.0012],[lng-.0012,lat-.0012]]]};
 const source=canonical({type:'FeatureCollection',features:[{type:'Feature',id:'osm:w1',geometry,properties:{tags:{leisure:'park',name:'Synthetic funding fixture',access:'yes'}}},{type:'Feature',id:'osm:w2',geometry:{type:'LineString',coordinates:[[lng-.01,lat],[lng+.01,lat]]},properties:{tags:{highway:'footway',access:'yes'}}}]});
 writeFileSync(resolve(root,'source.json'),source);
 const catalog={schema:GEOGRAPHY_SCHEMA,sourceCommit:'0'.repeat(40),version:'synthetic-money-fixture',closures:[],recentPoiIds:[],regions:[{id:ownerCell({lat,lng}),status:'complete',file:'source.json',sha256:sha256(source),countries:['DE'],coreBounds:[lng-.006,lat-.006,lng+.006,lat+.006],contextBounds:[lng-.04,lat-.04,lng+.04,lat+.04],sourceDate:'2026-11-05T00:00:00Z',coverageReason:'Synthetic test only.'}]};
 writeFileSync(resolve(root,'catalog.json'),canonical(catalog));const db=openDatabase(':memory:');t.after(()=>db.close());const plans=[];
 for(const [day,amount] of [['2026-11-08','5000000000000003'],['2026-11-09','5000000000000004']]){
  const outputDir=resolve(root,day),prepared=await prepareGeographicDay({catalogFile:resolve(root,'catalog.json'),outputDir,day});assert.equal(prepared.counts.zone,1);
  const file=resolve(outputDir,day,'manifest.json'),bytes=readFileSync(file),manifest=JSON.parse(bytes);installGlobalActivityDay(db,file);
  const row=db.prepare('SELECT * FROM global_reward_candidates WHERE day=?').get(day);assert.ok(row);
  const body={schema:'questlayer.global-rewards/1',epoch:manifest.epoch,contentHash:sha256(bytes),policy:'test-fixture',objects:[{id:row.object_id,questId:row.quest_id,cell:row.cell,bucket:'zones',amountYocto:amount}],budget:{coinsYocto:'0',zonesYocto:amount},funding:[{id:'mock-confirmed-funding',source:'sponsor',bucket:'zones',amountYocto:amount}]};
  const plan={...body,manifestHash:digest(body)},reservation={finalized:true,contractId:'rewards.testnet',codeHash:'reviewed-test-code',blockHash:'mock-final-block',view:{manifest_hash:plan.manifestHash,starts_at:String(manifest.epoch.startsAt),ends_at:String(manifest.epoch.endsAt),coins_reserved:'0',zones_reserved:amount,closed:false}};
  plans.push({plan,reservation,row});
 }
 return {db,plans};
}
const activationOptions={now:0,contractId:'rewards.testnet',codeHash:'reviewed-test-code'};

financialTest('only an exact pre-opening chain reservation activates the prepared financial objectives',async t=>{
 const {db,plans}=await fixture(t),{plan,reservation}=plans[0];
 assert.throws(()=>activateGlobalRewards(db,plan,{...reservation,view:{...reservation.view,zones_reserved:'1'}},activationOptions),/does not cover/);
 assert.throws(()=>activateGlobalRewards(db,plan,reservation,{...activationOptions,now:plan.epoch.startsAt+1}),/before the day opens/);
 activateGlobalRewards(db,plan,reservation,activationOptions);activateGlobalRewards(db,plan,reservation,{...activationOptions,now:plan.epoch.startsAt+100});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM global_reward_objects').get().n,1);
});

financialTest('GPS completion creates one exact shared entitlement; earned dust crosses days, accounts and conversion retries safely',async t=>{
 const {db,plans}=await fixture(t),player=createPlayer(db,'Money fixture'),other=createPlayer(db,'Second fixture');
 for(const {plan,reservation,row} of plans){
  activateGlobalRewards(db,plan,reservation,activationOptions);const q=db.prepare('SELECT * FROM quests WHERE id=?').get(row.quest_id),now=plan.epoch.startsAt+3600000,fix={lat:q.lat,lng:q.lng,accuracy:5,timestamp:now};
  assert.throws(()=>claimQuest(db,player,q.id,{...fix,lat:q.lat+.01},now),/closer|range/i);assert.equal(globalEarnedTotals(db,plan.epoch.day).zones,'0');
  const first=claimQuest(db,player,q.id,fix,now);assert.equal(first.result.reward.near.amountYocto,plan.budget.zonesYocto);assert.equal(first.reward,0);
  const repeat=claimQuest(db,player,q.id,fix,now);assert.equal(repeat.replayed,true);assert.equal(repeat.result.reward.near.amountYocto,plan.budget.zonesYocto);
  const second=claimQuest(db,other,q.id,fix,now);assert.equal(second.result.reward.near,undefined);assert.ok(second.xp>0);
 }
 assert.equal(prepareGlobalPayout(db,{day:'2026-11-10'}),null);
 db.prepare('INSERT INTO wallet_links VALUES(?,?,?)').run('alice.testnet',player,0);
 const payout=prepareGlobalPayout(db,{day:'2026-11-10'});assert.equal(payout.totalYocto,'10000000000000007');assert.equal(payout.publish.sources.length,2);
 assert.deepEqual(prepareGlobalPayout(db,{day:'2026-11-10'}),payout);
 const conversion={minter:'rewards.testnet',account_id:'alice.testnet',depositedYocto:payout.totalYocto,previousCarryYocto:'0',consumedYocto:'10000000000000000',carryYocto:'7',qgoldU:'10'};
 assert.equal(confirmGlobalConversion(db,{payoutId:payout.id,index:0,receiptId:'mock-final-mint',accountId:'alice.testnet',conversion}),true);
 assert.equal(confirmGlobalConversion(db,{payoutId:payout.id,index:0,receiptId:'mock-final-mint',accountId:'alice.testnet',conversion}),false);
 assert.equal(globalRewardReceipt(db,player,plans[0].row.quest_id).unconvertedYocto,'0');assert.equal(globalRewardReceipt(db,player,plans[1].row.quest_id).unconvertedYocto,'7');
 assert.equal(globalRewardReceipt(db,other,plans[0].row.quest_id),null);
});

financialTest('worker reconciles a lost reservation reply, exact GPS earnings, closure and durable conversion without a second reservation',async t=>{
 const {db,plans}=await fixture(t),epoch=plans[0].plan.epoch;let now=epoch.startsAt-3600000,world=null,payout=null,paid=false,lost=true;
 const calls=[],funding=[{id:'mock-funding',source:'sponsor',amountYocto:'1000000000000000000000000',finalized:true,blockHeight:1}];
 // Only one future day in this fixture; it must be complete before activation.
 db.prepare("UPDATE global_activity_days SET state='loading' WHERE day=?").run(plans[1].plan.epoch.day);
 const view=async(m,a)=>{
  if(m==='get_world_day')return world;
  if(m==='get_treasury')return {funded:funding[0].amountYocto,coins:{available:'500000000000000000000000',reserved:'0',awarded:'0'},zones:{available:'500000000000000000000000',reserved:'0',awarded:'0'}};
  if(m==='get_date_totals')return {cap:'100000000000000000000000',zones:'0',coins:'0'};
  if(m==='get_world_budget')return {version:1,network:'testnet',liquid_backing:'1000000000000000000000000'};
  if(m==='get_payout_day')return payout;
  if(m==='get_payout_progress')return {statuses:[paid?'paid':'unclaimed']};
  throw Error(`Unexpected ${m}`);
 };
 const call=async(m,a)=>{
  calls.push(m);
  if(m==='reserve_world_day'){world={manifest_hash:a.manifest_hash,starts_at:a.starts_at,ends_at:a.ends_at,coins_reserved:a.coins_yocto,zones_reserved:a.zones_yocto,coins_earned:'0',zones_earned:'0',closed:false};if(lost){lost=false;throw Error('Lost reply after finalized reservation');}}
  else if(m==='record_world_earned'){world.coins_earned=a.coins_yocto;world.zones_earned=a.zones_yocto;}
  else if(m==='close_world_day')world.closed=true;
  else if(m==='move_world_to_payout')payout={root:a.root,leaves:a.leaves,coins_reserved:'0',zones_reserved:a.sources.reduce((n,s)=>n+BigInt(s.zones_yocto),0n).toString()};
  else if(m==='claim_payout')paid=true;
  else throw Error(`Unexpected ${m}`);
 };
 const options={view,call,clock:()=>now,contractId:'rewards.testnet',codeHash:'mock-code',fundingReceipts:async()=>funding,observe:async()=>({finalized:true,contractId:'rewards.testnet',codeHash:'mock-code',blockHash:'mock-final-block',view:world}),conversion:async()=>({minter:'rewards.testnet',account_id:'worker.testnet',depositedYocto:payout.zones_reserved,previousCarryYocto:'0',consumedYocto:payout.zones_reserved,carryYocto:'0',qgoldU:(BigInt(payout.zones_reserved)/10n**15n).toString()})};
 await assert.rejects(runGlobalRewardWorker(db,options),/Lost reply/);
 await runGlobalRewardWorker(db,options);assert.equal(calls.filter(m=>m==='reserve_world_day').length,1);
 const player=createPlayer(db,'Worker fixture'),q=db.prepare('SELECT * FROM quests WHERE id=?').get(plans[0].row.quest_id);now=epoch.startsAt+3600000;
 claimQuest(db,player,q.id,{lat:q.lat,lng:q.lng,accuracy:5,timestamp:now},now);
 db.prepare('INSERT INTO wallet_links VALUES(?,?,?)').run('worker.testnet',player,now);
 now=epoch.endsAt+16000;await runGlobalRewardWorker(db,options);assert.equal(world.closed,true);assert.equal(paid,true);
 assert.equal(globalRewardReceipt(db,player,q.id).state,'converted');
 await runGlobalRewardWorker(db,options);assert.equal(calls.filter(m=>m==='claim_payout').length,1);assert.equal(calls.filter(m=>m==='move_world_to_payout').length,1);
});

test('funding provenance comes only from successful Rewards receipts, with sponsor and yield kept separate',()=>{
 const log=source=>'EVENT_JSON:'+JSON.stringify({standard:'questlayer_rewards',event:'funded',data:[{source,sender:'vault.testnet',receipt_id:source,amount:'13'}]});
 const outcome={status:{SuccessValue:''},receipts_outcome:[{outcome:{executor_id:'rewards.testnet',status:{SuccessValue:''},logs:[log('yield'),log('sponsor')]}},{outcome:{executor_id:'mallory.testnet',status:{SuccessValue:''},logs:[log('sponsor')]}}]};
 assert.deepEqual(fundingEvents(outcome,{contractId:'rewards.testnet',blockHeight:7}).map(r=>r.source),['realized_yield','sponsor']);
 assert.throws(()=>fundingEvents({...outcome,status:{Failure:{}}},{contractId:'rewards.testnet',blockHeight:7}),/Finalized/);
});
