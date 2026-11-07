// Fixed NEAR rights backed before opening. The game records earnings inside
// its existing GPS claim transaction; no wallet, float conversion or chain
// request is needed on the player's completion path.
import { atomic } from './database.mjs';
import { registerModuleSchema,ensureModuleVersion } from './schema-compatibility.mjs';
import { NETWORK } from './native/network.mjs';
import { buildPayoutDay } from './payouts/payout-tree.mjs';
import { decimalAmount } from './map-rewards/global-plan.mjs';
import { canonical,digest,requireValue } from './world-preparation/canonical.mjs';

export const GLOBAL_REWARDS_SCHEMA=registerModuleSchema({name:'global-rewards',version:1,sql:`
CREATE TABLE IF NOT EXISTS global_reward_candidates(day TEXT NOT NULL,object_id TEXT PRIMARY KEY,quest_id TEXT NOT NULL UNIQUE,cell TEXT NOT NULL,potential INTEGER NOT NULL CHECK(potential>=0));
CREATE TABLE IF NOT EXISTS global_reward_days(day TEXT PRIMARY KEY,manifest_hash TEXT NOT NULL UNIQUE,content_hash TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,body TEXT NOT NULL,reservation TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('active','closed')));
CREATE TABLE IF NOT EXISTS global_reward_objects(object_id TEXT PRIMARY KEY,day TEXT NOT NULL REFERENCES global_reward_days(day),quest_id TEXT NOT NULL UNIQUE,amount_yocto TEXT NOT NULL,funding TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS global_reward_claims(object_id TEXT PRIMARY KEY REFERENCES global_reward_objects(object_id),player_id TEXT NOT NULL,account_id TEXT,amount_yocto TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('earned','assigned','credited')),payout_id TEXT,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS global_reward_claims_player ON global_reward_claims(player_id,state);
CREATE TABLE IF NOT EXISTS global_reward_payouts(id TEXT PRIMARY KEY,body TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('planned','published','confirmed')),created_at INTEGER NOT NULL,last_error TEXT);
CREATE TABLE IF NOT EXISTS global_reward_conversions(payout_id TEXT NOT NULL,idx INTEGER NOT NULL,account_id TEXT NOT NULL,receipt_id TEXT NOT NULL UNIQUE,qgold_u TEXT NOT NULL,consumed_yocto TEXT NOT NULL,carry_yocto TEXT NOT NULL,previous_carry_yocto TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(payout_id,idx));
CREATE TABLE IF NOT EXISTS global_reward_consumed(object_id TEXT NOT NULL,receipt_id TEXT NOT NULL,amount_yocto TEXT NOT NULL,PRIMARY KEY(object_id,receipt_id));
CREATE TABLE IF NOT EXISTS global_reward_plans(day TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS global_reward_worker(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,until_ms INTEGER NOT NULL DEFAULT 0,last_success INTEGER,last_error TEXT);
CREATE TABLE IF NOT EXISTS global_reward_attempts(payout_id TEXT NOT NULL,idx INTEGER NOT NULL,run_after INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(payout_id,idx));
`});
const present=db=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_reward_days'").get();
export function ensureGlobalRewards(db){ensureModuleVersion(db,GLOBAL_REWARDS_SCHEMA);}
const read=raw=>JSON.parse(raw);
export const formatYoctoNear=value=>{
  const text=decimalAmount(value).toString().padStart(25,'0'),fraction=text.slice(-24).replace(/0+$/,'');
  return text.slice(0,-24)+(fraction?'.'+fraction:'');
};

export function globalRewardDay(db,day){return present(db)?db.prepare('SELECT * FROM global_reward_days WHERE day=?').get(day):null;}
export function globalPrizeForQuest(db,questId){
  if(!present(db))return null;
  const row=db.prepare("SELECT o.amount_yocto,d.manifest_hash,q.claimant FROM global_reward_objects o JOIN global_reward_days d ON d.day=o.day JOIN quests q ON q.id=o.quest_id WHERE o.quest_id=? AND d.state='active'").get(questId);
  return row&&decimalAmount(row.amount_yocto)>0n?{amountYocto:row.amount_yocto,amountNear:formatYoctoNear(row.amount_yocto),available:!row.claimant,settlementAsset:'QGOLD',manifestHash:row.manifest_hash}:null;
}

export function decorateGlobalRewardWorld(db,world){
  if(!world.globalPreparation)return world;
  const day=globalRewardDay(db,world.day);if(!day)return world;
  const plan=read(day.body),positive=decimalAmount(plan.budget.zonesYocto)>0n;
  return {...world,globalPreparation:{...world.globalPreparation,financialActivation:true,rewardManifestHash:day.manifest_hash,rewardBudgetYocto:plan.budget.zonesYocto},quality:{...world.quality,funded:positive,notice:positive?'Map-derived discoveries by Atlas. Follow local signs and skip blocked places. Everyone earns personal XP; each funded zone has one fixed NEAR prize for its first confirmed completion, converted to QGOLD at settlement. Any amount below a token unit remains covered NEAR credit.':'Map-derived discoveries by Atlas. This day has no monetary budget; personal XP remains available. Follow local signs and skip blocked places.'}};
}

export function registerGlobalRewardCandidates(db,day,entries){
  if(!entries.length)return;ensureGlobalRewards(db);
  const insert=db.prepare('INSERT OR IGNORE INTO global_reward_candidates VALUES(?,?,?,?,?)');
  for(const e of entries){requireValue(Number.isSafeInteger(e.potential)&&e.potential>=0,'Invalid geographic reward potential.');insert.run(day,e.objectId,e.questId,e.cell,e.potential);}
}

export function activateGlobalRewards(db,plan,reservation,{now=Date.now(),contractId,codeHash}={}){
  requireValue(NETWORK==='testnet'&&contractId?.endsWith('.testnet'),'Global rewards require the reviewed testnet contract.');
  const {manifestHash,...body}=plan;
  requireValue(plan.schema==='questlayer.global-rewards/1'&&manifestHash===digest(body),'Reward allocation hash differs.');
  requireValue(reservation.finalized===true&&reservation.contractId===contractId&&reservation.codeHash===codeHash&&typeof reservation.blockHash==='string','A finalized reservation observation is required.');
  const view=reservation.view,epoch=plan.epoch;
  requireValue(view?.manifest_hash===manifestHash&&view.starts_at===String(epoch.startsAt)&&view.ends_at===String(epoch.endsAt)&&view.coins_reserved===plan.budget.coinsYocto&&view.zones_reserved===plan.budget.zonesYocto&&!view.closed,'Reservation does not cover this exact prepared day.');
  requireValue(decimalAmount(plan.budget.coinsYocto)===0n,'Coin activation requires its own prepared coin inventory.');
  ensureGlobalRewards(db);
  return atomic(db,()=>{
    const previous=db.prepare('SELECT * FROM global_reward_days WHERE day=?').get(epoch.day);
    if(previous){requireValue(previous.manifest_hash===manifestHash,'An opened financial day cannot be replaced.');return read(previous.body);}
    requireValue(now<=epoch.startsAt,'Financial terms must be reserved before the day opens.');
    const content=db.prepare("SELECT * FROM global_activity_days WHERE day=? AND state='ready'").get(epoch.day);
    requireValue(content?.content_hash===plan.contentHash&&content.starts_at===epoch.startsAt&&content.ends_at===epoch.endsAt,'Complete matching content must be installed before financial activation.');
    requireValue(new Set(plan.objects.map(o=>o.id)).size===plan.objects.length&&new Set(plan.objects.map(o=>o.questId)).size===plan.objects.length,'Duplicate reward identity.');
    const total=plan.objects.reduce((n,o)=>n+decimalAmount(o.amountYocto),0n);
    requireValue(total===decimalAmount(plan.budget.zonesYocto),'Object promises differ from the reservation.');
    const lots=plan.funding.map(f=>({...f,left:decimalAmount(f.amountYocto)}));
    requireValue(lots.reduce((n,l)=>n+l.left,0n)===total&&lots.every(l=>l.bucket==='zones'&&['sponsor','realized_yield'].includes(l.source)),'Funding attribution differs from the reserved bucket.');
    db.prepare("INSERT INTO global_reward_days VALUES(?,?,?,?,?,?,?,'active')").run(epoch.day,manifestHash,plan.contentHash,epoch.startsAt,epoch.endsAt,canonical(plan),canonical(reservation));
    const insert=db.prepare('INSERT INTO global_reward_objects VALUES(?,?,?,?,?)');
    for(const object of plan.objects){
      requireValue(object.bucket==='zones'&&db.prepare('SELECT 1 FROM global_reward_candidates WHERE day=? AND object_id=? AND quest_id=? AND cell=?').get(epoch.day,object.id,object.questId,object.cell),'Unprepared financial objective.');
      let left=decimalAmount(object.amountYocto);const funding=[];
      for(const lot of lots){const take=left<lot.left?left:lot.left;if(take>0n)funding.push({id:lot.id,source:lot.source,bucket:'zones',amountYocto:String(take)});lot.left-=take;left-=take;}
      requireValue(left===0n,'Uncovered object promise.');insert.run(object.id,epoch.day,object.questId,object.amountYocto,canonical(funding));
    }
    return plan;
  });
}

export function earnGlobalQuest(db,player,quest,now){
  if(!present(db))return null;
  const row=db.prepare("SELECT o.*,d.starts_at,d.ends_at FROM global_reward_objects o JOIN global_reward_days d ON d.day=o.day WHERE o.quest_id=? AND d.state='active'").get(quest.id);
  if(!row||decimalAmount(row.amount_yocto)===0n)return null;
  requireValue(now>=row.starts_at&&now<row.ends_at,'Global reward earning window is closed.');
  requireValue(db.prepare('SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?').get(quest.id,player),'Accepted GPS completion required.');
  db.prepare("INSERT OR IGNORE INTO global_reward_claims VALUES(?,?,NULL,?,'earned',NULL,?)").run(row.object_id,player,row.amount_yocto,now);
  return globalRewardReceipt(db,player,quest.id);
}

export function globalRewardReceipt(db,player,questId){
  if(!present(db))return null;
  const row=db.prepare('SELECT c.*,o.day,o.funding FROM global_reward_claims c JOIN global_reward_objects o ON o.object_id=c.object_id WHERE o.quest_id=? AND c.player_id=?').get(questId,player);
  if(!row)return null;
  const converted=db.prepare('SELECT amount_yocto FROM global_reward_consumed WHERE object_id=?').all(row.object_id).reduce((n,r)=>n+decimalAmount(r.amount_yocto),0n);
  return {asset:'NEAR',amountYocto:row.amount_yocto,amountNear:formatYoctoNear(row.amount_yocto),unconvertedYocto:String(decimalAmount(row.amount_yocto)-converted),settlementAsset:'QGOLD',state:converted===decimalAmount(row.amount_yocto)?'converted':row.state==='credited'?'conversion-carry':'pending-payout',day:row.day,objectId:row.object_id,funding:read(row.funding)};
}

export function globalEarnedTotals(db,day){
  if(!present(db))return {coins:'0',zones:'0'};
  const zones=db.prepare('SELECT c.amount_yocto FROM global_reward_claims c JOIN global_reward_objects o ON o.object_id=c.object_id WHERE o.day=?').all(day).reduce((n,r)=>n+decimalAmount(r.amount_yocto),0n);
  return {coins:'0',zones:String(zones)};
}

export function prepareGlobalPayout(db,{day,now=Date.now(),fresh=false}={}){
  ensureGlobalRewards(db);
  return atomic(db,()=>{
    const existing=db.prepare("SELECT body FROM global_reward_payouts WHERE state!='confirmed' ORDER BY created_at LIMIT 1").get();if(existing&&!fresh)return read(existing.body);
    const number=db.prepare('SELECT COUNT(*) AS n FROM global_reward_payouts WHERE id LIKE ?').get(`payout-world-${day}-v%`).n+1,id=`payout-world-${day}-v${number}`;
    const rows=db.prepare("SELECT c.*,o.day FROM global_reward_claims c JOIN global_reward_objects o ON o.object_id=c.object_id WHERE c.state='earned' ORDER BY c.created_at,c.object_id").all();
    const eligible=[];
    for(const row of rows){const account=row.account_id??db.prepare('SELECT account_id FROM wallet_links WHERE player_id=? ORDER BY rowid DESC LIMIT 1').get(row.player_id)?.account_id;if(account?.endsWith('.testnet')&&!db.prepare("SELECT 1 FROM global_reward_claims WHERE account_id=? AND state='assigned'").get(account))eligible.push({...row,account});}
    const tree=buildPayoutDay({dayId:id,entries:eligible.map(r=>({accountId:r.account,amountYocto:r.amount_yocto})),coinsShareYocto:0n});
    if(!tree.publish)return null;
    const accounts=new Set(tree.claims.map(c=>c.account_id)),selected=eligible.filter(r=>accounts.has(r.account)),sources=new Map();
    for(const r of selected){const key=`world-${r.day}-v1`;sources.set(key,(sources.get(key)??0n)+decimalAmount(r.amount_yocto));}
    requireValue(sources.size<=64,'Settle fewer original UTC epochs in one batch.');
    const body={id,claims:tree.claims,totalYocto:String(tree.total),publish:{day_id:id,root:tree.root,leaves:tree.claims.length,sources:[...sources].sort(([a],[b])=>a.localeCompare(b)).map(([world_day_id,amount])=>({world_day_id,coins_yocto:'0',zones_yocto:String(amount)}))}};
    db.prepare("INSERT INTO global_reward_payouts VALUES(?,?,'planned',?,NULL)").run(id,canonical(body),now);
    for(const row of selected)db.prepare("UPDATE global_reward_claims SET state='assigned',account_id=?,payout_id=? WHERE object_id=? AND state='earned'").run(row.account,id,row.object_id);
    return body;
  });
}

export function confirmGlobalConversion(db,{payoutId,index,receiptId,accountId,conversion,now=Date.now()}){
  ensureGlobalRewards(db);
  return atomic(db,()=>{
    const payout=db.prepare('SELECT body FROM global_reward_payouts WHERE id=?').get(payoutId);requireValue(payout,'Unknown global payout');
    const claim=read(payout.body).claims.find(c=>c.index===index);requireValue(claim?.account_id===accountId,'Wrong conversion receiver');
    const old=db.prepare('SELECT * FROM global_reward_conversions WHERE payout_id=? AND idx=?').get(payoutId,index);
    if(old){requireValue(old.receipt_id===receiptId,'Conversion receipt differs.');return false;}
    const used=decimalAmount(conversion.consumedYocto),carry=decimalAmount(conversion.carryYocto),previous=decimalAmount(conversion.previousCarryYocto);
    requireValue(conversion.account_id===accountId&&decimalAmount(conversion.depositedYocto)===decimalAmount(claim.amount_yocto)&&used+carry===previous+decimalAmount(claim.amount_yocto),'Conversion does not conserve the fixed NEAR entitlement.');
    const waiting=db.prepare("SELECT * FROM global_reward_claims WHERE account_id=? AND (state='credited' OR payout_id=?) ORDER BY created_at,object_id").all(accountId,payoutId);
    const available=waiting.map(r=>({...r,left:decimalAmount(r.amount_yocto)-db.prepare('SELECT amount_yocto FROM global_reward_consumed WHERE object_id=?').all(r.object_id).reduce((n,p)=>n+decimalAmount(p.amount_yocto),0n)}));
    requireValue(available.reduce((n,r)=>n+r.left,0n)===previous+decimalAmount(claim.amount_yocto),'Reconcile earlier conversion receipts before this one.');
    let left=used;
    for(const r of available){const take=left<r.left?left:r.left;if(take>0n)db.prepare('INSERT INTO global_reward_consumed VALUES(?,?,?)').run(r.object_id,receiptId,String(take));left-=take;}
    requireValue(left===0n,'Conversion exceeds earned source lots.');
    decimalAmount(conversion.qgoldU);
    db.prepare('INSERT INTO global_reward_conversions VALUES(?,?,?,?,?,?,?,?,?)').run(payoutId,index,accountId,receiptId,conversion.qgoldU,String(used),String(carry),String(previous),now);
    db.prepare("UPDATE global_reward_claims SET state='credited' WHERE payout_id=? AND account_id=?").run(payoutId,accountId);
    if(db.prepare('SELECT COUNT(*) AS n FROM global_reward_conversions WHERE payout_id=?').get(payoutId).n===read(payout.body).claims.length)db.prepare("UPDATE global_reward_payouts SET state='confirmed',last_error=NULL WHERE id=?").run(payoutId);
    return true;
  });
}
