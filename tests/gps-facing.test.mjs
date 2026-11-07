import test from "node:test";
import assert from "node:assert/strict";
import { advanceGpsFacing, initialGpsFacing } from "../src/gps-facing.ts";
import { stepFrom } from "../src/map-motion.ts";

const now=1_800_000_000_000;
const start={lat:49.74745,lng:13.3774,accuracy:4,timestamp:now};
const observe=(state,fix,at=fix.timestamp)=>advanceGpsFacing(state,fix,at);
test("a current moving course turns immediately, including north and wraparound",()=>{
 let state=observe(initialGpsFacing(),{...start,heading:0,speed:1.4});
 assert.equal(state.state.heading,0);assert.equal(state.resumed,true);
 state=observe(state.state,{...start,timestamp:now+1000,heading:361,speed:1.4});
 assert.equal(state.state.heading,1);assert.equal(state.resumed,false);
});
test("missing course accumulates real fixes, not tiny marker interpolation; later course loss can turn",()=>{
 let state=observe(initialGpsFacing(),{...start,heading:90,speed:1.4}).state;
 state=observe(state,{...start,...stepFrom(start,0,1),timestamp:now+1000,heading:null,speed:null}).state;
 assert.equal(state.heading,90);
 state=observe(state,{...start,...stepFrom(start,0,4),timestamp:now+2000,heading:null,speed:null}).state;
 assert.ok(Math.abs(state.heading)<.1);
 state=observe(state,{...start,...stepFrom({...start,...stepFrom(start,0,4)},270,4),timestamp:now+3000,heading:null,speed:null}).state;
 assert.ok(Math.abs(state.heading-270)<.1);
});
test("stationary jitter and inaccurate, stale, future, invalid or reordered fixes keep facing",()=>{
 const state=observe(initialGpsFacing(),{...start,heading:45,speed:1.4}).state;
 for(const fix of [
  {...start,...stepFrom(start,180,6),timestamp:now+1000,heading:180,speed:0},
  {...start,timestamp:now+1000,heading:180,speed:1.4,accuracy:80},
  {...start,timestamp:now-1000,heading:180,speed:1.4},
  {...start,timestamp:now+4000,heading:180,speed:1.4},
  {...start,timestamp:now+1000,lat:NaN,heading:180,speed:1.4},
 ])assert.equal(observe(state,fix,now+1000).state.heading,45);
 assert.equal(observe(state,{...start,timestamp:now+1000,heading:180,speed:1.4},now+20000).state.heading,45);
});
test("large GPS jumps re-anchor without inventing a turn; resumed walking restores follow once",()=>{
 let state=observe(initialGpsFacing(),{...start,heading:90,speed:1.4}).state;
 const jumped={...start,...stepFrom(start,180,500),timestamp:now+5000,heading:null,speed:null};
 const ignored=observe(state,jumped);assert.equal(ignored.state.heading,90);assert.equal(ignored.resumed,false);
 const resumed=observe(ignored.state,{...jumped,...stepFrom(jumped,270,4),timestamp:now+6000});
 assert.ok(Math.abs(resumed.state.heading-270)<.1);assert.equal(resumed.resumed,true);
 const next=observe(resumed.state,{...jumped,...stepFrom(jumped,270,8),timestamp:now+7000});assert.equal(next.resumed,false);
});
