import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {buildSourceIndex,querySourceIndex} from '../server/world-preparation/source-index.mjs';
import {planSourceRegions,exportGeographyRegion,contextBounds} from '../server/world-preparation/export.mjs';
import {ownerCell} from '../server/world-preparation/schema.mjs';
import {prepareGeographicDay} from '../server/world-preparation/geography.mjs';
import {latLngToCell,cellToLatLng,gridDisk,cellToParent} from 'h3-js';
const feature=(id,geometry,tags)=>({type:'Feature',id,geometry,properties:{tags}});
function setup(t){const root=mkdtempSync(resolve(tmpdir(),'ql-source-index-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const inputs={};for(const role of ['pois','paths','exclusions']){inputs[role]=resolve(root,role+'.seq');writeFileSync(inputs[role],'');}return{root,inputs};}
function park(id,lat,lng){return feature(id,{type:'Polygon',coordinates:[[[lng-.001,lat-.001],[lng+.001,lat-.001],[lng+.001,lat+.001],[lng-.001,lat+.001],[lng-.001,lat-.001]]]},{leisure:'park',name:'Fixture park '+id,access:'yes'});}
test('spatial queries preserve complete crossing geometry and deduplicate replicated transport records',async t=>{
 const {root,inputs}=setup(t),line=feature('osm:w1',{type:'LineString',coordinates:[[13,52],[14,52]]},{highway:'footway'});writeFileSync(inputs.paths,JSON.stringify(line)+'\n');
 const index=await buildSourceIndex({inputs,outputDir:resolve(root,'index')}),found=[];await querySourceIndex({indexFile:index.file,role:'paths',bounds:[13.24,51.99,13.51,52.01],visit:f=>found.push(f)});
 assert.equal(found.length,1);assert.deepEqual(found[0].geometry,line.geometry);
 const again=await buildSourceIndex({inputs,outputDir:resolve(root,'second')});assert.deepEqual(index.manifest,again.manifest);
 const cache=JSON.parse(readFileSync(index.file)),ref=Object.values(cache.roles.paths.tiles).flat()[0];writeFileSync(resolve(dirname(index.file),'paths',ref.file),'corrupt');
 await assert.rejects(querySourceIndex({indexFile:index.file,role:'paths',bounds:[13,51.99,14,52.01],visit:()=>{}}),/checksum/);
});
test('complete mapped-cell planning includes distant neighborhoods and places without parks',async t=>{
 const {root,inputs}=setup(t),seed=latLngToCell(52.514,13.355,7),owner=cellToParent(seed,5),cells=gridDisk(seed,4).filter(c=>cellToParent(c,5)===owner),far=cells.at(-1),a=cellToLatLng(seed),b=cellToLatLng(far);
 const points=[park('osm:w1',...a),feature('osm:n2',{type:'Point',coordinates:[b[1],b[0]]},{tourism:'artwork',name:'Distant fixture sculpture'})];writeFileSync(inputs.pois,points.map(p=>JSON.stringify(p)+'\n').join(''));
 const geometry={type:'Polygon',coordinates:[[[12,51],[15,51],[15,54],[12,54],[12,51]]]};const plans=await planSourceRegions({pois:inputs.pois,sourceGeometry:geometry});assert.equal(plans.plans.length,1);assert.equal(plans.plans[0].sections.length,2);assert.equal(plans.expectedOwners,1);
 writeFileSync(inputs.paths,JSON.stringify(feature('osm:w3',{type:'LineString',coordinates:[[a[1]-.005,a[0]],[a[1],a[0]],[b[1],b[0]],[b[1]+.005,b[0]]]},{highway:'footway',access:'yes'}))+'\n');
 const index=await buildSourceIndex({inputs,outputDir:resolve(root,'index')});
 // Indexed export must work without reopening the original whole-country files.
 for(const f of Object.values(inputs))renameSync(f,f+'.offline');
 const result=await exportGeographyRegion({inputs,sourceIndexFile:index.file,outputDir:resolve(root,'export'),plan:plans.plans[0],countries:['DE'],sourceDate:'2026-11-06T00:00:00Z',sourceCommit:'0'.repeat(40)});
 const built=await prepareGeographicDay({catalogFile:result.catalogFile,outputDir:resolve(root,'days'),day:'2026-11-07'});assert.equal(built.state,'content-prepared');assert.ok(built.counts.zone>=1);assert.ok(built.counts.quest>=2);
 const report=JSON.parse(readFileSync(resolve(root,'days/selection/2026-11-07/selection-report.json')));assert.equal(report.regions[0].sections.length,2);
});
test('an incomplete mapped section withholds its entire owner instead of silently shrinking coverage',async t=>{
 const {root,inputs}=setup(t),p=park('osm:w1',52.514,13.355);writeFileSync(inputs.pois,JSON.stringify(p)+'\n');
 const out=await planSourceRegions({pois:inputs.pois,sourceGeometry:p.geometry});assert.equal(out.plans.length,0);assert.equal(out.omitted.length,1);assert.equal(out.expectedOwners,1);assert.ok(out.omitted[0].missing.length);
});

test('a neighbor supplies complete border context; a gap cannot be hidden by source corners',async t=>{
 const a=setup(t),b=setup(t),lat=52.514,lng=13.355;
 writeFileSync(a.inputs.pois,JSON.stringify(park('osm:w1',lat,lng))+'\n');
 const c=gridDisk(latLngToCell(lat,lng,7),2).find(cell=>cellToParent(cell,5)===ownerCell({lat,lng})&&cellToLatLng(cell)[1]>lng+.005),pos=cellToLatLng(c);
 writeFileSync(b.inputs.pois,JSON.stringify(park('osm:w2',...pos))+'\n');
 const neighbor=await buildSourceIndex({inputs:b.inputs,outputDir:resolve(b.root,'index')});
 const box=(w,e)=>({type:'Polygon',coordinates:[[[w,51],[e,51],[e,54],[w,54],[w,51]]]});
 const primary=box(12,lng+.002),other=box(lng+.002,15);
 const alone=await planSourceRegions({pois:a.inputs.pois,sourceGeometry:primary});assert.equal(alone.plans.length,0);
 const complete=await planSourceRegions({pois:a.inputs.pois,sourceGeometry:primary,neighbors:[{indexFile:neighbor.file,geometry:other}]});assert.equal(complete.plans.length,1);assert.equal(complete.plans[0].sections.length,2);
 const gap=await planSourceRegions({pois:a.inputs.pois,sourceGeometry:primary,neighbors:[{indexFile:neighbor.file,geometry:box(lng+.004,15)}]});assert.equal(gap.plans.length,0);assert.equal(gap.omitted.length,1);
});
