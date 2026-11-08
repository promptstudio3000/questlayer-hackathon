// Bulk-to-game geographic adapter. Only immutable, bounded inputs are emitted.
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { latLngToCell, cellToBoundary } from 'h3-js';
import { categorizeOsm } from '../poi/taxonomy.mjs';
import { querySourceIndex } from './source-index.mjs';
import { bboxPolygon, booleanWithin, booleanIntersects, featureCollection, union, feature as turfFeature } from '@turf/turf';
import { shapeOf } from '../poi/safety.mjs';
import { ownerCell } from './schema.mjs';
import { canonical, digest, requireValue } from './canonical.mjs';
import { immutableFile, lockDirectory } from './storage.mjs';
import { normalizeGeographicFeatures, sourceFeature, latestGeographicRoles } from './osm-features.mjs';
import { overlapsBounds } from './source-context.mjs';

const MAX_SELECTED = 16 * 1024 * 1024;
const ROLES = ['pois', 'paths', 'exclusions'];
import { scanGeometry, geometryBounds, contextBounds } from './geo-sequence.mjs';
export { scanGeometry, geometryBounds, contextBounds } from './geo-sequence.mjs';
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const EXPORT_POLICY = 'osm-bounded-geography-export/1';

export async function planSourceRegions({ pois, sourceGeometry, sourceIndexFile, neighbors = [], selectOwner = ()=>true }) {
  const owners = new Map(); let mappedRecords = 0;
  const collect = f => {
    if (!f.tags.name?.trim() || !categorizeOsm(f.tags)) return;
    const [lng, lat] = shapeOf(f.geometry).label;
    requireValue(Number.isFinite(lat) && Number.isFinite(lng), 'Invalid map label.');
    if (Math.abs(lat) >= 84) return;
    mappedRecords++;
    const owner = ownerCell({ lat, lng }), cell = latLngToCell(lat, lng, 7);
    if (!selectOwner(owner)) return;
    if (!owners.has(owner)) owners.set(owner, new Map());
    requireValue(owners.size <= 50000, 'Split source inventory above 50,000 owners.');
    const cells = owners.get(owner), old = cells.get(cell);
    if (!old) cells.set(cell, { cell, candidateCount: 1 });
    else old.candidateCount++;
  };
  let input;
  if (sourceIndexFile) {
    const index = JSON.parse(readFileSync(sourceIndexFile));
    for (const item of index.roles.pois.cells) {
      if (!selectOwner(item.owner)) continue;
      if (!owners.has(item.owner)) owners.set(item.owner, new Map());
      owners.get(item.owner).set(item.cell, { cell: item.cell, candidateCount: item.candidateCount });
    }
    input = index.roles.pois.scanned;
    mappedRecords = index.roles.pois.cells.reduce((n,c)=>n+c.candidateCount,0);
  } else input = await scanGeometry(pois, collect);
  for (const neighbor of neighbors) {
    const index = JSON.parse(readFileSync(neighbor.indexFile));
    for (const cell of index.roles.pois.cells) if (owners.has(cell.owner)) {
      const cells=owners.get(cell.owner),old=cells.get(cell.cell);
      if (!old || cell.candidateCount>old.candidateCount) cells.set(cell.cell,{cell:cell.cell,candidateCount:cell.candidateCount});
    }
  }
  const geometries = [sourceGeometry, ...neighbors.map(n=>n.geometry)].filter(Boolean).map(g=>({geometry:g,bounds:geometryBounds(g),shape:turfFeature(g)}));
  function covered(context) {
    const shape = bboxPolygon(context), nearby=geometries.filter(g=>overlapsBounds(context,g.bounds)&&booleanIntersects(shape,g.shape));
    if (nearby.some(g=>booleanWithin(shape,g.shape))) return true;
    if (nearby.length<2) return false;
    const merged=union(featureCollection(nearby.map(g=>g.shape)));
    return !!merged && booleanWithin(shape,merged);
  }

  const plans = [], omitted = [];
  for (const [id, cells] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    const sections = [], missing = [];
    for (const { cell, candidateCount } of [...cells.values()].sort((a,b)=>a.cell.localeCompare(b.cell))) {
      const boundary = cellToBoundary(cell), lngs = boundary.map(p=>p[1]), lats = boundary.map(p=>p[0]);
      const coreBounds = [Math.min(...lngs),Math.min(...lats),Math.max(...lngs),Math.max(...lats)];
      try {
        requireValue(coreBounds[2]-coreBounds[0]<180, 'Wrapping source cell requires normalized components.');
        const context = contextBounds(coreBounds);
        requireValue(covered(context), 'Source edge needs a neighboring extract.');
        sections.push({ cell, coreBounds, contextBounds: context, candidateCount });
      } catch(error) { missing.push({ cell, reason: error.message }); }
    }
    // An owner is never called complete while known mapped cells are omitted.
    if (missing.length) omitted.push({ id, reason: 'Owner context is incomplete.', expectedCells: cells.size, missing });
    else plans.push({ id, sections, candidateCount: sections.reduce((n,s)=>n+s.candidateCount,0) });
  }
  plans.sort((a,b)=>b.candidateCount-a.candidateCount||a.id.localeCompare(b.id));
  return { schema: 'questlayer.source-region-plan/1', policy: EXPORT_POLICY, coverage: 'all-mapped-candidate-cells', input, mappedRecords, expectedOwners: owners.size, plans, omitted };
}

export async function exportGeographyRegion({ inputs, outputDir, plan, countries, sourceDate, sourceCommit, sourceIndexFile, sourceIndexFiles = sourceIndexFile ? [sourceIndexFile] : [], compress = false }) {
  requireValue(/^[a-f0-9]{40}$/.test(sourceCommit), 'Supply exact source checkpoint.');
  requireValue(Array.isArray(countries) && countries.length && countries.every(c => /^[A-Z]{2}$/.test(c)), 'Supply actual source country codes.');
  if (!plan.sections && !plan.cell) requireValue(plan.id === ownerCell({ lat: (plan.coreBounds[1] + plan.coreBounds[3]) / 2, lng: (plan.coreBounds[0] + plan.coreBounds[2]) / 2 }), 'Plan core must be centered in its canonical owner.');
  const root = resolve(outputDir), release = lockDirectory(root);
  try {
    const binding = { policy: EXPORT_POLICY, inputs: Object.fromEntries(ROLES.map(r => [r, resolve(inputs[r])])), sourceIndexFiles, plan, countries, sourceDate, sourceCommit };
    immutableFile(resolve(root, 'binding.json'), Buffer.from(canonical(binding)));
    if (plan.sections) {
      requireValue(plan.sections.length > 0 && plan.sections.length <= 49, 'Supply complete bounded sections for one owner.');
      const sections = [], reports = [];
      for (const part of plan.sections) {
        const prefix = `sections/${part.cell}`;
        const child = await exportGeographyRegion({ inputs, outputDir: resolve(root,prefix), plan: { ...part, id: plan.id }, countries, sourceDate, sourceCommit, sourceIndexFiles, compress: true });
        const descriptor = JSON.parse(readFileSync(child.catalogFile)).regions[0];
        sections.push({ cell: part.cell, coreBounds: part.coreBounds, contextBounds: part.contextBounds, inputProvenance: descriptor.inputProvenance, inputs: Object.fromEntries(ROLES.map(role => [role, { ...descriptor.inputs[role], file: `${prefix}/${descriptor.inputs[role].file}` }])) });
        reports.push({ cell: part.cell, roles: child.report });
      }
      const region = { id: plan.id, status: 'complete', countries, sourceDate, sections, coverageReason: 'All mapped candidate cells in the owner; physical access remains unverified.' };
      const catalog = { schema: 'questlayer.geography-catalog/1', sourceCommit, version: `${EXPORT_POLICY}:${digest(region)}`, closures: [], recentPoiIds: [], regions: [region] };
      immutableFile(resolve(root,'export-report.json'), Buffer.from(canonical({ policy: EXPORT_POLICY, sections: reports })));
      immutableFile(resolve(root,'catalog.json'), Buffer.from(canonical(catalog)));
      return { catalogFile: resolve(root,'catalog.json'), report: { sections: reports } };
    }
    const inputProvenance=sourceIndexFiles.map(file=>{const index=JSON.parse(readFileSync(file));return {hashes:index.hashes,provenance:index.provenance};});
    const refs = {}, report = {}, roles = {};
    for (const role of ROLES) {
      const selected = []; let selectedBytes = 0;
      const collect = (f, bounds) => {
        if (!overlaps(bounds, plan.contextBounds)) return;
        selectedBytes += Buffer.byteLength(canonical(f));
        requireValue(selectedBytes <= MAX_SELECTED, 'Region role exceeds 16 MiB bounded normalization; split upstream.');
        selected.push(f);
      };
      let scanned;
      if (sourceIndexFiles.length) {
        scanned=[];
        for (const indexFile of sourceIndexFiles) scanned.push(await querySourceIndex({indexFile,role,bounds:plan.contextBounds,visit:collect}));
      } else scanned=await scanGeometry(inputs[role],collect);
      roles[role] = selected; report[role] = { scanned };
    }
    const revised = latestGeographicRoles(roles);
    for (const role of ROLES) {
      const normalized = normalizeGeographicFeatures(revised.roles[role]);
      const text = normalized.features.map(f=>canonical(sourceFeature(f))+'\n').join('');
      const file = `${role}.geojsonseq${compress ? '.gz' : ''}`, bytes = compress ? gzipSync(Buffer.from(text), {level:6}) : Buffer.from(text);
      immutableFile(resolve(root,file),bytes);
      refs[role] = {file,sha256:createHash('sha256').update(bytes).digest('hex')};
      Object.assign(report[role],{revisions:revised.audit[role],output:normalized.features.length,merged:normalized.merged});
    }
    const catalog = { schema: 'questlayer.geography-catalog/1', sourceCommit, version: `${EXPORT_POLICY}:${digest({ plan, refs, sourceDate, inputProvenance })}`, closures: [], recentPoiIds: [], regions: [{ id: plan.id, status: 'complete', countries, coreBounds: plan.coreBounds, contextBounds: plan.contextBounds, inputs: refs, inputProvenance, sourceDate, coverageReason: 'Map-derived bounded core only; remainder of owner and physical access unverified.' }] };
    immutableFile(resolve(root, 'export-report.json'), Buffer.from(canonical({ policy: EXPORT_POLICY, ...report })));
    // Seal only after full input passes, including audited zero-record roles.
    immutableFile(resolve(root, 'catalog.json'), Buffer.from(canonical(catalog)));
    return { catalogFile: resolve(root, 'catalog.json'), report };
  } finally { release(); }
}
