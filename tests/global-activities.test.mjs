import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase, createPlayer } from "../server/database.mjs";
import { ensureWorld, worldView } from "../server/world.mjs";
import { claimQuest, advanceRoute } from "../server/game.mjs";
import { cellToLatLng, latLngToCell, cellToBoundary, gridDisk } from "h3-js";
import { changeSystemPlace } from "../server/spatial/place-safety.mjs";
import { prepareGeographicDay, completeOsmGeometry, geographyInputs, GEOGRAPHY_SCHEMA } from "../server/world-preparation/geography.mjs";
import { ownerCell } from "../server/world-preparation/schema.mjs";
import { sha256, canonical } from "../server/world-preparation/canonical.mjs";
import { installGlobalActivityDay, installGlobalActivityDayAsync, preparedActivityWorld, globalActivityStatus, startGlobalActivityLoader } from "../server/global-activities.mjs";

const day = "2026-11-06", now = Date.parse(`${day}T12:00:00Z`);
const sites = [[52.514,13.355,"DE"],[-33.926,18.416,"ZA"],[35.69,139.69,"JP"],[40.731,-73.997,"US"],[-34.595,-58.377,"AR"],[-33.873,151.211,"AU"]];
function workspace(t) { const root = mkdtempSync(resolve(tmpdir(), "questlayer-global-play-")); t.after(() => rmSync(root,{recursive:true,force:true})); return root; }
function catalogAt(root, list = sites) {
  mkdirSync(root,{recursive:true});
  const regions = list.map(([lat,lng,country], i) => {
    const geometry={type:"Polygon",coordinates:[[[lng-.0012,lat-.0012],[lng+.0012,lat-.0012],[lng+.0012,lat+.0012],[lng-.0012,lat+.0012],[lng-.0012,lat-.0012]]]};
    const features=[
      {type:"Feature",id:`osm:w${i*10+1}`,geometry,properties:{tags:{leisure:"park",name:`Synthetic park ${i}`,access:"yes"}}},
      {type:"Feature",id:`osm:w${i*10+2}`,geometry:{type:"LineString",coordinates:[[lng-.002,lat],[lng+.002,lat]]},properties:{tags:{highway:"footway",access:"yes"}}},
      {type:"Feature",id:`osm:n${i*10+3}`,geometry:{type:"Point",coordinates:[lng+.0001,lat]},properties:{tags:{tourism:"artwork",name:"Private fixture artwork",access:"private"}}},
    ];
    const bytes=canonical({type:"FeatureCollection",features}), file=`${i}.json`;writeFileSync(resolve(root,file),bytes);
    return {id:ownerCell({lat,lng}),status:"complete",file,sha256:sha256(bytes),countries:[country],coreBounds:[lng-.006,lat-.006,lng+.006,lat+.006],contextBounds:[lng-.04,lat-.04,lng+.04,lat+.04],sourceDate:"2026-11-05T12:00:00Z",coverageReason:"Synthetic test coverage."};
  });
  const catalog={schema:GEOGRAPHY_SCHEMA,sourceCommit:"0".repeat(40),version:"synthetic-controls",regions,closures:[],recentPoiIds:[]};
  const file=resolve(root,"catalog.json");writeFileSync(file,canonical(catalog));return file;
}

test("all six continents are selected before arrival and existing GPS claims return one durable XP result",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input")), outputDir=resolve(root,"days");
  const manifest=await prepareGeographicDay({catalogFile,outputDir,day});
  assert.equal(manifest.state,"content-prepared");assert.equal(manifest.counts.zone,6);assert.equal(manifest.counts.quest,6);
  const db=openDatabase(":memory:");t.after(()=>db.close());
  const treasury=db.prepare("SELECT * FROM treasury ORDER BY bucket").all();
  const file=resolve(outputDir,day,"manifest.json");
  installGlobalActivityDay(db,file);
  assert.equal(globalActivityStatus(db).days[0].loadedRegions,6);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quests").get().n,6);
  for(const [lat,lng] of sites){
    const player=createPlayer(db,"Global fixture",now);
    const before=db.prepare("SELECT COUNT(*) n FROM worlds").get().n;
    const world=await ensureWorld(db,{lat,lng},false,now,{globalActivities:true,mapData:{fetch(){throw Error("request-path generation forbidden")}}});
    const view=worldView(db,world.id,player,{now});
    assert.equal(view.quests.length,1);assert.equal(view.quests[0].author.name,"Atlas");assert.equal(view.globalPreparation.financialActivation,false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,before);
    const q=view.quests[0], fix={lat:q.lat,lng:q.lng,accuracy:5,timestamp:now};
    assert.throws(()=>claimQuest(db,player,q.id,{...fix,lat:fix.lat+.01},now),/closer|range/i);
    const first=claimQuest(db,player,q.id,fix,now), replay=claimQuest(db,player,q.id,fix,now);
    assert.equal(first.reward,0);assert.equal(first.xp,40);assert.equal(first.item,null);assert.equal(replay.replayed,true);assert.equal(first.result.id,replay.result.id);
    assert.equal(db.prepare("SELECT xp FROM players WHERE id=?").get(player).xp,40);
  }
  installGlobalActivityDay(db,file);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quests").get().n,6);
  assert.deepEqual(db.prepare("SELECT * FROM treasury ORDER BY bucket").all(),treasury);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM coins").get().n,0);
});

test("partial imports cannot be read or claimed and resume without replacing identities",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,2)), outputDir=resolve(root,"days");
  const manifest=await prepareGeographicDay({catalogFile,outputDir,day}), file=resolve(outputDir,day,"manifest.json");
  const broken=resolve(outputDir,day,manifest.regions.at(-1).server.path), bytes=readFileSync(broken);
  writeFileSync(broken,"broken");
  const db=openDatabase(":memory:");t.after(()=>db.close());
  assert.throws(()=>installGlobalActivityDay(db,file),error=>/checksum/.test(error.message) && error.region===manifest.regions.at(-1).id);
  const player=createPlayer(db,"Partial fixture",now), q=db.prepare("SELECT * FROM quests LIMIT 1").get();assert.ok(q);
  assert.equal(globalActivityStatus(db).days[0].state,"loading");
  assert.throws(()=>worldView(db,q.world_id,player,{now}),/still being prepared/);
  assert.throws(()=>claimQuest(db,player,q.id,{lat:q.lat,lng:q.lng,accuracy:5,timestamp:now},now),/closed/);
  writeFileSync(broken,bytes);installGlobalActivityDay(db,file);
  assert.equal(globalActivityStatus(db).days[0].state,"ready");
  assert.equal(db.prepare("SELECT opens_at FROM quests WHERE id=?").get(q.id).opens_at,Date.parse(`${day}T00:00:00Z`));
});

test("a failed live import identifies its corrupt region without exposing private file paths",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,2)), directory=resolve(root,"days");
  const manifest=await prepareGeographicDay({catalogFile,outputDir:directory,day});
  const broken=manifest.regions.at(-1);writeFileSync(resolve(directory,day,broken.server.path),"broken");
  const db=openDatabase(":memory:");t.after(()=>db.close());
  const loader=startGlobalActivityLoader(db,{directory,clock:()=>now,log:()=>{}});t.after(()=>loader.stop());
  await loader.run();loader.stop();
  const status=loader.status().days.find(d=>d.day===day);
  assert.equal(status.state,"incomplete");assert.equal(status.missingRegions[0].id,broken.id);
  assert.equal(globalActivityStatus(db).days[0].state,"loading");
  assert.ok(!JSON.stringify(status).includes(root));assert.ok(!JSON.stringify(status).includes(broken.server.path));
});

test("uncovered places and missing next days never generate a fallback world",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), outputDir=resolve(root,"days");
  await prepareGeographicDay({catalogFile,outputDir,day});
  const db=openDatabase(":memory:");t.after(()=>db.close());installGlobalActivityDay(db,resolve(outputDir,day,"manifest.json"));
  assert.throws(()=>preparedActivityWorld(db,{lat:0,lng:0},now),/No prepared discoveries/);
  await assert.rejects(ensureWorld(db,{lat:0,lng:0},false,now,{globalActivities:true}),/No prepared discoveries/);
  assert.throws(()=>preparedActivityWorld(db,{lat:sites[0][0],lng:sites[0][1]},now+86400000),/No prepared discoveries/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,1);
});

test("private POIs, missing paths and operator closures cannot become playable targets",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1));
  const catalog=JSON.parse(readFileSync(catalogFile));catalog.closures=[{id:"osm:w1",geometry:{type:"Polygon",coordinates:[[[13.35,52.51],[13.36,52.51],[13.36,52.52],[13.35,52.52],[13.35,52.51]]]},scope:"poi",version:1}];
  writeFileSync(catalogFile,canonical(catalog));
  const closed=await prepareGeographicDay({catalogFile,outputDir:resolve(root,"closed"),day});assert.equal(closed.counts.quest,0);assert.equal(closed.counts.zone,0);
  catalog.closures=[];const source=resolve(root,"input/0.json"), raw=JSON.parse(readFileSync(source));raw.features=raw.features.filter(f=>f.id!=="osm:w2");const bytes=canonical(raw);writeFileSync(source,bytes);catalog.regions[0].sha256=sha256(bytes);writeFileSync(catalogFile,canonical(catalog));
  const noPaths=await prepareGeographicDay({catalogFile,outputDir:resolve(root,"no-paths"),day});assert.equal(noPaths.counts.quest,0);
});

test("multipolygon holes and split ways survive, and missing restricted shells fail closed",()=>{
  const coords=r=>r.map(([lon,lat])=>({lon,lat}));
  const e={type:"relation",id:1,tags:{type:"multipolygon",leisure:"park",name:"Geometry fixture"},members:[
    {role:"outer",geometry:coords([[0,0],[1,0],[1,1]])},{role:"outer",geometry:coords([[0,0],[0,1],[1,1]])},
    {role:"inner",geometry:coords([[.2,.2],[.3,.2],[.3,.3],[.2,.3],[.2,.2]])},
  ]};assert.equal(completeOsmGeometry(e).coordinates.length,2);
  const broken={...e,tags:{...e.tags,amenity:"school"},members:e.members.slice(0,1)};
  assert.throws(()=>geographyInputs({elements:[broken]}),/Unclosed/);
});

test("source changes cannot overwrite a frozen geographic selection",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), outputDir=resolve(root,"days");
  const a=await prepareGeographicDay({catalogFile,outputDir,day});const b=await prepareGeographicDay({catalogFile,outputDir,day});assert.deepEqual(b,a);
  const catalog=JSON.parse(readFileSync(catalogFile));catalog.recentPoiIds=["osm:w1"];writeFileSync(catalogFile,canonical(catalog));
  await assert.rejects(prepareGeographicDay({catalogFile,outputDir,day}),/Immutable/);
});

test("a prepared three-stop hunt uses the existing unordered GPS flow and receipt", async(t)=>{
  const root=workspace(t), [lat,lng]=cellToLatLng(latLngToCell(...sites[0].slice(0,2),7));
  const catalogFile=catalogAt(resolve(root,"input"),[[lat,lng,"DE"]]), catalog=JSON.parse(readFileSync(catalogFile));
  const features=[-.004,0,.004].map((dx,i)=>({type:"Feature",id:`osm:n${i+1}`,geometry:{type:"Point",coordinates:[lng+dx,lat]},properties:{tags:{tourism:"artwork",name:`Hunt fixture ${i}`}}}));
  for(const [dy,id] of [[-.003,4],[.003,5]]) features.push({type:"Feature",id:`osm:n${id}`,geometry:{type:"Point",coordinates:[lng,lat+dy]},properties:{tags:{historic:"memorial",name:`Other fixture ${id}`}}});
  features.push({type:"Feature",id:"osm:w99",geometry:{type:"LineString",coordinates:[[lng-.006,lat],[lng+.006,lat]]},properties:{tags:{highway:"footway"}}});
  features.push({type:"Feature",id:"osm:w98",geometry:{type:"LineString",coordinates:[[lng,lat-.005],[lng,lat+.005]]},properties:{tags:{highway:"footway"}}});
  const bytes=canonical({type:"FeatureCollection",features});writeFileSync(resolve(root,"input/0.json"),bytes);catalog.regions[0].sha256=sha256(bytes);writeFileSync(catalogFile,canonical(catalog));
  const outputDir=resolve(root,"days");await prepareGeographicDay({catalogFile,outputDir,day});
  const db=openDatabase(":memory:");t.after(()=>db.close());installGlobalActivityDay(db,resolve(outputDir,day,"manifest.json"));
  const player=createPlayer(db,"Hunt fixture",now), world=preparedActivityWorld(db,{lat,lng},now), q=worldView(db,world.id,player,{now}).quests.find(q=>q.kind==="route");assert.ok(q);
  const stops=q.activity.steps.map(s=>s.point);let time=now;
  const fix=i=>({...stops[i],accuracy:5,timestamp:time});
  advanceRoute(db,player,q.id,fix(2),0,time);time+=600000;
  assert.throws(()=>advanceRoute(db,player,q.id,fix(2),1,time),/closer/);time+=600000;
  advanceRoute(db,player,q.id,fix(0),1,time);time+=600000;
  const result=advanceRoute(db,player,q.id,fix(1),2,time);
  assert.equal(result.xp,90);assert.equal(result.reward,0);assert.equal(result.item,null);
  const replay=claimQuest(db,player,q.id,fix(1),time);assert.equal(replay.result.id,result.result.id);
});

test("a live POI closure blocks an already imported geographic quest",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), outputDir=resolve(root,"days");
  await prepareGeographicDay({catalogFile,outputDir,day});
  const db=openDatabase(":memory:");t.after(()=>db.close());installGlobalActivityDay(db,resolve(outputDir,day,"manifest.json"));
  const player=createPlayer(db,"Closure fixture",now), world=preparedActivityWorld(db,{lat:sites[0][0],lng:sites[0][1]},now), zone=world.zones[0];
  changeSystemPlace(db,{id:"poi",candidates:[{id:zone.sourceId,geometry:zone.geometry}]},{actor:"test-operator",operationId:"close-imported",candidateId:zone.sourceId,action:"close",reason:"Fixture closure",expectedVersion:0},{isOperator:()=>true,clock:()=>now});
  const q=worldView(db,world.id,player,{now}).quests[0];assert.equal(q.placeStatus,"closed");
  assert.throws(()=>claimQuest(db,player,q.id,{lat:q.lat,lng:q.lng,accuracy:5,timestamp:now},now),/temporarily closed/);
});

test("known hours are not promoted to all-day access and Plzen remains outside automatic cells",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),[[49.7475,13.3776,"CZ"]]);
  const plzen=await prepareGeographicDay({catalogFile,outputDir:resolve(root,"days"),day});
  assert.equal(plzen.counts.zone,0);assert.equal(plzen.counts.quest,0);
  const raw=JSON.parse(readFileSync(resolve(root,"input/0.json")));raw.features[0].properties.tags.opening_hours="Mo-Fr 08:00-16:00";raw.features[1].properties.tags["foot:conditional"]="no @ (sunset-sunrise)";
  const inputs=geographyInputs(raw);assert.equal(inputs.paths.length,0);assert.ok(!inputs.pois.some(p=>p.id==="osm:w1"));assert.equal(inputs.geometryReport.length,2);
});

test("existing osmium GeoJSON sequences feed the same selector with complete companion inputs",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), catalog=JSON.parse(readFileSync(catalogFile)), raw=JSON.parse(readFileSync(resolve(root,"input/0.json")));
  const expected=await prepareGeographicDay({catalogFile,outputDir:resolve(root,"expected"),day});
  const d=catalog.regions[0];delete d.file;delete d.sha256;d.inputs={};
  for(const [kind,features] of [["pois",[raw.features[0],raw.features[2]]],["paths",[raw.features[1]]],["exclusions",[]]]){
    const bytes=features.map(f=>"\x1e"+JSON.stringify({...f,id:undefined,properties:{"@type":f.id[4]==="w"?"way":"node","@id":Number(f.id.slice(5)),...f.properties.tags}})).join("\n"), file=`${kind}.geojsonseq`;
    writeFileSync(resolve(root,"input",file),bytes);d.inputs[kind]={file,sha256:sha256(bytes)};
  }
  writeFileSync(catalogFile,canonical(catalog));
  const actual=await prepareGeographicDay({catalogFile,outputDir:resolve(root,"actual"),day});assert.deepEqual(actual.counts,expected.counts);
});

test("a collector catalog with a missing exclusion companion never opens an empty-looking day",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1));
  const c=JSON.parse(readFileSync(catalogFile)), d=c.regions[0];delete d.file;delete d.sha256;
  writeFileSync(resolve(root,"input/empty.geojsonseq"),"");
  d.inputs={pois:{file:"empty.geojsonseq",sha256:sha256("")},paths:{file:"empty.geojsonseq",sha256:sha256("")}};
  writeFileSync(catalogFile,canonical(c));
  const outputDir=resolve(root,"days"), result=await prepareGeographicDay({catalogFile,outputDir,day});
  assert.equal(result.state,"incomplete");
  assert.ok(result.regions.some(r=>r.state!=="prepared" && /all three/.test(r.reason)));
  const db=openDatabase(":memory:");t.after(()=>db.close());
  assert.throws(()=>installGlobalActivityDay(db,resolve(outputDir,day,"manifest.json")));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,0);
});

test("the background worker prepares and installs today and tomorrow without a visitor",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), db=openDatabase(":memory:");t.after(()=>db.close());
  const errors=[], loader=startGlobalActivityLoader(db,{directory:resolve(root,"days"),catalogFile,clock:()=>now,log:e=>errors.push(e)});t.after(()=>loader.stop());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,0);
  await loader.run();loader.stop();assert.deepEqual(errors,[]);
  assert.equal(globalActivityStatus(db).days.length,2);assert.ok(globalActivityStatus(db).days.every(d=>d.state==="ready"));assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,2);
});

test("live imports yield between regions, remain unclaimable on cancellation and resume exactly once",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input")), outputDir=resolve(root,"days");
  await prepareGeographicDay({catalogFile,outputDir,day});
  const file=resolve(outputDir,day,"manifest.json"), db=openDatabase(":memory:");t.after(()=>db.close());
  const player=createPlayer(db,"Import interruption fixture",now), abort=new AbortController();
  let serviced=false, importedQuest;
  await assert.rejects(installGlobalActivityDayAsync(db,file,{signal:abort.signal,onProgress(progress){
    assert.equal(progress.processedRegions,1);
    setImmediate(()=>{
      serviced=true;
      assert.equal(globalActivityStatus(db).days[0].loadedRegions,1);
      assert.equal(globalActivityStatus(db).days[0].state,"loading");
      importedQuest=db.prepare("SELECT * FROM quests LIMIT 1").get();
      assert.throws(()=>worldView(db,importedQuest.world_id,player,{now}),/still being prepared/);
      assert.throws(()=>claimQuest(db,player,importedQuest.id,{lat:importedQuest.lat,lng:importedQuest.lng,accuracy:5,timestamp:now},now),/closed/);
      abort.abort();
    });
  }}),{name:"AbortError"});
  assert.equal(serviced,true,"The event loop must service other work before the next region.");
  assert.equal(globalActivityStatus(db).days[0].loadedRegions,1);
  await installGlobalActivityDayAsync(db,file);
  await installGlobalActivityDayAsync(db,file);
  assert.equal(globalActivityStatus(db).days[0].state,"ready");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quests").get().n,6);
  const fix={lat:importedQuest.lat,lng:importedQuest.lng,accuracy:5,timestamp:now};
  const first=claimQuest(db,player,importedQuest.id,fix,now), replay=claimQuest(db,player,importedQuest.id,fix,now);
  assert.equal(first.xp,40);assert.equal(replay.replayed,true);assert.equal(first.result.id,replay.result.id);
});

test("one broken date does not block the next date, retries back off and repaired data recovers",async(t)=>{
  const root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),sites.slice(0,1)), directory=resolve(root,"days");
  const tomorrow=new Date(now+86400000).toISOString().slice(0,10);
  await prepareGeographicDay({catalogFile,outputDir:directory,day});
  await prepareGeographicDay({catalogFile,outputDir:directory,day:tomorrow});
  const file=resolve(directory,day,"manifest.json"), original=readFileSync(file);writeFileSync(file,"broken");
  const db=openDatabase(":memory:");t.after(()=>db.close());let time=now;const errors=[];
  const loader=startGlobalActivityLoader(db,{directory,clock:()=>time,log:e=>errors.push(e)});t.after(()=>loader.stop());
  await loader.run();
  assert.deepEqual(globalActivityStatus(db).days.map(d=>[d.day,d.state]),[[tomorrow,"ready"]]);
  const failed=loader.status().days.find(d=>d.day===day);
  assert.equal(failed.state,"incomplete");assert.equal(failed.retryAt,now+60000);
  writeFileSync(file,original);
  await loader.run();assert.equal(errors.length,1);assert.equal(globalActivityStatus(db).days.length,1);
  time+=60000;await loader.run();
  assert.equal(globalActivityStatus(db).days.length,2);assert.ok(loader.status().days.every(d=>d.state==="ready"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM quests").get().n,2);
  loader.stop();await loader.run();assert.equal(errors.length,1);
});

test("a supplied-day loader reports absent manifests instead of claiming preparation",async(t)=>{
  const root=workspace(t), db=openDatabase(":memory:");t.after(()=>db.close());
  const loader=startGlobalActivityLoader(db,{directory:resolve(root,"missing"),clock:()=>now});t.after(()=>loader.stop());
  await loader.run();loader.stop();
  assert.equal(loader.status().days.length,2);
  assert.ok(loader.status().days.every(d=>d.state==="awaiting-content" && d.problems.length));
  assert.equal(globalActivityStatus(db).days.length,0);
});

test("a target across an ownership edge loads its original quest without creating a neighbor",async(t)=>{
  let pair;
  for(const cell of gridDisk(latLngToCell(52.514,13.355,7),8)) {
    const edge=cellToBoundary(cell);
    for(let i=0;i<edge.length;i++) {
      const lat=(edge[i][0]+edge[(i+1)%edge.length][0])/2, lng=(edge[i][1]+edge[(i+1)%edge.length][1])/2;
      const label={lat:lat-.00001,lng},target={lat:lat+.00001,lng};
      if(ownerCell(label)!==ownerCell(target)) {pair={label,target};break;}
    }
    if(pair) break;
  }
  assert.ok(pair);const {label,target}=pair, root=workspace(t), catalogFile=catalogAt(resolve(root,"input"),[[label.lat,label.lng,"DE"]]), catalog=JSON.parse(readFileSync(catalogFile));
  const raw={type:"FeatureCollection",features:[{type:"Feature",id:"osm:n1",geometry:{type:"Point",coordinates:[label.lng,label.lat]},properties:{tags:{tourism:"artwork",name:"Border fixture"}}},{type:"Feature",id:"osm:w2",geometry:{type:"LineString",coordinates:[[target.lng-.00001,target.lat],[target.lng+.00001,target.lat]]},properties:{tags:{highway:"footway"}}}]};
  const bytes=canonical(raw);writeFileSync(resolve(root,"input/0.json"),bytes);catalog.regions[0].sha256=sha256(bytes);writeFileSync(catalogFile,canonical(catalog));
  const outputDir=resolve(root,"days");await prepareGeographicDay({catalogFile,outputDir,day});
  const db=openDatabase(":memory:");t.after(()=>db.close());installGlobalActivityDay(db,resolve(outputDir,day,"manifest.json"));
  const player=createPlayer(db,"Border fixture",now), world=preparedActivityWorld(db,target,now);assert.equal(world.region,ownerCell(label));
  const q=worldView(db,world.id,player,{now}).quests[0];assert.equal(claimQuest(db,player,q.id,{...target,accuracy:5,timestamp:now},now).xp,40);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM worlds").get().n,1);
});
