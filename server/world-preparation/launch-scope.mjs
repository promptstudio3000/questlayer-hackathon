// Versioned geography selection only. This never allocates financial rewards.
import { readFileSync } from 'node:fs';
import { cellToLatLng, greatCircleDistance } from 'h3-js';
import { booleanIntersects, circle, feature, bbox } from '@turf/turf';
import { digest, requireValue, sha256 } from './canonical.mjs';

export const LAUNCH_SCOPE = 'questlayer.launch-scope/1';
const EXCLUDED = new Set(['RU', 'KP', 'IR']);
// EU membership snapshot checked against the official EU country list.
export const EU_COUNTRIES = Object.freeze(['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);

export function buildLaunchScope({ index, indexBytes, citiesText, citiesSha256, radiusKm = 25, selection = 'global-launch' }) {
  requireValue(['global-launch','eu-only'].includes(selection),'Unknown launch selection.');
  const euOnly=selection==='eu-only',eu=new Set(EU_COUNTRIES);
  requireValue(radiusKm > 0 && radiusKm <= 100, 'Supply a bounded capital footprint.');
  requireValue(/^[a-f0-9]{64}$/.test(citiesSha256), 'Pin the original GeoNames archive.');
  const capitals = [];
  for (const line of citiesText.split('\n')) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c[6] !== 'P' || c[7] !== 'PPLC' || EXCLUDED.has(c[8]) || (euOnly&&!eu.has(c[8]))) continue;
    const lat = Number(c[4]), lng = Number(c[5]);
    requireValue(c.length === 19 && /^\d+$/.test(c[0]) && /^[A-Z]{2}$/.test(c[8]) && Number.isFinite(lat) && Math.abs(lat) < 84 && Number.isFinite(lng) && Math.abs(lng) <= 180, 'Invalid capital source row.');
    try { new Intl.DateTimeFormat('en', { timeZone: c[17] }); } catch { throw Error('Capital lacks a valid IANA time zone.'); }
    capitals.push({ id: `geonames:${c[0]}`, name: c[1], country: c[8], lat, lng, timeZone: c[17] });
  }
  requireValue(capitals.length > 0, 'GeoNames input contains no national capitals.');
  capitals.sort((a,b)=>a.id.localeCompare(b.id));
  const footprints=capitals.map(city=>{const shape=circle([city.lng,city.lat],radiusKm+25,{units:'kilometers'});return {city,shape,bounds:bbox(shape)};});
  const byId = new Map(index.features.map(f=>[f.properties.id,f]));
  const parents = new Set(index.features.map(f=>f.properties.parent));
  const sources = [], unmapped = new Set(capitals.map(c=>c.id));
  for (const f of index.features.filter(f=>f.properties.urls?.pbf && !parents.has(f.properties.id))) {
    const ancestry = [], countries = new Set(); let cursor = f;
    while (cursor && !ancestry.includes(cursor.properties.id)) {
      ancestry.push(cursor.properties.id);
      for (const iso of cursor.properties['iso3166-1:alpha2'] || []) countries.add(iso);
      cursor = byId.get(cursor.properties.parent);
    }
    if ([...countries].some(c=>EXCLUDED.has(c))) continue;
    // Cyprus is an EU member even though its bulk extract is under Asia.
    const full = euOnly?[...countries].some(c=>eu.has(c))&&(ancestry.includes('europe')||countries.has('CY')):ancestry.includes('europe') || countries.has('US');
    if(euOnly&&!full)continue;
    // Include intersecting extracts for a capital's owner/context margin, not
    // only the extract containing its center. Exact zones retain original data.
    // Extract ISO labels are not borders: Malaysia's extract also supplies
    // Singapore/Brunei, for example. Match its actual published geometry.
    const bounds=bbox(f.geometry),sourceShape=feature(f.geometry);
    const selected = footprints.filter(p=>p.bounds[0]<=bounds[2]&&p.bounds[2]>=bounds[0]&&p.bounds[1]<=bounds[3]&&p.bounds[3]>=bounds[1]&&booleanIntersects(p.shape,sourceShape)).map(p=>p.city);
    for (const c of selected) unmapped.delete(c.id);
    if (full || selected.length) sources.push({ id:f.properties.id, mode:full?'full':'capitals', capitals:selected.map(c=>c.id), countries:[...new Set(euOnly?[...countries]:[...countries,...selected.map(c=>c.country)])].filter(c=>!euOnly||eu.has(c)).sort() });
  }
  sources.sort((a,b)=>a.id.localeCompare(b.id));
  const result = { schema:LAUNCH_SCOPE, selection, ...(euOnly?{includedCountries:EU_COUNTRIES,unmappedCountries:EU_COUNTRIES.filter(c=>!sources.some(s=>s.countries.includes(c))),membershipSource:'https://european-union.europa.eu/principles-countries-history/eu-countries_en',membershipCheckedAt:'2026-11-07',prioritySources:['czech-republic','czechia','luxembourg','belgium','lorraine','saarland','rheinland-pfalz','alsace','slovakia','austria']}:{}), inventorySha256:sha256(indexBytes), excludedCountries:[...EXCLUDED].sort(), capitalRadiusKm:radiusKm, capitalSelection:euOnly?'All mapped candidate owners in selected EU country extracts; capitals are metadata only':'H3 resolution-5 owner center within radius; all mapped cells of each selected owner', sources, capitals, unmappedCapitals:[...unmapped].sort(), provenance:{url:'https://download.geonames.org/export/dump/cities15000.zip',sha256:citiesSha256,decodedSha256:sha256(citiesText),license:'CC-BY-4.0',attribution:'GeoNames'}, financialActivation:false };
  return { ...result, hash:digest(result) };
}

export function readLaunchScope(file, inventoryBytes) {
  const scope = JSON.parse(readFileSync(file)); const {hash,...body}=scope;
  requireValue(scope.schema===LAUNCH_SCOPE && hash===digest(body) && scope.inventorySha256===sha256(inventoryBytes), 'Launch scope hash or source snapshot mismatch.');
  requireValue(scope.excludedCountries.join(',')==='IR,KP,RU' && Array.isArray(scope.sources) && new Set(scope.sources.map(s=>s.id)).size===scope.sources.length, 'Invalid launch selection.');
  if(scope.selection==='eu-only')requireValue(scope.includedCountries?.join(',')===EU_COUNTRIES.join(',')&&scope.sources.every(s=>s.mode==='full'&&s.countries.length&&s.countries.every(c=>EU_COUNTRIES.includes(c))), 'Invalid EU-only source inventory.');
  return scope;
}

export function launchOwnerFilter(scope, sourceId) {
  if (!scope) return ()=>true;
  const source=scope.sources.find(s=>s.id===sourceId);
  if (!source) return ()=>false;
  if (source.mode==='full') return ()=>true;
  requireValue(source.mode==='capitals','Unknown launch source mode.');
  const cities=scope.capitals.filter(c=>source.capitals.includes(c.id));
  return owner => cities.some(c=>greatCircleDistance(cellToLatLng(owner),[c.lat,c.lng],'km')<=scope.capitalRadiusKm);
}
