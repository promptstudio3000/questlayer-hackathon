import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { geographicFeature, normalizeGeographicFeatures } from '../server/world-preparation/osm-features.mjs';
import { exportGeographyRegion, contextBounds, scanGeometry, planSourceRegions } from '../server/world-preparation/export.mjs';
import { ownerCell } from '../server/world-preparation/schema.mjs';
import { prepareGeographicDay } from '../server/world-preparation/geography.mjs';
const lat=52.514,lng=13.355,owner=ownerCell({lat,lng});
const ring=[[lng-.001,lat-.001],[lng+.001,lat-.001],[lng+.001,lat+.001],[lng-.001,lat+.001],[lng-.001,lat-.001]];
const raw=(id,geometry,tags={})=>({type:'Feature',id,geometry,properties:{tags}});
function workspace(t){const r=mkdtempSync(resolve(tmpdir(),'ql-geo-export-'));t.after(()=>rmSync(r,{recursive:true,force:true}));return r;}
function args(t){const root=workspace(t),coreBounds=[lng-.005,lat-.005,lng+.005,lat+.005],inputs={};
 const data={pois:[raw('osm:w1',{type:'MultiPolygon',coordinates:[[ring]]},{leisure:'park',name:'Export fixture park',access:'yes'}),raw('osm:w1',{type:'LineString',coordinates:ring},{leisure:'park',name:'Export fixture park',access:'yes'})],paths:[raw('osm:w2',{type:'LineString',coordinates:[[lng-.08,lat],[lng+.08,lat]]},{highway:'footway',access:'yes'})],exclusions:[]};
 for(const [role,features] of Object.entries(data)){inputs[role]=resolve(root,role+'.seq');writeFileSync(inputs[role],features.map(f=>JSON.stringify(f)+'\n').join(''));}
 return {root,inputs,outputDir:resolve(root,'export'),plan:{id:owner,coreBounds,contextBounds:contextBounds(coreBounds)},countries:['DE'],sourceDate:'2026-11-06T12:00:00Z',sourceCommit:'0'.repeat(40)};
}
test('single connected osmium area becomes a playable polygon without changing holes',async t=>{
 const a=args(t),result=await exportGeographyRegion(a),out=JSON.parse(readFileSync(resolve(a.outputDir,'pois.geojsonseq')));
 assert.equal(out.geometry.type,'Polygon');assert.deepEqual(out.geometry.coordinates,[ring]);assert.deepEqual(result.report.pois.merged,['osm:w1']);
 const built=await prepareGeographicDay({catalogFile:result.catalogFile,outputDir:resolve(a.root,'days'),day:'2026-11-07'});
 assert.equal(built.state,'content-prepared');assert.equal(built.counts.zone,1);assert.equal(built.counts.quest,1);
 const holes=[ring,ring.map(([x,y])=>[lng+(x-lng)/4,lat+(y-lat)/4])];
 assert.deepEqual(geographicFeature(raw('osm:w5',{type:'MultiPolygon',coordinates:[holes]})).geometry.coordinates,holes);
});
test('only exact closed line and single-ring area duplicates merge; conflicts and disconnected areas remain failures',()=>{
 const tags={name:'Test'},a=geographicFeature(raw('osm:w1',{type:'LineString',coordinates:ring},tags));
 const open=ring.slice(0,-1),rotated=[...open.slice(2),...open.slice(0,2)].reverse();rotated.push(rotated[0]);
 const b=geographicFeature(raw('osm:w1',{type:'MultiPolygon',coordinates:[[[...rotated]]]},tags));
 assert.equal(normalizeGeographicFeatures([a,b]).features[0].geometry.type,'Polygon');
 const hole=ring.map(([x,y])=>[lng+(x-lng)/4,lat+(y-lat)/4]);
 assert.throws(()=>normalizeGeographicFeatures([a,geographicFeature(raw('osm:w1',{type:'Polygon',coordinates:[ring,hole]},tags))]),/Conflicting/);
 assert.throws(()=>normalizeGeographicFeatures([a,{...b,tags:{name:'Different'}}]),/Conflicting/);
 assert.throws(()=>normalizeGeographicFeatures([a,{...a}]),/Conflicting/);
 assert.equal(geographicFeature(raw('osm:w3',{type:'MultiPolygon',coordinates:[[ring],[ring]]})).geometry.type,'MultiPolygon');
});
test('full crossing paths and neighboring exclusions are included by intersection, including holes',async t=>{
 const a=args(t),hole=ring.map(([x,y])=>[lng+.012+(x-lng)/4,lat+(y-lat)/4]),outer=ring.map(([x,y])=>[x+.012,y]);
 writeFileSync(a.inputs.exclusions,JSON.stringify(raw('osm:w9',{type:'MultiPolygon',coordinates:[[outer,hole]]},{amenity:'school'}))+'\n');
 await exportGeographyRegion(a);
 const path=JSON.parse(readFileSync(resolve(a.outputDir,'paths.geojsonseq'))),ex=JSON.parse(readFileSync(resolve(a.outputDir,'exclusions.geojsonseq')));
 assert.equal(path.geometry.coordinates[0][0],lng-.08);assert.deepEqual(ex.geometry.coordinates,[outer,hole]);
});
test('malformed exclusion outside the chosen core fails the full export, with no catalog seal',async t=>{
 const a=args(t);writeFileSync(a.inputs.exclusions,'{"broken":\n');
 await assert.rejects(exportGeographyRegion(a),/Malformed/);assert.equal(existsSync(resolve(a.outputDir,'catalog.json')),false);
});
test('empty companion is audited, hashes and bytes rebuild identically, changed inputs cannot overwrite',async t=>{
 const a=args(t);await exportGeographyRegion(a);const bytes=readFileSync(resolve(a.outputDir,'catalog.json'));
 assert.equal(JSON.parse(readFileSync(resolve(a.outputDir,'export-report.json'))).exclusions.scanned.count,0);
 await exportGeographyRegion({...a,outputDir:resolve(a.root,'second')});assert.deepEqual(bytes,readFileSync(resolve(a.root,'second/catalog.json')));
 writeFileSync(a.inputs.paths,readFileSync(a.inputs.paths,'utf8').replace('footway','private'));
 await assert.rejects(exportGeographyRegion(a),/Immutable/);
});
test('planning requires entire context inside source geometry, and validates records rather than inventing coverage',async t=>{
 const a=args(t),wide={type:'Polygon',coordinates:[[[12,52],[14,52],[14,54],[12,54],[12,52]]]};
 const full=await planSourceRegions({pois:a.inputs.pois,sourceGeometry:wide});assert.equal(full.plans.length,1);assert.equal(full.plans[0].id,owner);
 const edge=await planSourceRegions({pois:a.inputs.pois,sourceGeometry:{type:'Polygon',coordinates:[ring]}});assert.equal(edge.plans.length,0);assert.match(edge.omitted[0].missing[0].reason,/neighboring/);
 writeFileSync(a.inputs.paths,'\x1e'+JSON.stringify(raw('osm:n9',{type:'Point',coordinates:[lng,lat]},{name:'Žluťoučký'}))+'\n');
 let name;await scanGeometry(a.inputs.paths,f=>name=f.tags.name);assert.equal(name,'Žluťoučký');
});

test('OSM revisions are reconciled across POI/path/ground roles, keeping newer restrictions',async()=>{
 const {latestGeographicRoles,sourceFeature}=await import('../server/world-preparation/osm-features.mjs');
 const old=geographicFeature({...raw('osm:w99',{type:'Polygon',coordinates:[ring]}),properties:{tags:{leisure:'park',name:'Older public site'},'@version':1}});
 const newer=geographicFeature({...raw('osm:w99',{type:'Polygon',coordinates:[ring]}),properties:{tags:{access:'private'},'@version':2}});
 const result=latestGeographicRoles({pois:[old],paths:[],exclusions:[newer,newer]});assert.equal(result.roles.pois.length,0);assert.equal(result.roles.exclusions.length,1);assert.equal(result.audit.pois.superseded,1);assert.equal(result.audit.exclusions.duplicates,1);assert.equal(sourceFeature(newer).properties['@version'],'2');
});
