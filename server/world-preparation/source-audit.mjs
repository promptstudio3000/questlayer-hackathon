import { areaRule, tagReasons, POI_SAFETY_VERSION } from '../poi/safety.mjs';
import { requireValue } from './canonical.mjs';

export function quarantineGeometry(report) {
  requireValue(report.schema==='questlayer.geometry-reference-audit/1'&&Array.isArray(report.incompleteAreas),'Invalid geometry audit.');
  const rejected=[];
  for(const item of report.incompleteAreas) {
    requireValue(/^osm:r\d+$/.test(item.id)&&item.missingWays>0,'Invalid incomplete area reference.');
    requireValue(!areaRule(item.tags)&&tagReasons(item.tags).length===0,`Incomplete restricted geometry must be repaired: ${item.id}`);
    rejected.push({...item,status:'rejected-candidate',reason:'incomplete-source-geometry'});
  }
  return {policy:POI_SAFETY_VERSION,rejected};
}

export async function auditFilteredGeometry({osmium='osmium',pbf}) {
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const cat=spawn(osmium,['cat',pbf,'-f','osm'],{env:{...process.env,OSMIUM_POOL_THREADS:'2'},stdio:['ignore','pipe','pipe'],timeout:600000});
  const checker=spawn('python3',[fileURLToPath(new URL('../../scripts/poi/audit-geometry.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],timeout:600000});
  cat.stdout.pipe(checker.stdin);checker.stdin.on('error',()=>{});
  let output='',errors='',overflow=false;
  checker.stdout.on('data',b=>{if(overflow)return;output+=b;if(Buffer.byteLength(output)>1024*1024){overflow=true;cat.kill();checker.kill();}});
  for(const child of [cat,checker])child.stderr.on('data',b=>errors=(errors+b).slice(-8192));
  const done=child=>new Promise((yes,no)=>{child.once('error',no);child.once('close',code=>code===0?yes():no(Error(`Geometry reference audit failed: ${errors}`)));});
  try{await Promise.all([done(cat),done(checker)]);}catch(error){cat.kill();checker.kill();throw error;}
  requireValue(!overflow,'Geometry reference audit exceeds 1 MiB.');
  return JSON.parse(output);
}
