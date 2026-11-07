// Normalize equivalent OSM export representations, never inferred geography.
import { canonical, requireValue } from './canonical.mjs';

export function geographicFeature(feature) {
  const p = feature.properties || {}, id = feature.id || `osm:${String(p['@type'])[0]}${p['@id']}`;
  requireValue(/^osm:[nwr]\d+$/.test(id), 'Preserve stable OSM identities.');
  const tags = p.tags || Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('@')));
  let geometry = feature.geometry;
  requireValue(geometry && ['Point', 'LineString', 'Polygon', 'MultiPolygon'].includes(geometry.type), 'Missing or unsupported source geometry.');
  // osmium emits every area as MultiPolygon, even a single connected polygon.
  // Preserve ALL inner rings, and leave disconnected areas as MultiPolygon.
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length === 1)
    geometry = { type: 'Polygon', coordinates: geometry.coordinates[0] };
  const version = p['@version'];
  if (version !== undefined) requireValue(/^\d{1,10}$/.test(String(version)) && BigInt(version) > 0n, 'Invalid OSM source version.');
  return { id, tags, geometry, ...(version !== undefined ? { version: String(version) } : {}), ...(p['@timestamp'] ? { timestamp: String(p['@timestamp']) } : {}) };
}

export function sourceFeature(f) {
  return { type: 'Feature', id: f.id, geometry: f.geometry, properties: { tags: f.tags, ...(f.version ? { '@version': f.version } : {}), ...(f.timestamp ? { '@timestamp': f.timestamp } : {}) } };
}

// Neighboring bulk extracts may contain different revisions of the same OSM
// object. Resolve revisions across every geometry role before classification.
export function latestGeographicRoles(roles) {
  const latest = new Map();
  for (const values of Object.values(roles)) for (const f of values) if (f.version) {
    const old = latest.get(f.id);
    if (!old || BigInt(f.version) > BigInt(old)) latest.set(f.id, f.version);
  }
  const audit = {};
  const current = Object.fromEntries(Object.entries(roles).map(([role, values]) => {
    const seen = new Set(), selected = []; let superseded = 0, duplicates = 0;
    for (const f of values) {
      if (f.version && latest.has(f.id) && f.version !== latest.get(f.id)) { superseded++; continue; }
      const hash = canonical(f); if (seen.has(hash)) { duplicates++; continue; } seen.add(hash); selected.push(f);
    }
    audit[role] = { input: values.length, superseded, duplicates, selected: selected.length };
    return [role, selected];
  }));
  return { roles: current, audit };
}

function samePoint(a, b) { return canonical(a) === canonical(b); }
function sameClosedRing(a, b) {
  if (a.length < 4 || a.length !== b.length || !samePoint(a[0], a.at(-1)) || !samePoint(b[0], b.at(-1))) return false;
  const n = a.length - 1;
  for (let offset = 0; offset < n; offset++) {
    if (!samePoint(a[0], b[offset])) continue;
    for (const direction of [1, -1]) {
      let equal = true;
      for (let i = 1; i < n; i++) if (!samePoint(a[i], b[(offset + direction * i + n) % n])) { equal = false; break; }
      if (equal) return true;
    }
  }
  return false;
}

export function normalizeGeographicFeatures(features) {
  const seen = new Map(), merged = [];
  for (const f of features) {
    const old = seen.get(f.id);
    if (!old) { seen.set(f.id, f); continue; }
    const [line, polygon] = old.geometry.type === 'LineString' ? [old, f] : [f, old];
    requireValue(line.geometry.type === 'LineString' && polygon.geometry.type === 'Polygon' && polygon.geometry.coordinates.length === 1 && canonical(line.tags) === canonical(polygon.tags) && sameClosedRing(line.geometry.coordinates, polygon.geometry.coordinates[0]), `Conflicting duplicate source identity: ${f.id}`);
    requireValue(!merged.includes(f.id), `More than two representations of source identity: ${f.id}`);
    seen.set(f.id, polygon); merged.push(f.id);
  }
  return { features: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')), merged };
}
