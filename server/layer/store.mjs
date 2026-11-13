// Layer state (docs/LAYER.md): home plots, player-built blocks, edit
// receipts and daily beacon activations in SQLite, plus ephemeral presence
// in memory. Nonfinancial: MetaLayer shares read-only receipt validation,
// without signing, payout or reward writes. Virtual positions are never GPS evidence.
import { atomic } from "../database.mjs";
import { assert, hash, id } from "../domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
import { DEFAULT_LAYER, layerById } from "./layers.mjs";
import { createExpeditionStore } from "./expedition.mjs";
import { publicLook } from "../public-look.mjs";
import {
  BLOCK,
  BUILD_BLOCKS,
  HEIGHT,
  PLOT_DEPTH,
  SETTLE_Y,
  BEACON_REACH,
  column,
  columnBlock,
  inPlot,
  outfitById,
  beaconsNear,
  slotPlot,
} from "./world.mjs";

export const LAYER_SCHEMA = registerModuleSchema({
  name: "virtual-layer",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS layer_plots(
 id TEXT PRIMARY KEY,
 layer TEXT NOT NULL,
 slot INTEGER NOT NULL CHECK(slot>=0),
 owner_id TEXT NOT NULL REFERENCES players(id),
 x0 INTEGER NOT NULL,
 z0 INTEGER NOT NULL,
 size INTEGER NOT NULL CHECK(size>0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 block_count INTEGER NOT NULL DEFAULT 0 CHECK(block_count>=0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(layer,slot),
 UNIQUE(layer,owner_id)
);
CREATE INDEX IF NOT EXISTS layer_plots_area ON layer_plots(layer,x0,z0);
CREATE TABLE IF NOT EXISTS layer_blocks(
 plot_id TEXT NOT NULL REFERENCES layer_plots(id),
 x INTEGER NOT NULL,
 y INTEGER NOT NULL,
 z INTEGER NOT NULL,
 block INTEGER NOT NULL CHECK(block>=0),
 PRIMARY KEY(plot_id,x,y,z)
);
CREATE TABLE IF NOT EXISTS layer_edit_receipts(
 plot_id TEXT NOT NULL REFERENCES layer_plots(id),
 request_id TEXT NOT NULL,
 digest TEXT NOT NULL,
 revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(plot_id,request_id)
);
CREATE TABLE IF NOT EXISTS layer_beacons(
 layer TEXT NOT NULL,
 player_id TEXT NOT NULL REFERENCES players(id),
 day TEXT NOT NULL,
 beacon_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(layer,player_id,day,beacon_id)
);
`,
});

export const LAYER_LIMITS = Object.freeze({
  editsPerRequest: 32,
  blocksPerPlot: 8192,
  receiptsPerPlot: 64,
  plotsPerArea: 64,
  areaRadius: 160,
  peerRadius: 128,
  peersPerReply: 24,
  presenceTtlMs: 15_000,
  /** Horizontal blocks per second a position may move, with slack for lag. */
  maxSpeed: 12,
  beaconGoal: 3,
  buildGoal: 8,
});
const MIN_Y = SETTLE_Y - PLOT_DEPTH + 1;
const BUILDABLE = new Set([BLOCK.air, ...BUILD_BLOCKS]);
const finite = (v, limit) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

function layerOf(id) {
  const layer = layerById(id ?? DEFAULT_LAYER);
  assert(layer, "Unknown layer.", 404);
  return layer;
}
const publicPlot = (row) => ({
  id: row.id,
  layer: row.layer,
  ownerName: row.owner_name,
  x0: row.x0,
  z0: row.z0,
  size: row.size,
  revision: row.revision,
  blocks: row.block_count,
});
export const spawnOf = (plot) => ({
  x: plot.x0 + plot.size / 2,
  y: SETTLE_Y + 1,
  z: plot.z0 + plot.size / 2,
});

export function createLayerStore(db, { now = () => Date.now(), economy = null } = {}) {
  ensureModuleVersion(db, LAYER_SCHEMA);
  const expedition = createExpeditionStore(db, { now, onRecord: economy?.onRecord ?? null, ownsLand: economy?.ownsLand ?? null });
  const presence = new Map();
  const plotRow = db.prepare(
    "SELECT p.*, pl.name AS owner_name FROM layer_plots p JOIN players pl ON pl.id=p.owner_id WHERE p.id=?",
  );
  const homeRow = db.prepare(
    "SELECT p.*, pl.name AS owner_name FROM layer_plots p JOIN players pl ON pl.id=p.owner_id WHERE p.layer=? AND p.owner_id=?",
  );

  function home(actor, layerId) {
    const layer = layerOf(layerId);
    let row = homeRow.get(layer.id, actor.id);
    if (!row)
      row = atomic(db, () => {
        const existing = homeRow.get(layer.id, actor.id);
        if (existing) return existing;
        const { next } = db
          .prepare("SELECT COALESCE(MAX(slot)+1,0) AS next FROM layer_plots WHERE layer=?")
          .get(layer.id);
        const plot = slotPlot(next),
          plotId = id("rp"),
          at = now();
        db.prepare(
          "INSERT INTO layer_plots(id,layer,slot,owner_id,x0,z0,size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ).run(plotId, layer.id, next, actor.id, plot.x0, plot.z0, plot.size, at, at);
        return plotRow.get(plotId);
      });
    const plot = publicPlot(row);
    return { plot, spawn: spawnOf(plot) };
  }

  function plotsNear(layerId, x, z) {
    const layer = layerOf(layerId);
    assert(finite(x, 1e6) && finite(z, 1e6), "Invalid position.");
    const r = LAYER_LIMITS.areaRadius;
    return db
      .prepare(
        `SELECT p.*, pl.name AS owner_name FROM layer_plots p JOIN players pl ON pl.id=p.owner_id
         WHERE p.layer=? AND p.x0 BETWEEN ? AND ? AND p.z0 BETWEEN ? AND ?
         ORDER BY p.slot LIMIT ?`,
      )
      .all(layer.id, x - r - 64, x + r, z - r - 64, z + r, LAYER_LIMITS.plotsPerArea)
      .map(publicPlot);
  }

  function plot(plotId) {
    assert(typeof plotId === "string" && /^rp_[0-9a-f-]{36}$/.test(plotId), "Invalid plot.");
    const row = plotRow.get(plotId);
    assert(row, "This plot does not exist.", 404);
    const blocks = db
      .prepare("SELECT x,y,z,block FROM layer_blocks WHERE plot_id=? ORDER BY x,y,z")
      .all(plotId)
      .map((b) => [b.x, b.y, b.z, b.block]);
    return { plot: publicPlot(row), blocks };
  }

  function edit(actor, input) {
    assert(input && typeof input === "object", "Invalid request.");
    const { plotId, requestId, edits } = input;
    assert(typeof requestId === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(requestId), "Invalid request.");
    assert(
      Array.isArray(edits) && edits.length >= 1 && edits.length <= LAYER_LIMITS.editsPerRequest,
      "Invalid edits.",
    );
    assert(typeof plotId === "string" && /^rp_[0-9a-f-]{36}$/.test(plotId), "Invalid plot.");
    const normalized = edits.map((e) => {
      assert(e && typeof e === "object", "Invalid edit.");
      const { x, y, z, block } = e;
      assert([x, y, z, block].every(Number.isSafeInteger), "Invalid edit.");
      assert(BUILDABLE.has(block), "That block cannot be placed.");
      assert(y >= MIN_Y && y < HEIGHT, "That height is outside your plot.");
      return [x, y, z, block];
    });
    const digest = hash(JSON.stringify([plotId, normalized]));
    return atomic(db, () => {
      const row = plotRow.get(plotId);
      assert(row, "This plot does not exist.", 404);
      assert(row.owner_id === actor.id, "You can only build on your own plot.", 403);
      const receipt = db
        .prepare("SELECT digest,revision FROM layer_edit_receipts WHERE plot_id=? AND request_id=?")
        .get(plotId, requestId);
      if (receipt) {
        assert(receipt.digest === digest, "This request ID was already used for other edits.", 409);
        return { plot: publicPlot(row), alreadySaved: true };
      }
      const seed = layerById(row.layer).seed;
      for (const [x, y, z] of normalized)
        assert(inPlot(row, x, z), "You can only build inside your plot.", 403);
      const upsert = db.prepare(
        "INSERT INTO layer_blocks(plot_id,x,y,z,block) VALUES (?,?,?,?,?) ON CONFLICT(plot_id,x,y,z) DO UPDATE SET block=excluded.block",
      );
      const remove = db.prepare("DELETE FROM layer_blocks WHERE plot_id=? AND x=? AND y=? AND z=?");
      for (const [x, y, z, block] of normalized) {
        // Restoring the natural block deletes the override, so storage only
        // holds what players changed.
        if (columnBlock(column(seed, x, z), y) === block) remove.run(plotId, x, y, z);
        else upsert.run(plotId, x, y, z, block);
      }
      const { count } = db.prepare("SELECT COUNT(*) AS count FROM layer_blocks WHERE plot_id=?").get(plotId);
      assert(count <= LAYER_LIMITS.blocksPerPlot, "This plot is full. Remove some blocks first.", 409);
      const at = now(),
        revision = row.revision + 1;
      db.prepare("UPDATE layer_plots SET revision=?, block_count=?, updated_at=? WHERE id=?").run(
        revision,
        count,
        at,
        plotId,
      );
      db.prepare(
        "INSERT INTO layer_edit_receipts(plot_id,request_id,digest,revision,created_at) VALUES (?,?,?,?,?)",
      ).run(plotId, requestId, digest, revision, at);
      db.prepare(
        `DELETE FROM layer_edit_receipts WHERE plot_id=? AND request_id NOT IN (
           SELECT request_id FROM layer_edit_receipts WHERE plot_id=? ORDER BY revision DESC LIMIT ?)`,
      ).run(plotId, plotId, LAYER_LIMITS.receiptsPerPlot);
      return { plot: publicPlot(plotRow.get(plotId)), alreadySaved: false };
    });
  }

  function progress(actor, layer, at = now()) {
    const day = dayOf(at);
    const beacons = db
      .prepare("SELECT beacon_id FROM layer_beacons WHERE layer=? AND player_id=? AND day=? ORDER BY created_at")
      .all(layer.id, actor.id, day)
      .map((r) => r.beacon_id);
    const built = homeRow.get(layer.id, actor.id)?.block_count ?? 0;
    return {
      day,
      beacons,
      beaconGoal: LAYER_LIMITS.beaconGoal,
      built,
      buildGoal: LAYER_LIMITS.buildGoal,
    };
  }

  /** Report a position; returns nearby explorers and today's progress. */
  function visit(actor, input) {
    assert(input && typeof input === "object", "Invalid request.");
    const layer = layerOf(input.layer);
    const at = now(),
      key = `${layer.id}:${actor.id}`,
      last = presence.get(key);
    let corrected = null;
    let position;
    if (input.home === true) {
      const { spawn } = home(actor, layer.id);
      position = { ...spawn, yaw: 0 };
      corrected = spawn;
    } else {
      const { x, y, z, yaw } = input;
      assert(
        finite(x, 1e6) && finite(z, 1e6) && finite(y, HEIGHT * 4) && finite(yaw ?? 0, 100),
        "Invalid position.",
      );
      position = { x, y, z, yaw: yaw ?? 0 };
      if (last && at - last.at < LAYER_LIMITS.presenceTtlMs) {
        const seconds = Math.max(0.25, (at - last.at) / 1000);
        if (Math.hypot(x - last.x, z - last.z) > LAYER_LIMITS.maxSpeed * seconds + 4) {
          position = { ...last };
          corrected = { x: last.x, y: last.y, z: last.z };
        }
      }
    }
    let expeditionState;
    if (input.expedition === true) {
      assert(input.home !== true, "Return through the MetaLayer entrance.", 409);
      expeditionState = expedition.move(actor, layer.id, position);
      if (expeditionState.corrected) {
        position = { ...position, ...expeditionState.corrected };
        corrected = expeditionState.corrected;
      }
    }
    const look = publicLook(db, actor.id, at);
    presence.set(key, { ...position, at, name: actor.name, outfit: outfitById(input.outfit).id, layer: layer.id, peer: hash(key).slice(0, 16), look: { above: look.above, below: look.below } });
    if (presence.size > 256)
      for (const [k, v] of presence) if (at - v.at > LAYER_LIMITS.presenceTtlMs * 4) presence.delete(k);

    // Activate beacons the explorer stands on (server-checked, once per day each).
    const today = dayOf(at);
    const done = db
      .prepare("SELECT COUNT(*) AS n FROM layer_beacons WHERE layer=? AND player_id=? AND day=?")
      .get(layer.id, actor.id, today).n;
    let activated = null;
    if (!corrected && done < LAYER_LIMITS.beaconGoal) {
      const beacon = beaconsNear(layer.seed, position.x, position.z, BEACON_REACH)[0];
      if (beacon && Math.abs(position.y - beacon.y) <= 4) {
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO layer_beacons(layer,player_id,day,beacon_id,created_at) VALUES (?,?,?,?,?)",
          )
          .run(layer.id, actor.id, today, beacon.id, at);
        if (inserted.changes) activated = beacon.id;
      }
    }

    const peers = [];
    for (const [k, v] of presence) {
      if (k === key || v.layer !== layer.id || at - v.at > LAYER_LIMITS.presenceTtlMs) continue;
      if (Math.hypot(v.x - position.x, v.z - position.z) > LAYER_LIMITS.peerRadius) continue;
      peers.push({ id: v.peer, name: v.name, outfit: v.outfit, x: v.x, y: v.y, z: v.z, yaw: v.yaw, look: v.look });
      if (peers.length >= LAYER_LIMITS.peersPerReply) break;
    }
    return { peers, corrected, activated, progress: progress(actor, layer, at), ...(expeditionState ? { expedition: expeditionState } : {}) };
  }

  function leave(actor, layerId) {
    presence.delete(`${layerOf(layerId).id}:${actor.id}`);
    return { left: true };
  }

  const economyOf = (actor, l) => {
    const layer = layerOf(l);
    return economy ? economy.summary(actor, layer.id) : { active: false, metagold: "0", metaXp: 0, badges: [], parcels: [], pending: [], treasury: null };
  };
  const syncParcel = (actor, input) => {
    layerOf(input?.layer);
    if (!economy?.syncParcel) return { owned: false, owner: null };
    return economy.syncParcel(actor, Number(input.x0), Number(input.z0));
  };
  return { home, plotsNear, plot, edit, visit, leave, expedition, economy: economyOf, syncParcel, progress: (actor, l) => progress(actor, layerOf(l)) };
}
