import test from "node:test";
import assert from "node:assert/strict";
import { currentZone, zoneInteriorMargin } from "../src/zone-presence.ts";

const now = 100000;
const square = [[-.001,-.001],[.001,-.001],[.001,.001],[-.001,.001],[-.001,-.001]];
const hole = [[-.0001,-.0001],[.0001,-.0001],[.0001,.0001],[-.0001,.0001],[-.0001,-.0001]];
const zone = { id:"zone", name:"Park", lat:0, lng:0, radius:100, tier:1, opensAt:0, closesAt:200000, geometry:{type:"Polygon",coordinates:[square]} };
const quest = {id:"quest",zone_id:"zone",completed:0,tier:1,opens_at:0,closes_at:200000};
const world = {arena:true,endsAt:200000,zones:[zone],quests:[quest]};
const p = {lat:0,lng:0};
const locate = (w=world, point=p, fix=null, arena=true, tier=1, time=now) => currentZone(w,point,fix,arena,tier,time);

test("zone hints follow the footprint rather than the radius or nearby objective", () => {
  assert.ok(zoneInteriorMargin(zone,p)>100);
  assert.equal(zoneInteriorMargin(zone,{lat:.002,lng:0}),null);
  assert.equal(zoneInteriorMargin({...zone,geometry:{type:"Polygon",coordinates:[square,hole]}},p),null);
  assert.equal(locate(world,{lat:.002,lng:0}),null);
});
test("disconnected activity areas and a circle fallback remain distinct footprints", () => {
  const second=square.map(([x,y])=>[x+.01,y]);
  const multi={...zone,geometry:{type:"MultiPolygon",coordinates:[[square],[second]]}};
  assert.ok(zoneInteriorMargin(multi,{lat:0,lng:.01})>100);
  assert.equal(zoneInteriorMargin(multi,{lat:0,lng:.005}),null);
  assert.ok(zoneInteriorMargin({...zone,geometry:undefined},p)>90);
});
test("GPS without a current, finite and matching fix never claims zone entry", () => {
  const physical={...world,arena:false},fix={...p,accuracy:5,timestamp:now};
  assert.equal(locate(physical,p,null,false),null);
  for(const bad of [{timestamp:now-15001},{timestamp:now+2001},{accuracy:NaN},{accuracy:-1},{lat:NaN},{lng:.001}])
    assert.equal(locate(physical,p,{...fix,...bad},false),null);
  assert.equal(locate(physical,p,fix,false).state,"ready");
  assert.equal(locate(physical,p,{...fix,accuracy:100},false).state,"uncertain");
  const edge={lat:0,lng:.00099};
  assert.equal(locate(physical,edge,{...edge,accuracy:5,timestamp:now},false).state,"uncertain");
});
test("closed, paused, locked and completed zones cannot advertise an available activity", () => {
  for(const update of [{opensAt:now+1},{closesAt:now},{placeStatus:"closed"},{operatorPause:{reason:"Closed path"}}]) {
    const result=locate({...world,zones:[{...zone,...update}]});
    assert.equal(result.state,"closed");assert.equal(result.count,0);assert.equal(result.questId,undefined);
  }
  assert.equal(locate({...world,zones:[{...zone,tier:2}]}).state,"locked");
  assert.equal(locate({...world,quests:[{...quest,completed:1}]}).state,"cleared");
});
test("only currently eligible unfinished activities appear; stale worlds and wrong modes disappear", () => {
  const result=locate({...world,quests:[quest,{...quest,id:"later",opens_at:now+1},{...quest,id:"closed",placeStatus:"closed"},{...quest,id:"locked",tier:2}]});
  assert.equal(result.count,1);assert.equal(result.questId,"quest");
  assert.equal(locate({...world,endsAt:now}),null);
  assert.equal(locate({...world,arena:false}),null);
  assert.equal(locate(world,p,null,true,1,NaN),null);
});
