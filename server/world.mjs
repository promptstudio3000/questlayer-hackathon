import tzLookup from 'tz-lookup';
import { latLngToCell, cellToLatLng, cellToBoundary, cellToParent } from 'h3-js';
import { COIN_VALUE, DAY, GOLD, dayKey, seeded, distance } from './domain.mjs';
import { atomic } from './database.mjs';

export const HOME = {lng:13.3774,lat:49.74745};
export const ZONE_NAMES=['Quiet Spirit Garden','Little Wonders Square','Firefly Trail','Around the Corner','Beyond the Horizon','Moonlit Sanctuary'];
const pending=new Map();
const arenaPaths=[
 [[13.37660,49.74825],[13.37795,49.74825],[13.37795,49.74695],[13.37660,49.74695],[13.37660,49.74825]],
 [[13.37725,49.74823],[13.37725,49.74795],[13.37725,49.74770],[13.37725,49.74697]],
 [[13.37660,49.74770],[13.37795,49.74770]],
 [[13.37795,49.74755],[13.37930,49.74755]],
 [[13.37660,49.74755],[13.37500,49.74755]],
 [[13.37727,49.74695],[13.37727,49.74580]],
];
async function publicPaths(db, region, center) {
 const cached=db.prepare('SELECT * FROM geo_cache WHERE region=? AND expires_at>?').get(region,Date.now());
 if(cached)return JSON.parse(cached.data);
 const [lat,lng]=center, d=.009;
 const q=`[out:json][timeout:12];way[highway~"^(footway|pedestrian|path|living_street|residential)$"][access!~"^(private|no)$"][foot!="no"](${lat-d},${lng-d},${lat+d},${lng+d});out geom 100;`;
 const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:q}),signal:AbortSignal.timeout(15_000)});
 if(!response.ok)throw new Error('The map data service is busy.');
 const json=await response.json();
 const paths=(json.elements||[]).filter(e=>e.type==='way'&&e.geometry?.length>1).map(e=>e.geometry.map(p=>[p.lon,p.lat]));
 if(!paths.length)throw new Error('There are not enough suitable mapped trails in this area yet.');
 db.prepare('INSERT OR REPLACE INTO geo_cache VALUES (?,?,?)').run(region,JSON.stringify(paths),Date.now()+7*DAY);
 return paths;
}
function samplePaths(paths,max=350){
 const points=[]; const seen=new Set();
 for(const path of paths)for(let i=1;i<path.length;i++){
  const a={lng:path[i-1][0],lat:path[i-1][1]}, b={lng:path[i][0],lat:path[i][1]};
  const n=Math.max(1,Math.floor(distance(a,b)/14));
  for(let j=0;j<n;j++){const p={lng:a.lng+(b.lng-a.lng)*j/n,lat:a.lat+(b.lat-a.lat)*j/n}; const key=`${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;if(!seen.has(key)){points.push(p);seen.add(key);}if(points.length>=max)return points;}
 }
 return points;
}
function publicManifest(db,world){
 if(!world.arena){const[lat,lng]=cellToLatLng(world.region);if(world.center.lat!==lat||world.center.lng!==lng){world.center={lat,lng};db.prepare('UPDATE worlds SET manifest=? WHERE id=?').run(JSON.stringify(world),world.id);}}
 return world;
}
export async function ensureWorld(db, location=HOME, arena=true, now=Date.now()) {
 const region=arena?'arena-plzen':latLngToCell(location.lat,location.lng,7);
 const timezone=arena?'Europe/Prague':timezoneFor(location);
 const day=dayKey(now,timezone), worldId=`demo:${region}:${day}:v1`;
 const found=db.prepare('SELECT manifest FROM worlds WHERE id=?').get(worldId);if(found)return publicManifest(db,JSON.parse(found.manifest));
 if(pending.has(worldId))return pending.get(worldId);
 const job=(async()=>{
  const paths=arena?arenaPaths:await publicPaths(db,region,cellToLatLng(region));
  const samples=samplePaths(paths);const rng=seeded(worldId);const [centerLat,centerLng]=arena?[HOME.lat,HOME.lng]:cellToLatLng(region);const center={lat:centerLat,lng:centerLng};
  // Daily instance expires at the next local calendar date, including DST days.
  let end=now+DAY; for(let t=now+60_000;t<=now+26*3_600_000;t+=60_000){if(dayKey(t,timezone)!==day){end=Math.floor(t/60_000)*60_000;break;}}
  const zones=ZONE_NAMES.map((name,i)=>{
   const anchor=samples[Math.floor(rng()*samples.length)]||center;
   const tier=i<3?1:i<5?2:3;
   return {id:`${worldId}:zone:${i}`,name,tier,lat:anchor.lat,lng:anchor.lng,radius:i===5?110:55+i*9,kind:i===0?'garden':i===1?'discovery':i===2?'cache':'expedition',opensAt:now-1000,closesAt:end,color:tier===3?'#e8ae51':tier===2?'#9d7dd9':'#65b5a3'};
  });
  const manifest={id:worldId,day,region,timezone,arena,source:arena?'hand-authored-demo-arena':'OpenStreetMap / Overpass',center,boundary:arena?null:cellToBoundary(region,true),paths,endsAt:end,zones};
  return atomic(db,()=>{
   if(db.prepare('SELECT id FROM worlds WHERE id=?').get(worldId))return publicManifest(db,JSON.parse(db.prepare('SELECT manifest FROM worlds WHERE id=?').get(worldId).manifest));
   db.prepare('INSERT INTO worlds VALUES (?,?,?,?,?,?)').run(worldId,day,region,timezone,JSON.stringify(manifest),now);
   const bucket=db.prepare('SELECT available_u FROM treasury WHERE bucket=?').get('coins');
   const count=Math.min(samples.length,Math.floor(bucket.available_u/COIN_VALUE));
   for(let i=0;i<count;i++)db.prepare('INSERT INTO coins(id,world_id,lat,lng,value_u) VALUES (?,?,?,?,?)').run(`${worldId}:coin:${i}`,worldId,samples[i].lat,samples[i].lng,COIN_VALUE);
   db.prepare('UPDATE treasury SET available_u=available_u-?,reserved_u=reserved_u+? WHERE bucket=?').run(count*COIN_VALUE,count*COIN_VALUE,'coins');
   for(let i=0;i<zones.length;i++){
    const z=zones[i];const desired=z.tier===3?5000*GOLD:z.tier===2?1000*GOLD:0;
    const fund=db.prepare('SELECT available_u FROM treasury WHERE bucket=?').get('zones');const reward=desired<=fund.available_u?desired:0;
    db.prepare('UPDATE treasury SET available_u=available_u-?,reserved_u=reserved_u+? WHERE bucket=?').run(reward,reward,'zones');
    db.prepare('INSERT INTO quests(id,world_id,title,description,lat,lng,tier,gold_u,xp,kind,opens_at,closes_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`${worldId}:quest:${i}`,worldId,i===0?'A Garden Hello':i===1?'Find a Hidden Story':i===2?'Open the Explorer Chest':i===3?'Follow the Light':i===4?'The Old Trail Secret':'The Golden Expedition',i===2?'Reach the treasure chest and discover a new Aura.':'Reach the marked point, confirm your visit and collect your reward.',z.lat,z.lng,z.tier,reward,50+i*15,i===2?'chest':'visit',z.opensAt,z.closesAt);
   }
   return manifest;
  });
 })().finally(()=>pending.delete(worldId));pending.set(worldId,job);return job;
}
// A stable cell center determines the IANA zone, never a phone setting or first visitor.
function timezoneFor(p){const[lat,lng]=cellToLatLng(latLngToCell(p.lat,p.lng,7));return tzLookup(lat,lng);}
export function worldView(db,id,player=null){const row=db.prepare('SELECT manifest FROM worlds WHERE id=?').get(id);if(!row)return null;return {...publicManifest(db,JSON.parse(row.manifest)),coins:db.prepare('SELECT id,lat,lng,value_u,claimant FROM coins WHERE world_id=? AND claimant IS NULL').all(id),quests:db.prepare('SELECT q.*,EXISTS(SELECT 1 FROM quest_claims c WHERE c.quest_id=q.id AND c.player_id=?) AS completed FROM quests q WHERE q.world_id=?').all(player,id)};}
export function expireWorlds(db, now=Date.now()){
 return atomic(db,()=>{
  const rows=db.prepare('SELECT id,manifest FROM worlds').all();
  for(const row of rows){const world=JSON.parse(row.manifest);if(world.endsAt>now)continue;const key=`expire:${row.id}`;if(db.prepare('SELECT 1 FROM daily_jobs WHERE job_key=?').get(key))continue;
   const coins=db.prepare('SELECT COALESCE(SUM(value_u),0) AS n FROM coins WHERE world_id=? AND claimant IS NULL').get(row.id).n;
   const quests=db.prepare('SELECT COALESCE(SUM(gold_u),0) AS n FROM quests WHERE world_id=? AND claimant IS NULL').get(row.id).n;
   for(const [bucket,n]of[['coins',coins],['zones',quests]])db.prepare('UPDATE treasury SET available_u=available_u+?,reserved_u=reserved_u-? WHERE bucket=?').run(n,n,bucket);
   db.prepare('INSERT INTO daily_jobs VALUES (?,?)').run(key,now);
  }
 });
}
