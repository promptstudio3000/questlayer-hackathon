// Explicit testnet activation only. The HTTP completion path never sends a
// transaction. Every await is fenced by the same durable worker lease.
import { randomUUID } from 'node:crypto';
import { atomic } from './database.mjs';
import { GPS_MAX_AGE_MS } from './domain.mjs';
import { NETWORK } from './native/network.mjs';
import { NativeContractReader } from './native/reader.mjs';
import { assertTestnetRpc } from './identity/near.mjs';
import { createNearProvider } from './near-provider.mjs';
import { claimersByCell } from './map-rewards/day-plan.mjs';
import { buildGlobalRewardPlan } from './map-rewards/global-plan.mjs';
import { utcEpoch } from './world-preparation/calendar.mjs';
import { canonical,requireValue } from './world-preparation/canonical.mjs';
import { ensureGlobalRewards,activateGlobalRewards,globalEarnedTotals,prepareGlobalPayout,confirmGlobalConversion } from './global-rewards.mjs';

export const WORLD_CHAIN_METHODS=Object.freeze(['reserve_world_day','record_world_earned','move_world_to_payout','close_world_day']);
const parse=JSON.parse;
const fundingHistory=new WeakMap();
export function globalRewardWorkerStatus(db){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_reward_worker'").get())return {state:'not-configured'};
  const row=db.prepare('SELECT last_success AS lastSuccess,last_error AS lastError FROM global_reward_worker WHERE id=1').get();
  return row?{state:row.lastError?'waiting':row.lastSuccess?'ready':'starting',...row}:{state:'not-configured'};
}

// This function accepts authoritative observations from the testnet adapter,
// or a fully isolated integration fixture. Configuration alone never activates
// a day. Publication, transfer, and payment are each reconciled independently.
export async function runGlobalRewardWorker(db,{view,observe,call,fundingReceipts,conversion,contractId,codeHash,clock=Date.now}){
  requireValue(NETWORK==='testnet'&&contractId?.endsWith('.testnet'),'Global financial activation is testnet-only.');
  ensureGlobalRewards(db);db.prepare('INSERT OR IGNORE INTO global_reward_worker(id) VALUES(1)').run();
  const owner=randomUUID();
  if(!atomic(db,()=>db.prepare('UPDATE global_reward_worker SET owner=?,until_ms=? WHERE id=1 AND until_ms<=?').run(owner,clock()+120000,clock()).changes))return {busy:true};
  const renew=()=>requireValue(db.prepare('UPDATE global_reward_worker SET until_ms=? WHERE id=1 AND owner=? AND until_ms>?').run(clock()+120000,owner,clock()).changes===1,'Global worker lease expired.');
  const read=async(method,args={})=>{renew();const value=await view(method,args);renew();return value;};
  const send=async(method,args)=>{renew();const value=await call(method,args);renew();return value;};
  const put=(sql,...args)=>atomic(db,()=>{renew();return db.prepare(sql).run(...args);});
  const attempt=async fn=>{try{await fn();}catch(e){if(/lease expired/.test(e.message))throw e;errors.push(String(e.message).slice(0,200));}};
  const errors=[];
  try{
    // Flush earned totals before closure and payout. Earned dust remains a
    // reservation even without an account or a mintable payout leaf.
    for(const day of db.prepare("SELECT * FROM global_reward_days WHERE state='active' ORDER BY starts_at").all())await attempt(async()=>{
      const totals=globalEarnedTotals(db,day.day),day_id=`world-${day.day}-v1`;
      let chain=await read('get_world_day',{day_id});
      requireValue(chain?.manifest_hash===day.manifest_hash,'World earning reservation differs.');
      if(chain.coins_earned!==totals.coins||chain.zones_earned!==totals.zones){
        await send('record_world_earned',{day_id,coins_yocto:totals.coins,zones_yocto:totals.zones});
        chain=await read('get_world_day',{day_id});
      }
      requireValue(chain.coins_earned===totals.coins&&chain.zones_earned===totals.zones,'Earned totals have not confirmed.');
      if(clock()>=day.ends_at+GPS_MAX_AGE_MS){
        if(!chain.closed)await send('close_world_day',{day_id,earned_coins:totals.coins,earned_zones:totals.zones});
        const closed=await read('get_world_day',{day_id});requireValue(closed?.closed&&closed.zones_earned===totals.zones,'Unused reservation release has not confirmed.');
        put("UPDATE global_reward_days SET state='closed' WHERE day=?",day.day);
      }
    });

    // Retry each account independently. A paused or failed mint does not
    // prevent another account's already-backed payout or a new account's batch.
    const fresh=prepareGlobalPayout(db,{day:new Date(clock()).toISOString().slice(0,10),now:clock(),fresh:true});
    let leavesLeft=32;
    for(const row of db.prepare("SELECT * FROM global_reward_payouts WHERE state!='confirmed' ORDER BY created_at LIMIT 32").all())await attempt(async()=>{
      const p=parse(row.body);let chain=await read('get_payout_day',{day_id:p.id});
      if(!chain){await send('move_world_to_payout',p.publish);chain=await read('get_payout_day',{day_id:p.id});}
      requireValue(chain?.root===p.publish.root&&chain.leaves===p.claims.length&&BigInt(chain.coins_reserved)+BigInt(chain.zones_reserved)===BigInt(p.totalYocto),'Published world payout differs.');
      put("UPDATE global_reward_payouts SET state='published',last_error=NULL WHERE id=?",p.id);
      const confirmed=new Set(db.prepare('SELECT idx FROM global_reward_conversions WHERE payout_id=?').all(p.id).map(r=>r.idx));
      const attempts=new Map(db.prepare('SELECT * FROM global_reward_attempts WHERE payout_id=?').all(p.id).map(r=>[r.idx,r]));
      const due=p.claims.filter(c=>!confirmed.has(c.index)&&(!attempts.has(c.index)||attempts.get(c.index).run_after<=clock())).slice(0,leavesLeft);
      leavesLeft-=due.length;
      for(const leaf of due)await attempt(async()=>{
        const number=(attempts.get(leaf.index)?.attempts??0)+1;
        put('INSERT INTO global_reward_attempts VALUES(?,?,?,?) ON CONFLICT(payout_id,idx) DO UPDATE SET run_after=excluded.run_after,attempts=excluded.attempts',p.id,leaf.index,clock()+Math.min(900000,30000*2**Math.min(number,5)),number);
        let progress=await read('get_payout_progress',{day_id:p.id,indexes:[leaf.index]});
        let state=progress?.statuses?.[0];
        if(state==='unclaimed'){
          await send('claim_payout',{day_id:p.id,claims:[leaf]});
          progress=await read('get_payout_progress',{day_id:p.id,indexes:[leaf.index]});state=progress?.statuses?.[0];
        }
        requireValue(state==='paid','World payout is pending or retryable; its entitlement stays reserved.');
        // Read a persistent QGOLD conversion receipt, not merely the callback
        // submission bit or a lost transaction response.
        const memo=`world payout ${p.id}:${leaf.index}`;renew();const receipt=await conversion(memo);renew();
        requireValue(receipt?.minter===contractId,'Confirmed QGOLD conversion receipt is unavailable.');
        renew();confirmGlobalConversion(db,{payoutId:p.id,index:leaf.index,receiptId:`${contractId}:${memo}`,accountId:leaf.account_id,conversion:receipt,now:clock()});
      });
    });

    // A crash can leave a confirmed pre-opening reservation whose local
    // activation was never committed. Never introduce money retrospectively;
    // release that wholly unearned reservation only after its evidence window.
    for(const row of db.prepare('SELECT p.body FROM global_reward_plans p LEFT JOIN global_reward_days d ON d.day=p.day WHERE d.day IS NULL').all())await attempt(async()=>{
      const p=parse(row.body);if(clock()<p.epoch.endsAt+GPS_MAX_AGE_MS)return;
      const day_id=`world-${p.epoch.day}-v1`,chain=await read('get_world_day',{day_id});if(!chain||chain.closed)return;
      requireValue(chain.manifest_hash===p.manifestHash&&chain.coins_earned==='0'&&chain.zones_earned==='0','Unactivated world reservation has unexpected earnings.');
      await send('close_world_day',{day_id,earned_coins:'0',earned_zones:'0'});
    });

    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_activity_days'").get())for(const content of db.prepare("SELECT * FROM global_activity_days WHERE state='ready' AND starts_at>=? ORDER BY starts_at LIMIT 2").all(clock()))await attempt(async()=>{
      if(db.prepare('SELECT 1 FROM global_reward_days WHERE day=?').get(content.day))return;
      let stored=db.prepare('SELECT body FROM global_reward_plans WHERE day=?').get(content.day),plan;
      if(stored)plan=parse(stored.body);
      else{
        const zones=db.prepare('SELECT object_id AS id,quest_id AS questId,cell,potential FROM global_reward_candidates WHERE day=? ORDER BY object_id').all(content.day);
        const expected=db.prepare('SELECT w.manifest FROM worlds w JOIN global_activity_regions r ON r.world_id=w.id WHERE r.day=?').all(content.day).reduce((n,r)=>n+parse(r.manifest).globalPreparation.systemZones,0);
        requireValue(zones.length===expected&&expected>0,'Prepared zones lack complete reward potential inputs.');
        const treasury=await read('get_treasury'),dateTotals=await read('get_date_totals',{date:content.day}),budget=await read('get_world_budget');
        requireValue(budget?.version===1&&budget.network==='testnet','Reviewed world reservation contract is required.');
        renew();const receipts=await fundingReceipts();renew();
        const potential=new Map();for(const z of zones)potential.set(z.cell,Math.max(potential.get(z.cell)??0,z.potential));
        plan=buildGlobalRewardPlan({epoch:utcEpoch(content.day),contentHash:content.content_hash,zones,receipts,treasury,dateTotals,liquidBackingYocto:budget.liquid_backing,seed:content.content_hash,inputs:{potential,demand:claimersByCell(db,content.starts_at-7*86400000),stake:claimersByCell(db,content.starts_at-30*86400000,{stakersOnly:true})}});
        put('INSERT INTO global_reward_plans VALUES(?,?)',content.day,canonical(plan));
      }
      const day_id=`world-${content.day}-v1`;let chain=await read('get_world_day',{day_id});
      if(!chain)await send('reserve_world_day',{day_id,manifest_hash:plan.manifestHash,starts_at:String(content.starts_at),ends_at:String(content.ends_at),coins_yocto:plan.budget.coinsYocto,zones_yocto:plan.budget.zonesYocto});
      renew();const reservation=await observe(day_id);renew();
      renew();activateGlobalRewards(db,plan,reservation,{now:clock(),contractId,codeHash});
    });
    if(errors.length)throw Error(errors.join('; ').slice(0,600));
    put('UPDATE global_reward_worker SET last_success=?,last_error=NULL WHERE id=1',clock());return {state:'ready',createdPayout:!!fresh};
  }catch(e){db.prepare('UPDATE global_reward_worker SET last_error=? WHERE id=1 AND owner=?').run(String(e.message).slice(0,600),owner);throw e;}
  finally{db.prepare('UPDATE global_reward_worker SET owner=NULL,until_ms=0 WHERE id=1 AND owner=?').run(owner);}
}

export function fundingEvents(outcome,{contractId,blockHeight}){
  requireValue(Number.isSafeInteger(blockHeight)&&outcome?.status&&Object.hasOwn(outcome.status,'SuccessValue'),'Finalized successful funding transaction required.');
  const result=[];
  for(const r of outcome.receipts_outcome??[]){
    if(r.outcome.executor_id!==contractId||!Object.hasOwn(r.outcome.status,'SuccessValue'))continue;
    for(const log of r.outcome.logs??[]){
      if(!log.startsWith('EVENT_JSON:'))continue;const e=parse(log.slice(11));
      if(e.standard!=='questlayer_rewards'||e.event!=='funded')continue;
      for(const f of e.data){requireValue(['sponsor','realized_yield'].includes(f.source),'Unknown funding source.');result.push({id:`${f.sender}:${f.receipt_id}`,source:f.source,amountYocto:f.amount,blockHeight,finalized:true});}
    }
  }
  return result;
}

export async function runConfiguredGlobalRewards(native,send){
  const c=native.config.globalRewards;if(!c?.enabled)return;
  requireValue(NETWORK==='testnet'&&send.worldDays,'World reservation methods are missing from the bounded worker key.');
  await assertTestnetRpc(native.provider);
  const qgold=new NativeContractReader(native.provider,c.qgoldContractId);
  const code=async(accountId,expected)=>{const r=await native.provider.query({request_type:'view_account',account_id:accountId,finality:'final'});requireValue(expected&&r.code_hash===expected,'Reviewed global reward bytecode is not installed.');return r;};
  await code(native.contractId,c.rewardsCodeHash);await code(c.qgoldContractId,c.qgoldCodeHash);
  const config=await native.view('get_config',{},true),vault=await qgold.view('get_state',{},true);
  requireValue(config.qgold_vault===c.qgoldContractId&&vault.exact_game_mint===1,'Exact QGOLD settlement is not configured.');
  return runGlobalRewardWorker(native.db,{contractId:native.contractId,codeHash:c.rewardsCodeHash,call:send,view:(m,a)=>native.view(m,a,true),
    conversion:memo=>qgold.view('get_game_conversion',{minter_id:native.contractId,memo},true),
    observe:async day_id=>{
      const r=await native.provider.query({request_type:'call_function',account_id:native.contractId,method_name:'get_world_day',args_base64:Buffer.from(JSON.stringify({day_id})).toString('base64'),finality:'final'});
      const account=await native.provider.query({request_type:'view_account',account_id:native.contractId,block_id:r.block_hash});requireValue(account.code_hash===c.rewardsCodeHash,'Reservation bytecode changed.');
      return {finalized:true,contractId:native.contractId,codeHash:account.code_hash,blockHash:r.block_hash,blockHeight:r.block_height,view:parse(Buffer.from(r.result).toString())};
    },
    fundingReceipts:async()=>{
      requireValue(Array.isArray(c.fundingTransactions),'A complete funding transaction inventory is required.');
      // Normal RPC nodes can prune old funding receipts. Reuse immutable
      // finalized proofs and use an archival testnet provider after a restart.
      if(!fundingHistory.has(native))fundingHistory.set(native,{provider:createNearProvider(c.fundingRpcUrl||'https://archival-rpc.testnet.near.org'),proofs:new Map()});
      const history=fundingHistory.get(native);
      const receipts=[];
      for(const ref of c.fundingTransactions){
        const key=`${ref.hash}:${ref.signerId}`;
        if(history.proofs.has(key)){receipts.push(...history.proofs.get(key));continue;}
        await assertTestnetRpc(history.provider);
        const response=await history.provider.txStatus(ref.hash,ref.signerId,'FINAL'),outcome=response.final_execution_outcome??response;
        requireValue(outcome.transaction?.hash===ref.hash&&outcome.transaction?.signer_id===ref.signerId,'Funding transaction identity differs.');
        // All receipt outcomes returned by FINAL are complete. The block
        // containing the fund event supplies deterministic FIFO ordering.
        const proofs=[];
        for(const r of outcome.receipts_outcome??[]){
          if(r.outcome.executor_id!==native.contractId)continue;
          const block=await history.provider.viewBlock({blockId:r.block_hash});
          proofs.push(...fundingEvents({...outcome,receipts_outcome:[r]},{contractId:native.contractId,blockHeight:block.header.height}));
        }
        history.proofs.set(key,proofs);receipts.push(...proofs);
      }
      return receipts;
    },
  });
}
