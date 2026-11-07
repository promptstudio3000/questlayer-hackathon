import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { requireValue } from './canonical.mjs';
import { geographicFeature } from './osm-features.mjs';
const MAX_LINE = 4 * 1024 * 1024;
export function geometryBounds(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(c) {
    requireValue(Array.isArray(c) && c.length > 0, 'Empty source coordinates.');
    if (typeof c[0] === 'number') {
      requireValue(c.length >= 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90, 'Invalid source coordinate.');
      box[0] = Math.min(box[0], c[0]); box[1] = Math.min(box[1], c[1]); box[2] = Math.max(box[2], c[0]); box[3] = Math.max(box[3], c[1]);
    } else for (const p of c) visit(p);
  }
  visit(geometry.coordinates);
  // A disconnected MultiPolygon may legitimately have separate components
  // on both sides of the date line. Preserve it whole; never turn a ring
  // crossing the discontinuity into a path across the Pacific.
  requireValue(box[2] - box[0] < 180 || (geometry.type === 'MultiPolygon' && geometry.coordinates.every(coordinates => {
    const local = geometryBounds({type:'Polygon',coordinates});
    return local[2]-local[0]<180;
  })), 'Wrapping geometry needs upstream preprocessing.');
  return box;
}
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export function contextBounds(core) {
  const [w, s, e, n] = core, dx = 1100 / (110000 * Math.cos(Math.max(Math.abs(s), Math.abs(n)) * Math.PI / 180)), dy = 1100 / 110000;
  const box = [w - dx, s - dy, e + dx, n + dy];
  requireValue(box[0] >= -180 && box[2] <= 180 && box[1] > -85 && box[3] < 85, 'Unsupported wrapping/polar context.');
  return box;
}

export async function scanGeometry(file, visit) {
  const hash = createHash('sha256'); let pending = '', count = 0, bytes = 0;
  const line = async (value) => {
    value = value.replace(/^\x1e/, '').trim(); if (!value) return;
    requireValue(Buffer.byteLength(value) <= MAX_LINE, 'Source feature exceeds 4 MiB.');
    let raw; try { raw = JSON.parse(value); } catch { throw Error(`Malformed source record ${count + 1}.`); }
    requireValue(raw.type === 'Feature', 'Supply GeoJSON feature sequences.');
    const f = geographicFeature(raw), bounds = geometryBounds(f.geometry);
    await visit(f, bounds); count++;
  };
  // decode incrementally so split UTF-8 names retain their original characters.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const raw = createReadStream(file, { highWaterMark: 64 * 1024 });
  const stream = file.endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  raw.on('error', error => stream.destroy(error));
  for await (const chunk of stream) {
    hash.update(chunk); bytes += chunk.length; pending += decoder.decode(chunk, { stream: true });
    let i; while ((i = pending.indexOf('\n')) >= 0) { await line(pending.slice(0, i)); pending = pending.slice(i + 1); }
    requireValue(Buffer.byteLength(pending) <= MAX_LINE, 'Source feature exceeds 4 MiB.');
  }
  pending += decoder.decode(); if (pending.trim()) await line(pending);
  return { count, bytes, sha256: hash.digest('hex') };
}
