import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceContexts} from '../server/world-preparation/source-context.mjs';
const source=(id,x,y,version=1)=>({id,indexFile:`/indexes/${id}/${version}.json`,geometry:{type:'Polygon',coordinates:[[[x,y],[x+1,y],[x+1,y+1],[x,y+1],[x,y]]]}});
test('distant new source does not reset a completed neighborhood, but a nearby source revision does',()=>{
 const a=source('a',13,49),b=source('b',14,49),distant=source('distant',-70,30);
 const before=sourceContexts([a,b],'scope'),after=sourceContexts([a,b,distant],'scope');
 assert.equal(before.get('a').hash,after.get('a').hash);assert.deepEqual(after.get('a').sources.map(s=>s.id),['a','b']);
 const changed=sourceContexts([a,source('b',14,49,2),distant],'scope');assert.notEqual(changed.get('a').hash,before.get('a').hash);
 assert.notEqual(sourceContexts([a,b],'new-scope').get('a').hash,before.get('a').hash);
});
