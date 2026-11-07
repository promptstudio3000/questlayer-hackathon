import test from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell } from 'h3-js';
import { buildLaunchScope, launchOwnerFilter, EU_COUNTRIES } from '../server/world-preparation/launch-scope.mjs';
import { globalCoverage } from '../server/world-preparation/coverage.mjs';
import { sha256 } from '../server/world-preparation/canonical.mjs';

function setup() {
  const source=(id,parent,country,lng,lat)=>({properties:{id,parent,'iso3166-1:alpha2':country?[country]:[],urls:{pbf:`https://download.geofabrik.de/${id}.osm.pbf`}},geometry:{type:'Polygon',coordinates:[[[lng-5,lat-5],[lng+5,lat-5],[lng+5,lat+5],[lng-5,lat+5],[lng-5,lat-5]]]}});
  const index={features:[source('europe',null,null,0,0),source('czechia','europe','CZ',14,50),source('russia',null,'RU',37,55),source('iran',null,'IR',51,35),source('north-korea',null,'KP',125,39),source('us-state',null,'US',-77,39),source('japan',null,'JP',139,35),source('rural',null,'MA',-6,32)]};
  const city=(id,name,country,lng,lat)=>[id,name,name,'',lat,lng,'P','PPLC',country,'','','','','',1000,'','',country==='JP'?'Asia/Tokyo':'UTC','2026-11-01'].join('\t');
  const citiesText=[city('1','Prague','CZ',14,50),city('2','Tokyo','JP',139.7,35.7),city('3','Moscow','RU',37,55),city('4','Tehran','IR',51,35),city('5','Pyongyang','KP',125,39)].join('\n');
  const indexBytes=Buffer.from(JSON.stringify(index));
  return {index,indexBytes,citiesText,scope:buildLaunchScope({index,indexBytes,citiesText,citiesSha256:'a'.repeat(64)})};
}

test('launch selection retains Europe and US, restricts other sources to real capitals, and excludes only the agreed countries',()=>{
  const {scope}=setup();assert.deepEqual(scope.sources.map(s=>[s.id,s.mode]),[['czechia','full'],['japan','capitals'],['us-state','full']]);
  assert.deepEqual(scope.excludedCountries,['IR','KP','RU']);assert.deepEqual(scope.unmappedCapitals,[]);
  assert.equal(launchOwnerFilter(scope,'japan')(latLngToCell(35.7,139.7,5)),true);
  assert.equal(launchOwnerFilter(scope,'japan')(latLngToCell(34.69,135.5,5)),false);
  assert.equal(launchOwnerFilter(scope,'russia')(latLngToCell(55,37,5)),false);
  assert.equal(launchOwnerFilter(scope,'us-state')(latLngToCell(38,-78,5)),true);
});

test('selected footprint can never report a complete planet; missing capitals remain explicit',()=>{
  const {scope,index,indexBytes}=setup();
  // Keep the real-inventory size guard. This fixture must remain unverified.
  const coverage=globalCoverage({index,indexBytes,queue:{jobs:{}},state:{sources:{},accepted:{}},activeKeys:new Set(),contextHash:'x',approvedInventorySha256:sha256(indexBytes),launchScope:scope});
  assert.equal(coverage.inventoryVerified,false);assert.equal(coverage.globalReadyForContent,false);assert.equal(coverage.selectedScopeReadyForContent,false);assert.equal(coverage.expectedSources,3);assert.equal(coverage.summary.awaitingSource,3);
  const lost=buildLaunchScope({index,indexBytes,citiesText:setup().citiesText+'\n'+['9','Missing','Missing','',-33,18,'P','PPLC','ZA','','','','','',0,'','','Africa/Johannesburg','2026-11-01'].join('\t'),citiesSha256:'a'.repeat(64)});
  assert.deepEqual(lost.unmappedCapitals,['geonames:9']);
});

test('EU-only collection excludes non-EU Europe and US, but includes Cyprus despite the Asia source parent',()=>{
  const {index,citiesText}=setup(),template=structuredClone(index.features.find(f=>f.properties.id==='czechia'));
  for(const [id,iso,parent] of [['switzerland','CH','europe'],['norway','NO','europe'],['united-kingdom','GB','europe'],['cyprus','CY','asia']]) {
    const f=structuredClone(template);Object.assign(f.properties,{id,parent,'iso3166-1:alpha2':[iso]});index.features.push(f);
  }
  const indexBytes=Buffer.from(JSON.stringify(index));
  const scope=buildLaunchScope({index,indexBytes,citiesText,citiesSha256:'a'.repeat(64),selection:'eu-only'});
  assert.deepEqual(scope.sources.map(s=>s.id),['cyprus','czechia']);assert.equal(scope.includedCountries.length,27);assert.deepEqual(scope.includedCountries,EU_COUNTRIES);
  assert.equal(scope.capitals.every(c=>EU_COUNTRIES.includes(c.country)),true);assert.equal(scope.sources.every(s=>s.mode==='full'),true);
  assert.equal(scope.unmappedCountries.includes('CY'),false);assert.equal(scope.unmappedCountries.includes('MT'),true);
  assert.equal(launchOwnerFilter(scope,'us-state')(latLngToCell(38,-78,5)),false);
});
