// Positive A05 counterparts of the archived negative diagnostic in patch eight.
// Receipt models / in-memory DB only. Actual WASM evidence lives separately.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { purchaseFixture, burnOutcome, HASH } from '../fixtures/qgold-purchase.mjs';
import { setSpendRealm } from '../../server/gold-spend/ledger.mjs';
const output=process.argv[2];assert.ok(output,'Pass a local JSON report path');
const report={at:new Date().toISOString(),scope:'modeled receipts / in-memory database; no chain',scenarios:[],releaseReady:false};
setSpendRealm('qgold');
try {
 for(const delegated of [false,true]) {
  const f=purchaseFixture();try {
   await assert.rejects(f.run(),e=>e.code==='QGOLD_BURN');
   assert.deepEqual(f.prepare(),f.prepare());
   const proof=burnOutcome(f.row(),{delegated});
   await assert.rejects(f.confirm(proof,{txHash:'9'.repeat(44)}),e=>e.code==='BURN_PENDING');
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM qgold_burn_credits').get().n,0);
   await f.confirm(proof,{txHash:HASH});const first=await f.run();assert.deepEqual(await f.run(),first);
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM gold_unlocks').get().n,1);
   report.scenarios.push({name:delegated?'delegated':'direct',passed:true,stableIntent:true,mismatchedHashRejected:true,oneDelivery:true});
  }finally{f.db.close();}
 }
 report.passed=true;
}finally{setSpendRealm('practice');writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
