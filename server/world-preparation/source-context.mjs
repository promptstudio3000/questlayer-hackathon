// A newly indexed distant country must not restart every already planned
// owner. Keep complete neighboring inputs, with a conservative owner margin.
import { bbox } from '@turf/turf';
import { digest } from './canonical.mjs';

export const overlapsBounds = (a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export function sourceContexts(sources,scopeHash=null) {
  const indexed=sources.map(s=>({...s,bounds:bbox(s.geometry)})).sort((a,b)=>a.id.localeCompare(b.id));
  return new Map(indexed.map(source=>{
    const [w,s,e,n]=source.bounds,dy=50000/110000,dx=dy/Math.max(.05,Math.cos(Math.max(Math.abs(s),Math.abs(n))*Math.PI/180));
    const neighbors=indexed.filter(other=>overlapsBounds([w-dx,s-dy,e+dx,n+dy],other.bounds));
    return [source.id,{sources:neighbors,hash:digest({policy:'complete-source-neighborhood/1',scopeHash,sources:neighbors.map(n=>[n.id,n.indexFile])})}];
  }));
}
