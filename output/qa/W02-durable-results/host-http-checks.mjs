import assert from 'node:assert/strict';
import { openDatabase } from '../../../server/database.mjs';
import { ensureWorld, HOME } from '../../../server/world.mjs';
const database=process.argv[2], origin='http://localhost:8801';
assert(database?.startsWith('/private/tmp/questlayer-results-qa.'),'Use the dedicated isolated QA database.');
async function request(path,{cookie,body,method=body===undefined?'GET':'POST',source=origin}={}) {
 const r=await fetch(origin+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:source})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const health=await request('/health');
assert.equal(health.status,200); assert.equal(health.data.schema.coreVersion,1);
assert.equal(health.data.schema.modules['adventure-results'],1);
assert.equal((await request('/adventure-results')).status,401);
const walker=await request('/session',{body:{name:'HTTP result walker'}}), outsider=await request('/session',{body:{name:'HTTP result outsider'}});
assert.equal(walker.status,201); assert.equal(outsider.status,201);
const db=openDatabase(database);
try {
 const now=Date.now(), world=await ensureWorld(db,HOME,true,now);
 const q=db.prepare("SELECT * FROM quests WHERE world_id=? AND kind='chest' AND tier=1 AND opens_at<=? AND closes_at>? ORDER BY id LIMIT 1").get(world.id,now,now);
 const visit=db.prepare("SELECT * FROM quests WHERE world_id=? AND kind='visit' AND tier=1 AND opens_at<=? AND closes_at>? ORDER BY id LIMIT 1").get(world.id,now,now);
 assert(q&&visit);
 const claim=await request('/quests/claim',{cookie:walker.cookie,body:{questId:q.id,fix:{lat:q.lat,lng:q.lng,accuracy:0,timestamp:Date.now()}}});
 assert.equal(claim.status,200); assert.equal(claim.data.replayed,false);
 const result=claim.data.result, xp=db.prepare('SELECT xp FROM players WHERE id=?').get(walker.data.player.id).xp;
 const duplicate=await request('/quests/claim',{cookie:walker.cookie,body:{questId:q.id}});
 assert.equal(duplicate.status,200); assert.equal(duplicate.data.replayed,true); assert.equal(duplicate.data.result.id,result.id);
 assert.equal(db.prepare('SELECT xp FROM players WHERE id=?').get(walker.data.player.id).xp,xp);
 assert.equal((await request('/adventure-results/'+result.id,{cookie:outsider.cookie})).status,404);
 assert.equal((await request('/adventure-results/'+result.id+'/viewed',{cookie:walker.cookie,body:{},source:'https://invalid.example'})).status,403);
 const detail=await request('/adventure-results/'+result.id,{cookie:walker.cookie}); assert.equal(detail.data.result.viewedAt,null);
 const viewed=await request('/adventure-results/'+result.id+'/viewed',{cookie:walker.cookie,body:{}});
 assert.equal(viewed.status,200); assert.equal(typeof viewed.data.result.viewedAt,'number');
 assert.equal((await request('/adventure-results/'+result.id+'/viewed',{cookie:walker.cookie,body:{}})).data.result.viewedAt,viewed.data.result.viewedAt);
 assert.equal((await request('/adventure-results?realm=alien',{cookie:walker.cookie})).status,400);
 const noItem=await request('/quests/claim',{cookie:walker.cookie,body:{questId:visit.id,fix:{lat:visit.lat,lng:visit.lng,accuracy:0,timestamp:Date.now()}}});
 assert.equal(noItem.status,200); assert.equal(noItem.data.result.reward.item,null);
 const page=await request('/adventure-results?realm=arena&limit=1',{cookie:walker.cookie}); assert.equal(page.data.results.length,1); assert(page.data.nextCursor);
 assert.equal((await request('/adventure-results?realm=arena&limit=1&cursor='+encodeURIComponent(page.data.nextCursor),{cookie:outsider.cookie})).status,400);
 const equipped=await request('/equip',{cookie:walker.cookie,body:{itemId:result.reward.item.id,desiredEquipped:true}});
 assert.equal(equipped.status,200); assert.equal(equipped.data.player.inventory.find(i=>i.id===result.reward.item.id).equipped,1);
 const again=await request('/equip',{cookie:walker.cookie,body:{itemId:result.reward.item.id,desiredEquipped:true}});
 assert.equal(again.status,200); assert.equal(again.data.player.inventory.find(i=>i.id===result.reward.item.id).equipped,1);
 console.log(JSON.stringify({status:'passed',actualHost:true,scope:'Isolated localhost server; synthetic actors, official arena, simulated fixes',checks:['health/schema identity','anonymous401','actor404','foreign-origin403','claim retry exactly once','GET does not mark viewed','explicit view idempotency','realm validation','zero-item receipt','owner-bound pagination','explicit equip true remains equipped on retry'],source:health.data.source,schema:health.data.schema,resultId:result.id,zeroItemResultId:noItem.data.result.id},null,2));
} finally {db.close();}
