import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { openDatabase } from "../server/database.mjs";
import { createLayerStore, LAYER_LIMITS } from "../server/layer/store.mjs";
import { createLayerRoutes } from "../server/layer/routes.mjs";
import { LAYER_REGISTRY, layerById } from "../server/layer/layers.mjs";
import {
  BLOCK,
  HEIGHT,
  SETTLE_Y,
  SLOTS_PER_DISTRICT,
  column,
  columnBlock,
  districtAt,
  districtSlots,
  forEachFeature,
  inPlot,
  beaconsNear,
  beaconById,
  slotPlot,
} from "../server/layer/world.mjs";

const SEED = LAYER_REGISTRY[0].seed;
function fixture(t, clock = { at: Date.UTC(2026, 10, 11, 9) }) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  const actors = {};
  for (const name of ["Alice", "Bob", "Eve"]) {
    const id = `explorer-${name.toLowerCase()}`;
    db.prepare("INSERT INTO players(id,name,created_at) VALUES (?,?,?)").run(id, name, 1);
    actors[name] = { id, name };
  }
  return { db, clock, actors, store: createLayerStore(db, { now: () => clock.at }) };
}
const rid = (n) => `request-${String(n).padStart(12, "0")}`;

test("the world is a deterministic function of seed and position", () => {
  for (const [x, z] of [[0, 0], [517, -233], [-9001, 4410], [120000, 77]]) {
    assert.deepEqual(column(SEED, x, z), column(SEED, x, z));
    const col = column(SEED, x, z);
    assert.ok(col.height >= 2 && col.height < HEIGHT - 4, `height at ${x},${z}`);
    assert.equal(columnBlock(col, col.height), col.top);
    assert.equal(columnBlock(col, col.height + 1) === BLOCK.air || col.height + 1 <= 11, true);
  }
  assert.notDeepEqual(
    [0, 1, 2, 3, 4].map((i) => column(SEED, 1000 + i * 37, 900).height),
    [0, 1, 2, 3, 4].map((i) => column(SEED + 1, 1000 + i * 37, 900).height),
    "another layer seed grows another landscape",
  );
  const features = [];
  forEachFeature(SEED, 600, 600, 632, 632, (...b) => features.push(b));
  const again = [];
  forEachFeature(SEED, 600, 600, 632, 632, (...b) => again.push(b));
  assert.deepEqual(features, again);
  for (const [x, , z] of features) assert.ok(x >= 600 && x < 632 && z >= 600 && z < 632);
});

test("settlements are flat, home plots fill outward and never overlap", () => {
  const seen = new Set();
  const plots = Array.from({ length: SLOTS_PER_DISTRICT * 3 }, (_, i) => slotPlot(i));
  for (const p of plots) {
    for (const [x, z] of [[p.x0, p.z0], [p.x0 + 15, p.z0 + 15]]) {
      const col = column(SEED, x, z);
      assert.equal(col.height, SETTLE_Y);
      assert.equal(col.top, BLOCK.grass, "plot ground is grass");
    }
    const key = `${p.x0},${p.z0}`;
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  assert.deepEqual(districtAt(0), [0, 0]);
  const districts = new Set(Array.from({ length: 49 }, (_, i) => districtAt(i).join(",")));
  assert.equal(districts.size, 49, "the spiral visits each district once");
  const first = districtSlots(0, 0);
  assert.ok(Math.max(Math.abs(first[0].x0), Math.abs(first[0].z0)) <= 40, "first plot borders the plaza");
  assert.equal(column(SEED, 0, 0).top, BLOCK.path, "plaza");
});

test("beacons are stable landmarks with ids the server can resolve", () => {
  const near = beaconsNear(SEED, 0, 0, 900);
  assert.ok(near.length >= 5, "enough beacons to explore");
  for (const s of near) {
    assert.deepEqual(beaconById(SEED, s.id), s);
    assert.ok(s.y > 11);
  }
  assert.equal(beaconById(SEED, "../x"), null);
});

test("each explorer gets one home plot; only the owner builds inside it", (t) => {
  const { store, actors } = fixture(t);
  const a = store.home(actors.Alice, "space");
  assert.equal(store.home(actors.Alice, "space").plot.id, a.plot.id);
  const b = store.home(actors.Bob);
  assert.notEqual(a.plot.id, b.plot.id);
  assert.deepEqual(a.plot, { ...slotPlot(0), id: a.plot.id, layer: "space", ownerName: "Alice", revision: 0, blocks: 0 });
  assert.equal(a.spawn.y, SETTLE_Y + 1);
  const inside = { x: a.plot.x0 + 3, y: SETTLE_Y + 1, z: a.plot.z0 + 4, block: BLOCK.brick };
  const saved = store.edit(actors.Alice, { plotId: a.plot.id, requestId: rid(1), edits: [inside] });
  assert.equal(saved.plot.revision, 1);
  assert.equal(saved.plot.blocks, 1);
  assert.throws(
    () => store.edit(actors.Bob, { plotId: a.plot.id, requestId: rid(2), edits: [inside] }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      store.edit(actors.Alice, {
        plotId: a.plot.id,
        requestId: rid(3),
        edits: [{ ...inside, x: a.plot.x0 + 16 }],
      }),
    (e) => e.status === 403,
    "the plot edge is exclusive",
  );
  for (const bad of [
    { ...inside, block: BLOCK.water },
    { ...inside, block: 999 },
    { ...inside, y: SETTLE_Y - 3 },
    { ...inside, y: HEIGHT },
    { ...inside, x: 1.5 },
  ])
    assert.throws(() => store.edit(actors.Alice, { plotId: a.plot.id, requestId: rid(4), edits: [bad] }), (e) => e.status === 400);
  assert.deepEqual(store.plot(a.plot.id).blocks, [[inside.x, inside.y, inside.z, BLOCK.brick]]);
});

test("edits are idempotent and restoring nature removes the stored block", (t) => {
  const { store, actors } = fixture(t);
  const { plot } = store.home(actors.Alice);
  const cell = { x: plot.x0, y: SETTLE_Y, z: plot.z0 };
  const dig = { plotId: plot.id, requestId: rid(10), edits: [{ ...cell, block: BLOCK.air }] };
  store.edit(actors.Alice, dig);
  const replay = store.edit(actors.Alice, dig);
  assert.equal(replay.alreadySaved, true);
  assert.equal(replay.plot.revision, 1);
  assert.throws(
    () => store.edit(actors.Alice, { ...dig, edits: [{ ...cell, block: BLOCK.stone }] }),
    (e) => e.status === 409,
  );
  const restored = store.edit(actors.Alice, { plotId: plot.id, requestId: rid(11), edits: [{ ...cell, block: BLOCK.grass }] });
  assert.equal(restored.plot.blocks, 0);
  assert.deepEqual(store.plot(plot.id).blocks, []);
  assert.throws(
    () =>
      store.edit(actors.Alice, {
        plotId: plot.id,
        requestId: rid(12),
        edits: Array.from({ length: LAYER_LIMITS.editsPerRequest + 1 }, () => ({ ...cell, block: 1 })),
      }),
    (e) => e.status === 400,
  );
});

test("presence shares nearby explorers only and rejects teleports", (t) => {
  const { store, actors, clock } = fixture(t);
  const a = store.home(actors.Alice).spawn,
    b = store.home(actors.Bob).spawn;
  store.visit(actors.Alice, { ...a, yaw: 0 });
  const seen = store.visit(actors.Bob, { ...b, yaw: 1 });
  assert.equal(seen.peers.length, 1);
  assert.equal(seen.peers[0].name, "Alice");
  assert.ok(!("id" in seen.peers[0]) || !seen.peers[0].id.includes("alice"), "peers carry an opaque key");
  clock.at += 1000;
  const jump = store.visit(actors.Alice, { x: a.x + 500, y: a.y, z: a.z, yaw: 0 });
  assert.deepEqual(jump.corrected, { x: a.x, y: a.y, z: a.z });
  const home = store.visit(actors.Alice, { home: true });
  assert.deepEqual(home.corrected, a);
  clock.at += LAYER_LIMITS.presenceTtlMs + 1;
  assert.equal(store.visit(actors.Bob, { ...b, yaw: 1 }).peers.length, 0, "stale positions expire");
  store.visit(actors.Eve, { x: b.x + 1000, y: 20, z: b.z, yaw: 0 });
  assert.equal(store.visit(actors.Bob, { ...b, yaw: 1 }).peers.length, 0, "far explorers stay hidden");
});

test("standing on a beacon activates it once a day, up to the daily goal", (t) => {
  const { store, actors, clock } = fixture(t);
  const beacons = beaconsNear(SEED, 0, 0, 2000).slice(0, LAYER_LIMITS.beaconGoal + 1);
  let progress;
  for (const s of beacons) {
    // A fresh presence (after the TTL) may start anywhere.
    clock.at += LAYER_LIMITS.presenceTtlMs + 1;
    progress = store.visit(actors.Eve, { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5, yaw: 0 });
  }
  assert.equal(progress.progress.beacons.length, LAYER_LIMITS.beaconGoal);
  assert.equal(progress.activated, null, "the goal caps daily activations");
  clock.at += 86_400_000;
  assert.equal(store.progress(actors.Eve, "space").beacons.length, 0, "a new day starts fresh");
});

function request(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = { "content-type": "application/json", ...headers };
  return req;
}
async function call(routes, path, { method = "GET", body, player = "explorer-alice", headers } = {}) {
  let out;
  const ctx = {
    player,
    respond: (_res, data, status) => (out = { status, data }),
    assert: (c, message, status = 400) => {
      if (!c) throw Object.assign(new Error(message), { status });
    },
  };
  await routes.handle(request(method, body, headers), {}, new URL("http://x" + path), ctx);
  return out;
}

test("routes use the session explorer and refuse cross-site or anonymous writes", async (t) => {
  const { store, db } = fixture(t);
  const routes = createLayerRoutes({
    store,
    authenticate: () => "explorer-alice",
    actorFor: (id) => ({ id, name: db.prepare("SELECT name FROM players WHERE id=?").get(id).name }),
  });
  const home = await call(routes, "/api/layer/home", { method: "POST", body: { layer: "space", actor: "explorer-bob" } });
  assert.equal(home.data.plot.ownerName, "Alice");
  assert.equal(home.data.progress.buildGoal, LAYER_LIMITS.buildGoal);
  const layers = await call(routes, "/api/layer/layers");
  assert.equal(layers.data.layers[0].coin, "MINECOIN");
  assert.equal(layers.data.layers[0].economyActive, false);
  await assert.rejects(
    call(routes, "/api/layer/home", { method: "POST", body: {}, headers: { "sec-fetch-site": "cross-site" } }),
    (e) => e.status === 403,
  );
  await assert.rejects(call(routes, "/api/layer/home", { method: "POST", body: {}, player: null }), (e) => e.status === 401);
  await assert.rejects(call(routes, "/api/layer/home", { method: "POST", body: { layer: "nope" } }), (e) => e.status === 404);
  const plots = await call(routes, `/api/layer/plots?layer=space&x=0&z=0`);
  assert.equal(plots.data.plots.length, 1);
  assert.equal(await routes.handle(request("GET"), {}, new URL("http://x/api/other"), {}), false);
});

test("every layer keeps QGOLD mechanics and inactive money until reviewed", () => {
  for (const layer of LAYER_REGISTRY) {
    assert.equal(layer.coin.mechanics, "qgold");
    assert.equal(layer.economy.active, false);
    assert.equal(layer.economy.treasury, "per-layer");
    assert.equal(layerById(layer.id), layer);
  }
  assert.equal(new Set(LAYER_REGISTRY.map((l) => l.seed)).size, LAYER_REGISTRY.length);
  assert.ok(inPlot({ x0: 0, z0: 0, size: 16 }, 15, 0) && !inPlot({ x0: 0, z0: 0, size: 16 }, 16, 0));
});
