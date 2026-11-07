// Compressed, bounded spatial transport cache. Complete source geometries are
// replicated to intersected tiles; this does not change gameplay ownership.
import { createReadStream, createWriteStream, mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { scanGeometry } from './geo-sequence.mjs';
import { sourceFeature } from './osm-features.mjs';
import { shapeOf } from '../poi/safety.mjs';
import { categorizeOsm } from '../poi/taxonomy.mjs';
import { ownerCell } from './schema.mjs';
import { latLngToCell } from 'h3-js';
import { canonical, digest, requireValue } from './canonical.mjs';
import { immutableFile, inputFile, lockDirectory } from './storage.mjs';

export const SOURCE_INDEX_POLICY = 'complete-geometry-spatial-cache/1';
const ROLES=['pois','paths','exclusions'], DEG=.25, MAX_REPLICAS=64, CHUNK_BYTES=4*1024*1024, OPEN_WRITERS=8;
export async function fileHash(file){const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex');}
export function boundsTiles([w,s,e,n],limit=MAX_REPLICAS){
 const x0=Math.floor(w/DEG),y0=Math.floor(s/DEG),x1=Math.floor(e/DEG),y1=Math.floor(n/DEG),count=(x1-x0+1)*(y1-y0+1);
 if(count>limit)return ['large'];
 const out=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)out.push(`${x}_${y}`);return out;
}
export async function buildSourceIndex({inputs,outputDir,provenance=null}){
 const hashes=Object.fromEntries(await Promise.all(ROLES.map(async r=>[r,await fileHash(inputs[r])])));
 const parser=digest(['osm-features.mjs','geo-sequence.mjs','source-index.mjs'].map(name=>[name,createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')]));
 const binding={policy:SOURCE_INDEX_POLICY,hashes,parser,provenance},root=resolve(outputDir,digest(binding)),release=lockDirectory(root);
 try{
  immutableFile(resolve(root,'binding.json'),Buffer.from(canonical(binding)));
  const roles={};
  for(const role of ROLES){
   const sealed=resolve(root,role,'manifest.json');
   if(existsSync(sealed)){const m=JSON.parse(readFileSync(sealed));requireValue(m.inputSha256===hashes[role]&&m.policy===SOURCE_INDEX_POLICY,'Spatial cache input differs.');roles[role]=m;continue;}
   const temp=resolve(root,`${role}.attempt-${randomUUID()}`);mkdirSync(temp,{recursive:true});
   const writers=new Map(),tiles={},serial=new Map(),cells=new Map();
   async function close(key){const w=writers.get(key);if(!w)return;w.zip.end();await w.done;const sha256=await fileHash(w.file);(tiles[key]??=[]).push({file:w.name,sha256,records:w.records,decodedBytes:w.bytes});writers.delete(key);}
   async function writer(key){
    let w=writers.get(key);if(w&&w.bytes>=CHUNK_BYTES){await close(key);w=null;}
    if(!w){if(writers.size>=OPEN_WRITERS)await close(writers.keys().next().value);const n=serial.get(key)||0;serial.set(key,n+1);const name=`${key}-${n}.geojsonseq.gz`,file=resolve(temp,name),zip=createGzip({level:6}),disk=createWriteStream(file,{flags:'wx'}),done=finished(disk);done.catch(()=>{});zip.pipe(disk);zip.on('error',e=>disk.destroy(e));w={zip,disk,done,file,name,bytes:0,records:0};writers.set(key,w);}
    else {writers.delete(key);writers.set(key,w);}return w;
   }
   let scanned;
   try{
    scanned=await scanGeometry(inputs[role],async(f,bounds)=>{
     if(role==='pois'&&f.tags.name?.trim()&&categorizeOsm(f.tags)) {
       const [lng,lat]=shapeOf(f.geometry).label;
       if(Math.abs(lat)<84) { const cell=latLngToCell(lat,lng,7),owner=ownerCell({lat,lng}),old=cells.get(cell);if(old)old.candidateCount++;else cells.set(cell,{cell,owner,candidateCount:1}); }
     }
     const text=canonical(sourceFeature(f))+'\n';
     for(const key of boundsTiles(bounds)){const w=await writer(key);if(!w.zip.write(text))await once(w.zip,'drain');w.bytes+=Buffer.byteLength(text);w.records++;}
    });
    for(const key of [...writers.keys()])await close(key);
   }catch(error){for(const w of writers.values()){w.zip.destroy();w.disk.destroy();await w.done.catch(()=>{});}throw error;}
   const manifest={policy:SOURCE_INDEX_POLICY,inputSha256:hashes[role],scanned,tiles,...(role==='pois'?{cells:[...cells.values()].sort((a,b)=>a.cell.localeCompare(b.cell))}:{})};immutableFile(resolve(temp,'manifest.json'),Buffer.from(canonical(manifest)));renameSync(temp,resolve(root,role));roles[role]=manifest;
  }
  const manifest={policy:SOURCE_INDEX_POLICY,hashes,roles,provenance};immutableFile(resolve(root,'manifest.json'),Buffer.from(canonical(manifest)));return {file:resolve(root,'manifest.json'),manifest};
 }finally{release();}
}
export async function querySourceIndex({indexFile,role,bounds,visit}){
 const root=dirname(resolve(indexFile)),index=JSON.parse(readFileSync(indexFile));requireValue(index.policy===SOURCE_INDEX_POLICY&&ROLES.includes(role),'Unsupported spatial source cache.');
 const keys=boundsTiles(bounds,4096);requireValue(!keys.includes('large'),'Query context must be spatially bounded.');
 const refs=[...keys,'large'].flatMap(key=>index.roles[role].tiles[key]||[]),seen=new Set();let matched=0;
 for(const ref of refs){const file=inputFile(resolve(root,role),ref.file);requireValue(await fileHash(file)===ref.sha256,'Spatial cache checksum mismatch.');
  await scanGeometry(file,async(f,b)=>{
   if(b[0]>bounds[2]||b[2]<bounds[0]||b[1]>bounds[3]||b[3]<bounds[1])return;
   const id=digest(f);if(seen.has(id))return;requireValue(seen.size<100000,'Spatial query exceeds the bounded feature inventory.');seen.add(id);await visit(f,b);matched++;
  });
 }
 return {files:refs.length,matched,indexHash:digest(index.hashes)};
}
