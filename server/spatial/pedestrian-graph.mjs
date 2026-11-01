import {
  booleanIntersects,
  booleanValid,
  feature,
  lineString,
} from "@turf/turf";
import { assert, distance, hash, point } from "../domain.mjs";

const DENIED = new Set([
  "no",
  "private",
  "customers",
  "permit",
  "agricultural",
  "forestry",
]);
const HIGHWAYS = new Set([
  "footway",
  "pedestrian",
  "path",
  "living_street",
  "steps",
]);
const traversable = (tags = {}) =>
  !DENIED.has(tags.access) &&
  !DENIED.has(tags.foot) &&
  !tags["access:conditional"] &&
  !tags["foot:conditional"] &&
  !tags.construction;
const validId = (id) =>
  typeof id === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(id);
export function validateExclusions(exclusions = []) {
  assert(
    Array.isArray(exclusions) && exclusions.length <= 200,
    "Too many map exclusions.",
  );
  for (const e of exclusions)
    assert(
      validId(e.id) &&
        e.geometry?.type === "Polygon" &&
        booleanValid(feature(e.geometry)),
      "Invalid exclusion polygon.",
    );
  return exclusions;
}
function blockedEdge(a, b, exclusions) {
  return exclusions.some((e) =>
    booleanIntersects(
      lineString([
        [a.lng, a.lat],
        [b.lng, b.lat],
      ]),
      feature(e.geometry),
    ),
  );
}
// Ways connect only through their original OSM node IDs. Geometric crossings,
// bridge projections and coordinate coincidences never invent a junction.
export function importPedestrianGraph(
  source,
  { cityId, exclusions = [] } = {},
) {
  assert(
    validId(cityId) &&
      Array.isArray(source?.elements) &&
      source.elements.length <= 100000,
    "Supply a bounded OSM node/way snapshot and city id.",
  );
  validateExclusions(exclusions);
  const nodes = new Map(),
    blocked = new Set(),
    rejected = [],
    edges = [];
  for (const n of source.elements.filter((e) => e.type === "node")) {
    const id = String(n.id),
      p = point({ lat: n.lat, lng: n.lon });
    assert(
      validId(id) && !nodes.has(id) && nodes.size < 50000,
      "Invalid or duplicate graph node.",
    );
    nodes.set(id, { id, ...p });
    const tags = n.tags || {};
    if (
      !traversable(tags) ||
      (tags.barrier &&
        !["bollard", "cycle_barrier", "entrance"].includes(tags.barrier) &&
        !["yes", "designated", "permissive"].includes(tags.foot))
    )
      blocked.add(id);
  }
  assert(
    nodes.size > 0,
    "OSM node coordinates and IDs are required; geometry-only paths cannot establish junctions.",
  );
  const seenWays = new Set();
  for (const w of source.elements.filter((e) => e.type === "way")) {
    const id = String(w.id),
      tags = w.tags || {};
    assert(validId(id) && !seenWays.has(id), "Invalid or duplicate graph way.");
    seenWays.add(id);
    if (
      !HIGHWAYS.has(tags.highway) ||
      !traversable(tags) ||
      tags.area === "yes"
    ) {
      rejected.push({ wayId: id, reason: "pedestrian-access-not-established" });
      continue;
    }
    assert(
      Array.isArray(w.nodes) && w.nodes.length >= 2 && w.nodes.length <= 10000,
      "Original way node references are required.",
    );
    for (let i = 1; i < w.nodes.length; i++) {
      let from = String(w.nodes[i - 1]),
        to = String(w.nodes[i]);
      const a = nodes.get(from),
        b = nodes.get(to);
      if (
        !a ||
        !b ||
        blocked.has(from) ||
        blocked.has(to) ||
        blockedEdge(a, b, exclusions)
      ) {
        rejected.push({
          wayId: id,
          reason: "missing-node-barrier-or-exclusion",
        });
        continue;
      }
      const meters = distance(a, b);
      if (meters === 0) continue;
      assert(
        meters <= 10000 && edges.length < 100000,
        "Pedestrian edge exceeds its bound.",
      );
      if (tags["oneway:foot"] === "-1") [from, to] = [to, from];
      edges.push({
        from,
        to,
        meters,
        wayId: id,
        directed: ["yes", "1", "-1"].includes(tags["oneway:foot"]),
      });
    }
  }
  const body = {
    version: 1,
    policy: "osm-node-pedestrian-v1",
    cityId,
    sourceHash: hash(JSON.stringify(source)),
    attribution: "© OpenStreetMap contributors · ODbL",
    fieldReview: "pending",
    nodes: [...nodes.values()],
    edges,
    exclusions,
    rejected,
  };
  return { ...body, hash: hash(JSON.stringify(body)) };
}

const gridKey = (lat, lng) =>
  `${Math.floor(lat * 1000)}:${Math.floor(lng * 1000)}`;
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
      first = rows[0],
      last = rows.pop();
    if (rows.length) {
      let i = 0;
      while (i * 2 + 1 < rows.length) {
        let c = i * 2 + 1;
        if (c + 1 < rows.length && rows[c + 1].cost < rows[c].cost) c++;
        if (rows[c].cost >= last.cost) break;
        rows[i] = rows[c];
        i = c;
      }
      rows[i] = last;
    }
    return first;
  }
}
export function createPedestrianRouter(
  graph,
  { exclusions = [], snapMeters = 25 } = {},
) {
  const { hash: fingerprint, ...body } = graph || {};
  assert(
    graph?.version === 1 &&
      graph.policy === "osm-node-pedestrian-v1" &&
      hash(JSON.stringify(body)) === fingerprint,
    "Pedestrian graph integrity failed.",
  );
  assert(
    graph.nodes.length <= 50000 &&
      graph.edges.length <= 100000 &&
      Number.isFinite(snapMeters) &&
      snapMeters > 0 &&
      snapMeters <= 50,
    "Invalid pedestrian routing bounds.",
  );
  exclusions = validateExclusions([...(graph.exclusions || []), ...exclusions]);
  const nodes = new Map(
      graph.nodes.map((n) => [n.id, { id: n.id, ...point(n) }]),
    ),
    adjacency = new Map(),
    grid = new Map(),
    edges = [];
  assert(nodes.size === graph.nodes.length, "Duplicate pedestrian graph node.");
  let indexed = 0;
  for (const edge of graph.edges) {
    const a = nodes.get(edge.from),
      b = nodes.get(edge.to);
    assert(
      a &&
        b &&
        edge.from !== edge.to &&
        Math.abs(distance(a, b) - edge.meters) < 0.01,
      "Invalid pedestrian graph edge.",
    );
    if (blockedEdge(a, b, exclusions)) continue;
    const index = edges.length;
    edges.push(edge);
    const minLat = Math.floor(Math.min(a.lat, b.lat) * 1000),
      maxLat = Math.floor(Math.max(a.lat, b.lat) * 1000),
      minLng = Math.floor(Math.min(a.lng, b.lng) * 1000),
      maxLng = Math.floor(Math.max(a.lng, b.lng) * 1000);
    assert(
      (maxLat - minLat + 1) * (maxLng - minLng + 1) <= 10000 &&
        (indexed += (maxLat - minLat + 1) * (maxLng - minLng + 1)) <= 1000000,
      "Edge index exceeds its bound.",
    );
    for (let lat = minLat; lat <= maxLat; lat++)
      for (let lng = minLng; lng <= maxLng; lng++) {
        const k = `${lat}:${lng}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(index);
      }
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push({ to: edge.to, meters: edge.meters });
    if (!edge.directed) {
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.to).push({ to: edge.from, meters: edge.meters });
    }
  }
  function snap(p) {
    point(p);
    const [lat, lng] = gridKey(p.lat, p.lng).split(":").map(Number),
      candidates = new Set();
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++)
        for (const index of grid.get(`${lat + y}:${lng + x}`) || [])
          candidates.add(index);
    let best = null;
    const near = [];
    const scale = Math.cos((p.lat * Math.PI) / 180);
    for (const index of candidates) {
      const edge = edges[index],
        a = nodes.get(edge.from),
        b = nodes.get(edge.to),
        dx = (b.lng - a.lng) * scale,
        dy = b.lat - a.lat;
      if (p.pathId && String(p.pathId).replace(/^osm-way-/, "") !== edge.wayId)
        continue;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.lng - a.lng) * scale * dx + (p.lat - a.lat) * dy) /
            (dx * dx + dy * dy),
        ),
      );
      const at = {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
        },
        gap = distance(p, at);
      if (gap <= snapMeters) {
        const match = { edge, index, t, at, gap };
        near.push(match);
        if (!best || gap < best.gap) best = match;
      }
    }
    if (
      best &&
      !p.pathId &&
      near.some(
        (m) =>
          Math.abs(m.gap - best.gap) < 0.5 &&
          m.index !== best.index &&
          ![best.edge.from, best.edge.to].some(
            (id) => id === m.edge.from || id === m.edge.to,
          ),
      )
    )
      return null;
    return best;
  }
  function route(from, to) {
    const a = snap(from),
      b = snap(to),
      missing = {
        status: "unreachable",
        reason: "target-not-on-public-graph",
        meters: null,
        graphHash: fingerprint,
      };
    if (
      !a ||
      !b ||
      blockedEdge(from, a.at, exclusions) ||
      blockedEdge(to, b.at, exclusions)
    )
      return missing;
    let best =
      a.index === b.index && (!a.edge.directed || b.t >= a.t)
        ? Math.abs(b.t - a.t) * a.edge.meters
        : Infinity;
    const start = [
      [a.edge.to, (1 - a.t) * a.edge.meters],
      ...(!a.edge.directed || a.t === 0
        ? [[a.edge.from, a.t * a.edge.meters]]
        : []),
    ];
    const finish = new Map([
      [b.edge.from, b.t * b.edge.meters],
      ...(!b.edge.directed || b.t === 1
        ? [[b.edge.to, (1 - b.t) * b.edge.meters]]
        : []),
    ]);
    const costs = new Map(),
      queue = new Heap();
    for (const [id, cost] of start) {
      if (cost < (costs.get(id) ?? Infinity)) {
        costs.set(id, cost);
        queue.push({ id, cost });
      }
    }
    while (queue.rows.length) {
      const { id, cost } = queue.pop();
      if (cost !== costs.get(id) || cost >= best) continue;
      if (finish.has(id)) best = Math.min(best, cost + finish.get(id));
      for (const edge of adjacency.get(id) || []) {
        const next = cost + edge.meters;
        if (next < (costs.get(edge.to) ?? Infinity) && next < best) {
          costs.set(edge.to, next);
          queue.push({ id: edge.to, cost: next });
        }
      }
    }
    return Number.isFinite(best)
      ? {
          status: "reachable",
          meters: Math.round(best + a.gap + b.gap),
          graphHash: fingerprint,
          source: "mapped-pedestrian-graph",
          fieldReview: "pending",
        }
      : { ...missing, reason: "disconnected-public-paths" };
  }
  return {
    route,
    hash: fingerprint,
    cityId: graph.cityId,
    edgeCount: edges.length,
  };
}
