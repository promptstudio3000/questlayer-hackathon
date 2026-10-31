import assert from 'node:assert/strict';
import {openDatabase} from '../../../server/database.mjs';
import {claimQuest,listItem} from '../../../server/game.mjs';
import {createAdventureResults} from '../../../server/adventure-results.mjs';
const database=process.argv[2], action=process.argv[3];
assert(database?.startsWith('/private/tmp/questlayer-results-qa.'),'Dedicated result QA database required.');
const db=openDatabase(database);
try {
 const p=db.prepare("SELECT * FROM players WHERE name='River explorer'").get(); assert(p);
 const results=createAdventureResults(db);
 const chest=results.list(p.id,{realm:'arena',limit:50}).results.find(r=>r.reward?.item);
 assert(chest);
 if(action==='visit') {
  const now=Date.now();
  const q=db.prepare("SELECT * FROM quests WHERE world_id=? AND kind='visit' AND tier=1 AND opens_at<=? AND closes_at>? ORDER BY id LIMIT 1").get(chest.worldId,now,now); assert(q);
  const result=claimQuest(db,p.id,q.id,{lat:q.lat,lng:q.lng,accuracy:0,timestamp:now},now);
  assert.equal(result.result.reward.item,null);
  console.log(JSON.stringify({action:'Confirm synthetic no-item arena visit without delivering its result to the browser',result:result.result},null,2));
 }else if(action==='list') {
  listItem(db,p.id,chest.reward.item.id,5_000_000);
  assert.equal(results.get(p.id,chest.id).itemCurrent.status,'listed');
  console.log(JSON.stringify({action:'Synthetic owned item listed using existing demo-market service',result:results.get(p.id,chest.id)},null,2));
 }else {
  console.log(JSON.stringify({player:{id:p.id,xp:p.xp,goldU:p.gold_u,nativeOutfit:p.native_outfit},claims:db.prepare('SELECT COUNT(*) AS n FROM quest_claims WHERE player_id=?').get(p.id).n,receipts:db.prepare('SELECT COUNT(*) AS n FROM adventure_results WHERE player_id=?').get(p.id).n,items:db.prepare("SELECT id,name,equipped FROM inventory WHERE player_id=? AND kind='aura'").all(p.id),result:results.get(p.id,chest.id)},null,2));
 }
}finally{db.close();}
