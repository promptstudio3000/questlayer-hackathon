// Exact NEAR allocations for an already selected content inventory. Weight
// scores reuse the current map policy; no amount ever passes through Number.
import { cellToParent } from 'h3-js';
import { AREA_CAP_BPS,CELL_CAP_BPS,MAP_REWARDS_POLICY } from './policy.mjs';
import { zoneAllocationWeights } from './day-plan.mjs';
import { canonical,digest,requireValue } from '../world-preparation/canonical.mjs';

export const decimalAmount=v=>{
  requireValue(typeof v==='string'&&/^(0|[1-9]\d{0,38})$/.test(v),'Money must be a nonnegative decimal yoctoNEAR string.');
  const n=BigInt(v);requireValue(n<=(1n<<128n)-1n,'Money exceeds contract precision.');return n;
};
const min=(...values)=>values.reduce((a,b)=>a<b?a:b);

// A complete chain receipt inventory permits deterministic FIFO attribution
// of the available buckets after ALL existing obligations, not only this mode.
export function availableFunding({receipts,treasury}) {
  requireValue(Array.isArray(receipts),'A confirmed funding inventory is required.');
  const seen=new Set(),lots=receipts.map(r=>{
    requireValue(r.finalized===true&&['sponsor','realized_yield'].includes(r.source)&&typeof r.id==='string'&&!seen.has(r.id)&&Number.isSafeInteger(r.blockHeight),'Invalid or repeated funding proof.');seen.add(r.id);
    const amount=decimalAmount(r.amountYocto);return {...r,coins:amount/2n,zones:amount-amount/2n};
  }).sort((a,b)=>a.blockHeight-b.blockHeight||a.id.localeCompare(b.id));
  const total=lots.reduce((n,l)=>n+l.coins+l.zones,0n);
  requireValue(total===decimalAmount(treasury.funded),'Funding receipt inventory does not reconcile to received funds.');
  for(const bucket of ['coins','zones']) {
    const t=treasury[bucket],available=decimalAmount(t.available),committed=decimalAmount(t.reserved)+decimalAmount(t.awarded);
    requireValue(lots.reduce((n,l)=>n+l[bucket],0n)===available+committed,'Funding bucket does not reconcile.');
    let used=committed;
    for(const lot of lots){const take=min(used,lot[bucket]);lot[bucket]-=take;used-=take;}
    requireValue(used===0n,'Existing obligations exceed received funding.');
  }
  return lots;
}

function integerWeights(weights) {
  const terms=[...weights].map(([id,w])=>{
    requireValue(Number.isFinite(w)&&w>0,'Invalid policy weight.');
    const [mantissa,exp='0']=String(w).split('e'),[whole,fraction='']=mantissa.split('.');
    return {id,n:BigInt(whole+fraction),power:Number(exp)-fraction.length};
  });
  const power=Math.min(0,...terms.map(t=>t.power));
  return new Map(terms.map(t=>[t.id,t.n*10n**BigInt(t.power-power)]));
}

export function allocateExactZones({zones,budgetYocto,seed,potential=new Map(),demand=new Map(),stake=new Map(),votes=new Map()}) {
  const pool=decimalAmount(budgetYocto),cells=[...new Set(zones.map(z=>z.cell))].sort();
  requireValue(new Set(zones.map(z=>z.id)).size===zones.length,'Duplicate reward object.');
  const {weights}=zoneAllocationWeights({seed,cells,potential,demand,stake,votes});
  let open=integerWeights(weights),left=pool;const cellValues=new Map(),areaValues=new Map();
  const cellCap=pool*BigInt(CELL_CAP_BPS)/10000n,areaCap=pool*BigInt(AREA_CAP_BPS)/10000n;
  for(let round=0;round<6&&left>0n&&open.size;round++){
    const total=[...open.values()].reduce((n,w)=>n+w,0n),next=new Map();let spent=0n;
    for(const [cell,w] of open){
      const area=cellToParent(cell,5),have=cellValues.get(cell)??0n,roomCell=cellCap-have,roomArea=areaCap-(areaValues.get(area)??0n),want=left*w/total,take=min(want,roomCell,roomArea);
      if(take>0n){cellValues.set(cell,have+take);areaValues.set(area,(areaValues.get(area)??0n)+take);spent+=take;}
      if(take===want&&roomCell>take&&roomArea>take)next.set(cell,w);
    }
    left-=spent;if(!spent)break;open=next;
  }
  const counts=new Map();for(const z of zones)counts.set(z.cell,(counts.get(z.cell)??0)+1);
  const objects=zones.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(z=>({id:z.id,questId:z.questId,cell:z.cell,bucket:'zones',amountYocto:((cellValues.get(z.cell)??0n)/BigInt(counts.get(z.cell))).toString()}));
  const total=objects.reduce((n,o)=>n+BigInt(o.amountYocto),0n);
  return {policy:`${MAP_REWARDS_POLICY}:exact-near/1`,objects,totalYocto:total.toString(),unallocatedYocto:(pool-total).toString()};
}

export function buildGlobalRewardPlan({epoch,contentHash,zones,receipts,treasury,dateTotals,liquidBackingYocto,seed,inputs={}}) {
  requireValue(/^[a-f0-9]{64}$/.test(contentHash),'Pin prepared content.');
  const lots=availableFunding({receipts,treasury}),cap=decimalAmount(dateTotals.cap),used=decimalAmount(dateTotals.zones);
  requireValue(used<=cap,'Date limit already exceeded.');
  const budget=min(decimalAmount(treasury.zones.available),lots.reduce((n,l)=>n+l.zones,0n),cap-used,decimalAmount(liquidBackingYocto));
  const allocated=allocateExactZones({zones,budgetYocto:String(budget),seed,...inputs});
  let left=BigInt(allocated.totalYocto);const funding=[];
  for(const lot of lots){const amount=min(lot.zones,left);if(amount>0n)funding.push({id:lot.id,source:lot.source,bucket:'zones',amountYocto:String(amount)});left-=amount;}
  requireValue(left===0n,'Allocation exceeds verified funding.');
  const body={schema:'questlayer.global-rewards/1',epoch,contentHash,policy:allocated.policy,objects:allocated.objects,budget:{coinsYocto:'0',zonesYocto:allocated.totalYocto},funding,sourceSnapshotHash:digest({receipts,treasury,dateTotals,liquidBackingYocto,seed,inputs:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,[...v].sort(([a],[b])=>a.localeCompare(b))]))})};
  return {...body,manifestHash:digest(body)};
}
