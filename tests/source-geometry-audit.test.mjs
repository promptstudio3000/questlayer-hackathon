import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {quarantineGeometry} from '../server/world-preparation/source-audit.mjs';
test('only unusable unrestrained candidates can be quarantined; restricted grounds always fail closed',()=>{
 const report={schema:'questlayer.geometry-reference-audit/1',incompleteAreas:[{id:'osm:r123',tags:{type:'boundary',boundary:'protected_area',name:'Incomplete reserve'},missingWays:1}]};
 assert.equal(quarantineGeometry(report).rejected[0].status,'rejected-candidate');
 for(const tags of [{amenity:'school'},{access:'private'},{foot:'no'},{landuse:'military'},{amenity:'place_of_worship'}])assert.throws(()=>quarantineGeometry({...report,incompleteAreas:[{...report.incompleteAreas[0],tags}]}),/restricted geometry/);
});
test('streamed reference audit retains the exact missing area identity and tags',()=>{
 const xml='<osm version="0.6"><node id="1" lat="0" lon="0"/><way id="10"><nd ref="1"/></way><relation id="20"><member type="way" ref="10" role="outer"/><member type="way" ref="99" role="outer"/><tag k="type" v="multipolygon"/><tag k="access" v="private"/></relation></osm>';
 const report=JSON.parse(execFileSync('python3',['scripts/poi/audit-geometry.py'],{input:xml,encoding:'utf8'}));assert.equal(report.presentWays,1);assert.equal(report.incompleteAreas[0].id,'osm:r20');assert.equal(report.incompleteAreas[0].tags.access,'private');assert.deepEqual(report.incompleteAreas[0].missingWaySample,['99']);assert.throws(()=>quarantineGeometry(report),/restricted/);
});
