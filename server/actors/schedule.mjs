// Deterministic day plans for roaming NPCs and monsters (docs/NPC-PLAN.md §3).
// Everything here is pure: the same city pack, seed, day and definition give
// the same segments on every server and every request. Nothing is stored.
//
// Actors walk the city pack's mapped public paths (the same OSM footways,
// paths and living streets that street coins use). Paths that share a point
// form one graph; points inside excluded or operator-closed places are dropped.
import { createHash } from "node:crypto";
import { distance } from "../domain.mjs";
import { pointClosed } from "../spatial/place-safety.mjs";
import { daylightSpans, nightSpans } from "../sun.mjs";

const MINUTE = 60_000;
const JOIN_M = 15;
const MIN_COMPONENT = 60;

// Small seeded PRNG (sfc32 over sha256), independent of Math.random.
export function seededRandom(...parts) {
  const h = createHash("sha256").update(parts.join("␟")).digest();
  let a = h.readUInt32LE(0),
    b = h.readUInt32LE(4),
    c = h.readUInt32LE(8),
    d = h.readUInt32LE(12);
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

class Heap {
  rows = [];
  push(row) {
    const rows = this.rows;
    rows.push(row);
    let i = rows.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (rows[p].cost <= row.cost) break;
      rows[i] = rows[p];
      i = p;
    }
    rows[i] = row;
  }
  pop() {
    const rows = this.rows,
      top = rows[0],
      last = rows.pop();
    if (rows.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= rows.length) break;
        if (c + 1 < rows.length && rows[c + 1].cost < rows[c].cost) c++;
        if (rows[c].cost >= last.cost) break;
        rows[i] = rows[c];
        i = c;
      }
      rows[i] = last;
    }
    return top;
  }
}

const graphs = new WeakMap();
/**
 * Walkable graph from pack.paths ([lng,lat] polylines). Cached per paths
 * array and exclusion set. `nodes` lists points in components of at least
 * MIN_COMPONENT points; an actor stays inside its home node's component, so a
 * route always exists between its stations.
 */
export function pathGraph(pack, closed = []) {
  const exclusions = [...(pack.exclusions || []), ...closed];
  // Street cells carry a few short Overpass ways, so they may accept smaller
  // fragments than a CityPack (pack.minComponent).
  const minComponent = pack.minComponent || MIN_COMPONENT;
  const key = `${minComponent}|${exclusions.map((e) => e.id).sort().join("|")}`;
  let byKey = graphs.get(pack.paths);
  if (!byKey) graphs.set(pack.paths, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  const index = new Map(),
    lng = [],
    lat = [],
    adj = [];
  const node = (p) => {
    const k = `${p[0]},${p[1]}`;
    let i = index.get(k);
    if (i === undefined) {
      i = lng.length;
      index.set(k, i);
      lng.push(p[0]);
      lat.push(p[1]);
      adj.push([]);
    }
    return i;
  };
  const blocked = new Map();
  const isBlocked = (p) => {
    if (!exclusions.length) return false;
    const k = `${p[0]},${p[1]}`;
    if (!blocked.has(k))
      blocked.set(k, pointClosed(exclusions, { lng: p[0], lat: p[1] }));
    return blocked.get(k);
  };
  for (const path of pack.paths) {
    for (let j = 0; j + 1 < path.points.length; j++) {
      const a = path.points[j],
        b = path.points[j + 1];
      if (isBlocked(a) || isBlocked(b)) continue;
      const m = distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
      if (!(m > 0) || m > 2000) continue;
      const i = node(a),
        k = node(b);
      adj[i].push(k, m);
      adj[k].push(i, m);
    }
  }
  // Mapped footways often stop a few metres short of each other (a street
  // crossing, a missing junction). Join each path end to points within
  // JOIN_M so the network reads as walkable, then label components.
  const ends = new Set();
  for (const path of pack.paths)
    for (const p of [path.points[0], path.points.at(-1)]) {
      const i = index.get(`${p[0]},${p[1]}`);
      if (i !== undefined) ends.add(i);
    }
  const cell = (i) => `${Math.floor(lat[i] * 2000)}:${Math.floor(lng[i] * 1300)}`;
  const grid = new Map();
  for (let i = 0; i < lng.length; i++) {
    const c = cell(i);
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c).push(i);
  }
  for (const i of ends) {
    const [y, x] = cell(i).split(":").map(Number);
    let best = -1,
      bestM = JOIN_M;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const k of grid.get(`${y + dy}:${x + dx}`) || []) {
          if (k === i || adj[i].includes(k)) continue;
          const m = distance(at0(i), at0(k));
          if (m > 0 && m <= bestM) {
            best = k;
            bestM = m;
          }
        }
    if (best >= 0) {
      adj[i].push(best, bestM);
      adj[best].push(i, bestM);
    }
  }
  function at0(i) {
    return { lng: lng[i], lat: lat[i] };
  }
  const comp = new Int32Array(lng.length).fill(-1),
    sizes = [];
  for (let s = 0; s < lng.length; s++) {
    if (comp[s] !== -1) continue;
    const c = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = c;
    while (stack.length) {
      const v = stack.pop();
      size++;
      const edges = adj[v];
      for (let e = 0; e < edges.length; e += 2)
        if (comp[edges[e]] === -1) {
          comp[edges[e]] = c;
          stack.push(edges[e]);
        }
    }
    sizes.push(size);
  }
  // Tiny fragments (a lone courtyard path) are not worth a route.
  const nodes = [];
  for (let i = 0; i < lng.length; i++)
    if (sizes[comp[i]] >= minComponent) nodes.push(i);
  const graph = { lng, lat, adj, comp, nodes };
  byKey.set(key, graph);
  return graph;
}

const at = (g, i) => ({ lng: g.lng[i], lat: g.lat[i] });

export function nearestNode(g, p, maxM = Infinity) {
  let best = -1,
    bestM = maxM;
  for (const i of g.nodes) {
    // Cheap box filter before the haversine.
    if (Math.abs(g.lat[i] - p.lat) > 0.02 || Math.abs(g.lng[i] - p.lng) > 0.03)
      continue;
    const m = distance(p, at(g, i));
    if (m < bestM) {
      best = i;
      bestM = m;
    }
  }
  return best;
}

export function nodesWithin(g, p, radiusM) {
  const dLat = radiusM / 111_320 + 1e-6,
    dLng = dLat / Math.max(0.1, Math.cos((p.lat * Math.PI) / 180));
  return g.nodes.filter(
    (i) =>
      Math.abs(g.lat[i] - p.lat) <= dLat &&
      Math.abs(g.lng[i] - p.lng) <= dLng &&
      distance(p, at(g, i)) <= radiusM,
  );
}

/** Shortest walk between two graph nodes: { meters, path: [[lng,lat],…] }. */
export function shortestPath(g, from, to) {
  if (from === to) return { meters: 0, path: [[g.lng[from], g.lat[from]]] };
  const cost = new Map([[from, 0]]),
    prev = new Map(),
    queue = new Heap();
  queue.push({ id: from, cost: 0 });
  while (queue.rows.length) {
    const { id, cost: c } = queue.pop();
    if (c !== cost.get(id)) continue;
    if (id === to) break;
    const edges = g.adj[id];
    for (let e = 0; e < edges.length; e += 2) {
      const next = c + edges[e + 1];
      if (next < (cost.get(edges[e]) ?? Infinity)) {
        cost.set(edges[e], next);
        prev.set(edges[e], id);
        queue.push({ id: edges[e], cost: next });
      }
    }
  }
  if (!cost.has(to)) return null;
  const path = [];
  for (let v = to; v !== undefined; v = prev.get(v)) path.push([g.lng[v], g.lat[v]]);
  return { meters: cost.get(to), path: path.reverse() };
}

/** Minutes after local midnight for "HH:MM". */
function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** NPCs that talk, trade or give quests walk all day and night. */
export const npcAroundTheClock = (def) => def?.kind === "npc" && !def.windows;

/**
 * Active window(s) for a definition on one local day, as [start, end] ms.
 * `dayStart` is local midnight (calendar.localDateStart). Practice worlds pass
 * `allDay` so the demo works at any hour. With `sky` ({lat,lng}), a definition
 * with phase "day" walks only between local sunrise and sunset, and a "night"
 * one only after sunset (and before sunrise), inside the same opening hours.
 */
export function activeWindows(def, { dayStart, hours, allDay: practice = false, rng, sky = null }) {
  // NPCs stay on the map around the clock (owner, 11 Nov 2026); only
  // monsters and short-appearance wanderers keep opening hours and day/night.
  const allDay = practice || npcAroundTheClock(def);
  const [open, close] = allDay ? ["00:00", "23:59"] : def.hours || hours;
  const start = dayStart + minutes(open) * MINUTE,
    end = dayStart + minutes(close) * MINUTE;
  const phase = allDay || !sky ? "any" : def.phase || "any";
  const spans =
    phase === "day"
      ? daylightSpans(start, end, sky.lat, sky.lng)
      : phase === "night"
        ? nightSpans(start, end, sky.lat, sky.lng)
        : [[start, end]];
  // Slivers (a night span of a few minutes before sunrise) are not worth a walk.
  const usable = phase === "any" ? spans : spans.filter(([a, b]) => b - a >= 20 * MINUTE);
  if (!def.windows) return usable;
  // Short appearances (wandering rare, boss): `windows` × 20 min, spread
  // across the active time in equal slices so they never overlap.
  const total = usable.reduce((n, [a, b]) => n + (b - a), 0);
  if (!total) return [];
  const slice = total / def.windows,
    length = Math.min(20 * MINUTE, slice);
  // Map an offset into active time back to a clock time.
  const clockAt = (offset) => {
    for (const [a, b] of usable) {
      if (offset <= b - a) return a + offset;
      offset -= b - a;
    }
    return usable.at(-1)[1];
  };
  const out = [];
  for (let i = 0; i < def.windows; i++) {
    const offset = i * slice + Math.floor(rng() * (slice - length));
    let s = clockAt(offset);
    // Keep each appearance inside one span.
    const span = usable.find(([a, b]) => s >= a && s < b) || usable.at(-1);
    if (s + length > span[1]) s = Math.max(span[0], span[1] - length);
    out.push([s, Math.min(span[1], s + length)]);
  }
  return out;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * planDay(def, cityPack, worldSeed, dayId, options) -> ActorSegment[]
 * options: { dayStart, hours, home?, allDay?, closed?, sky? }
 * `home` overrides def.home (the spawn planner passes it for planned actors).
 * Segments are contiguous inside each active window; a dwell segment has a
 * one-point path.
 */
export function planDay(def, pack, worldSeed, dayId, options) {
  const rng = seededRandom(worldSeed, def.instanceId || def.id, dayId);
  const g = pathGraph(pack, options.closed || []);
  if (!g.nodes.length) return [];
  const home = options.home || def.home || pack.center;
  const homeNode = nearestNode(g, home, 400);
  if (homeNode < 0) return [];
  const windows = activeWindows(def, { ...options, rng });
  const segments = [];
  const still = !(def.speedMps > 0 && def.rangeM > 0);
  let candidates = still
    ? [homeNode]
    : nodesWithin(g, at(g, homeNode), def.rangeM).filter(
        (i) => g.comp[i] === g.comp[homeNode],
      );
  if (candidates.length < 2) candidates = [homeNode];
  // 3–8 stations, spaced at least 80 m apart, home first.
  const stations = [homeNode];
  for (let tries = 0; !still && stations.length < 3 + Math.floor(rng() * 6) && tries < 200; tries++) {
    const c = pick(rng, candidates);
    if (stations.every((s) => distance(at(g, s), at(g, c)) >= 80)) stations.push(c);
  }
  const legs = new Map();
  const leg = (a, b) => {
    const k = `${a}:${b}`;
    if (!legs.has(k)) legs.set(k, shortestPath(g, a, b));
    return legs.get(k);
  };
  const dwellMs = () =>
    Math.round((def.dwellMin[0] + rng() * (def.dwellMin[1] - def.dwellMin[0])) * MINUTE);
  for (const [start, end] of windows) {
    let t = start,
      here = stations[Math.floor(rng() * stations.length)],
      guard = 0;
    while (t < end && guard++ < 500) {
      if (still) {
        segments.push({ from: t, to: end, path: [[g.lng[here], g.lat[here]]], dwell: true });
        break;
      }
      const stay = Math.min(end, t + Math.max(MINUTE, dwellMs()));
      segments.push({ from: t, to: stay, path: [[g.lng[here], g.lat[here]]], dwell: true });
      t = stay;
      if (t >= end) break;
      const options = stations.filter((s) => s !== here);
      const next = pick(rng, options);
      const route = next === undefined ? null : leg(here, next);
      if (!route || route.path.length < 2) continue;
      const walk = Math.max(MINUTE / 6, Math.round((route.meters / def.speedMps) * 1000));
      if (t + walk > end) {
        // Not enough time to finish the walk: stay put for the rest.
        segments.push({ from: t, to: end, path: [[g.lng[here], g.lat[here]]], dwell: true });
        break;
      }
      segments.push({ from: t, to: t + walk, path: route.path });
      t += walk;
      here = next;
    }
  }
  return segments;
}

/** Cumulative leg lengths for a path, cached on the segment object. */
function lengths(seg) {
  if (seg._lengths) return seg._lengths;
  const out = [0];
  for (let i = 1; i < seg.path.length; i++) {
    const [a, b] = [seg.path[i - 1], seg.path[i]];
    out.push(out[i - 1] + distance({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }));
  }
  Object.defineProperty(seg, "_lengths", { value: out, enumerable: false });
  return out;
}

/**
 * positionAt(segments, t) -> { lat, lng, index, dwell } | null (not active).
 * Linear interpolation by distance along the active segment's path.
 */
export function positionAt(segments, t) {
  let lo = 0,
    hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      s = segments[mid];
    if (t < s.from) hi = mid - 1;
    else if (t >= s.to) lo = mid + 1;
    else {
      if (s.path.length === 1 || s.dwell)
        return { lng: s.path[0][0], lat: s.path[0][1], index: mid, dwell: true };
      const L = lengths(s),
        total = L[L.length - 1],
        want = (total * (t - s.from)) / (s.to - s.from);
      let i = 1;
      while (i < L.length - 1 && L[i] < want) i++;
      const span = L[i] - L[i - 1] || 1,
        f = Math.max(0, Math.min(1, (want - L[i - 1]) / span)),
        [a, b] = [s.path[i - 1], s.path[i]];
      return {
        lng: a[0] + (b[0] - a[0]) * f,
        lat: a[1] + (b[1] - a[1]) * f,
        index: mid,
        dwell: false,
      };
    }
  }
  return null;
}
