import test from "node:test";
import assert from "node:assert/strict";
import { nearbyAction } from "../src/nearby-action.ts";

const position = {lat:0,lng:0};
const point = m => ({lat:m/6371000*180/Math.PI,lng:0});
const quest = changes => ({id:"quest",title:"A chest",zone_id:"zone",tier:1,completed:0,opens_at:100,closes_at:200,...position,...changes});
const zone = changes => ({id:"zone",...position,...changes});
const actor = changes => ({id:"actor",kind:"npc",model:"pilgrim",name:"Wayfinder",segments:[],...changes});
const choose = (changes={}) => nearbyAction({world:{quests:[],coins:[],zones:[]},position,tier:1,now:150,actors:[],...changes});

test("the next quest checkpoint supplies the cue, rather than a remote zone centre",()=>{
  const q=quest({...point(1000),nextPoint:point(24)});
  assert.equal(choose({world:{quests:[q],zones:[zone(point(2000))],coins:[]}})?.id,"quest");
  q.nextPoint=point(26);
  assert.equal(choose({world:{quests:[q],zones:[zone()],coins:[]}}),null);
});
test("closed, paused, completed, future, expired and gated quests never invent a ready cue",()=>{
  for(const patch of [{completed:1},{opens_at:151},{closes_at:150},{tier:2},{placeStatus:"closed"}])
    assert.equal(choose({world:{quests:[quest(patch)],zones:[zone()],coins:[]}}),null);
  for(const patch of [{placeStatus:"closed"},{operatorPause:{reason:"review"}}])
    assert.equal(choose({world:{quests:[quest()],zones:[zone(patch)],coins:[]}}),null);
  assert.equal(choose({world:{quests:[quest()],zones:[],coins:[]}}),null);
  assert.equal(choose({now:100,world:{quests:[quest()],zones:[zone()],coins:[]}})?.kind,"quest");
});
test("actor cues respect moving/station radii, hidden reveals and unavailable states",()=>{
  const near=(distanceM,stationary=false,changes={})=>choose({actors:[{actor:actor(changes),distanceM,stationary}]});
  assert.equal(near(35)?.kind,"actor");
  assert.equal(near(35.1),null);
  assert.equal(near(50,true)?.kind,"actor");
  assert.equal(near(50.1,true),null);
  for(const state of ["cooldown","defeated"])assert.equal(near(1,true,{state}),null);
  assert.equal(near(20,false,{revealRadiusM:10}),null);
  for(const n of [NaN,Infinity,-1])assert.equal(near(n),null);
});
test("find previews open before automatic pickup without adding a manual coin claim",()=>{
  const coins=[{id:"find",find:true,claimant:null,...point(50)}];
  assert.equal(choose({world:{quests:[],zones:[],coins}})?.kind,"find");
  for(const patch of [{find:false},{claimant:"someone"},point(61)])
    assert.equal(choose({world:{quests:[],zones:[],coins:[{...coins[0],...patch}]}}),null);
});
test("an eligible selected checkpoint wins over a suggestion, while a distant one does not",()=>{
  const input={preferredQuestId:"quest",world:{quests:[quest(point(24))],zones:[zone()],coins:[]},actors:[{actor:actor(),distanceM:1,stationary:true}]};
  assert.equal(choose(input)?.kind,"quest");
  input.world.quests=[quest(point(30))];
  assert.equal(choose(input)?.kind,"actor");
  assert.equal(choose({world:null,actors:input.actors}),null);
});
