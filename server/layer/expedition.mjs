// Durable, nonfinancial MetaLayer play preview. All resource counts live here,
// independently of QuestLayer inventory, XP, QGOLD and native settlement.
import { atomic } from "../database.mjs";
import { assert, hash, id } from "../domain.mjs";
import {
  ensureModuleVersion,
  registerModuleSchema,
} from "../schema-compatibility.mjs";
import { createStoryStore } from "./story.mjs";
import { MARKER } from "./story-world.mjs";
import { createLayerActivity } from "./activity.mjs";
import { layerById, DEFAULT_LAYER } from "./layers.mjs";
import { BLOCK, BUILD_BLOCKS, HEIGHT } from "./world.mjs";
import {
  ATLAS_CELL,
  DIAMOND_GOAL,
  DIAMOND_ORE,
  MINES,
  ORE_RENEW_MS,
  PLAZA,
  PLAZA_SPAWN,
  clearMiningRay,
  breakable,
  inPlaza,
  mineable,
  miningDuration,
  naturalExpeditionBlock,
  protectedPlaza,
} from "./expedition-world.mjs";

export const EXPEDITION_SCHEMA = registerModuleSchema({
  name: "metalayer-expedition",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS ml_explorers(
 layer TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id),
 x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, seen_at INTEGER NOT NULL,
 started_at INTEGER, discovered_at INTEGER, completed_at INTEGER,
 diamonds INTEGER NOT NULL DEFAULT 0, stone INTEGER NOT NULL DEFAULT 0,
 quest_diamonds INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(layer,player_id)
);
CREATE TABLE IF NOT EXISTS ml_blocks(
 layer TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,
 block INTEGER NOT NULL, renew_at INTEGER, author TEXT NOT NULL,
 PRIMARY KEY(layer,x,y,z)
);
CREATE INDEX IF NOT EXISTS ml_blocks_area ON ml_blocks(layer,x,z);
CREATE TABLE IF NOT EXISTS ml_atlas(
 layer TEXT NOT NULL,x INTEGER NOT NULL,z INTEGER NOT NULL,
 PRIMARY KEY(layer,x,z)
);
CREATE TABLE IF NOT EXISTS ml_receipts(
 layer TEXT NOT NULL,player_id TEXT NOT NULL,request_id TEXT NOT NULL,
 digest TEXT NOT NULL,result TEXT NOT NULL,
 PRIMARY KEY(layer,player_id,request_id)
);
CREATE TABLE IF NOT EXISTS ml_mining(
 layer TEXT NOT NULL,player_id TEXT NOT NULL,token TEXT NOT NULL,
 x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,
 block INTEGER NOT NULL,started_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL,
 PRIMARY KEY(layer,player_id)
);
`,
});
const PLACEABLE = new Set(BUILD_BLOCKS);
const coordinates = (input) => {
  const { x, y, z } = input;
  assert(
    [x, y, z].every(Number.isSafeInteger) &&
      Math.abs(x) <= 1e6 &&
      Math.abs(z) <= 1e6 &&
      y >= 0 &&
      y < HEIGHT,
    "Invalid block position.",
  );
  return { x, y, z };
};

export function createExpeditionStore(db, { now = () => Date.now(), near } = {}) {
  ensureModuleVersion(db, EXPEDITION_SCHEMA);
  const explorer = db.prepare(
    "SELECT * FROM ml_explorers WHERE layer=? AND player_id=?",
  );
  const blockRow = db.prepare(
    "SELECT * FROM ml_blocks WHERE layer=? AND x=? AND y=? AND z=?",
  );
  function layerOf(value) {
    const layer = layerById(value ?? DEFAULT_LAYER);
    assert(layer, "Unknown layer.", 404);
    return layer;
  }
  function actorRow(actor, layer) {
    const row = explorer.get(layer.id, actor.id);
    assert(row, "Enter MetaLayer first.", 409);
    return row;
  }
  function nearActor(actor, layer) {
    const row = actorRow(actor, layer);
    assert(
      now() - row.seen_at <= 12_000,
      "Reconnect to MetaLayer before using a tool.",
      409,
    );
    return row;
  }
  function occupied(layer, x, y, z) {
    return db
      .prepare(
        "SELECT 1 FROM ml_explorers WHERE layer=? AND seen_at>=? AND x>? AND x<? AND z>? AND z<? AND y<? AND y+1.8>? LIMIT 1",
      )
      .get(
        layer.id,
        now() - 12_000,
        x - 0.3,
        x + 1.3,
        z - 0.3,
        z + 1.3,
        y + 1,
        y,
      );
  }
  function readBlock(layer, x, y, z) {
    const row = blockRow.get(layer.id, x, y, z);
    if (
      row &&
      (row.renew_at === null ||
        row.renew_at > now() ||
        occupied(layer, x, y, z))
    )
      return row.block;
    return naturalExpeditionBlock(layer.seed, x, y, z);
  }
  const activity = createLayerActivity(db, { now, ...near });
  const story = createStoryStore(db, { now, readBlock, record: activity.record });
  function progress(actor, layer) {
    const row = actorRow(actor, layer);
    return {
      inventory: { diamonds: row.diamonds, stone: row.stone },
      quest: {
        state: row.completed_at
          ? "complete"
          : !row.started_at
            ? "available"
            : !row.discovered_at
              ? "discover"
              : "mine",
        diamonds: row.quest_diamonds,
        goal: DIAMOND_GOAL,
      },
      story: story.state(actor, layer, row),
      settlement: "not-configured",
    };
  }
  function snapshot(actor, value, x = PLAZA_SPAWN.x, z = PLAZA_SPAWN.z) {
    const layer = layerOf(value);
    assert(
      Number.isFinite(x) &&
        Number.isFinite(z) &&
        Math.abs(x) <= 1e6 &&
        Math.abs(z) <= 1e6,
      "Invalid map position.",
    );
    // A renewing vein must never grow through an explorer's body.
    const renewing = db
      .prepare("SELECT x,y,z FROM ml_blocks WHERE layer=? AND renew_at<=?")
      .all(layer.id, now());
    for (const block of renewing)
      if (occupied(layer, block.x, block.y, block.z))
        db.prepare(
          "UPDATE ml_blocks SET renew_at=? WHERE layer=? AND x=? AND y=? AND z=?",
        ).run(now() + 2000, layer.id, block.x, block.y, block.z);
    const r = 112;
    const changes = db
      .prepare(
        "SELECT x,y,z,block FROM ml_blocks WHERE layer=? AND x BETWEEN ? AND ? AND z BETWEEN ? AND ? AND (renew_at IS NULL OR renew_at>?) ORDER BY x,z,y LIMIT 8192",
      )
      .all(layer.id, x - r, x + r, z - r, z + r, now())
      .map((b) => [b.x, b.y, b.z, b.block]);
    const cx = Math.floor(x / ATLAS_CELL),
      cz = Math.floor(z / ATLAS_CELL);
    const tiles = db
      .prepare(
        "SELECT x,z FROM ml_atlas WHERE layer=? AND x BETWEEN ? AND ? AND z BETWEEN ? AND ? ORDER BY x,z",
      )
      .all(layer.id, cx - 8, cx + 8, cz - 8, cz + 8)
      .map((c) => [c.x, c.z]);
    return { ...progress(actor, layer), changes, tiles };
  }
  function enter(actor, value, plaza = false) {
    const layer = layerOf(value),
      at = now();
    const offset = parseInt(hash(actor.id).slice(0, 6), 16) % 8;
    let spawn = PLAZA_SPAWN;
    for (let n = 0; n < 8; n++) {
      const slot = (offset + n) % 8;
      const candidate = {
        x: 10.5 + (slot % 4) * 2,
        y: 15,
        z: slot < 4 ? -1.5 : 1.5,
      };
      const taken = db
        .prepare(
          "SELECT 1 FROM ml_explorers WHERE layer=? AND player_id<>? AND seen_at>=? AND ABS(x-?)<1.2 AND ABS(z-?)<1.2 LIMIT 1",
        )
        .get(layer.id, actor.id, at - 15_000, candidate.x, candidate.z);
      if (!taken) {
        spawn = candidate;
        break;
      }
    }
    db.prepare(
      "INSERT OR IGNORE INTO ml_explorers(layer,player_id,x,y,z,seen_at) VALUES(?,?,?,?,?,?)",
    ).run(layer.id, actor.id, spawn.x, spawn.y, spawn.z, at);
    if (plaza)
      db.prepare(
        "UPDATE ml_explorers SET x=?,y=?,z=?,seen_at=? WHERE layer=? AND player_id=?",
      ).run(spawn.x, spawn.y, spawn.z, at, layer.id, actor.id);
    const row = actorRow(actor, layer);
    db.prepare(
      "UPDATE ml_explorers SET seen_at=? WHERE layer=? AND player_id=?",
    ).run(at, layer.id, actor.id);
    db.prepare("INSERT OR IGNORE INTO ml_atlas VALUES(?,?,?)").run(
      layer.id,
      Math.floor(row.x / ATLAS_CELL),
      Math.floor(row.z / ATLAS_CELL),
    );
    return {
      spawn: { x: row.x, y: row.y, z: row.z },
      ...snapshot(actor, layer.id, row.x, row.z),
    };
  }
  function move(actor, value, position) {
    const layer = layerOf(value),
      row = actorRow(actor, layer),
      at = now();
    const { x, y, z } = position;
    assert(
      [x, y, z].every(Number.isFinite) &&
        Math.abs(x) <= 1e6 &&
        Math.abs(z) <= 1e6 &&
        y >= 0 &&
        y <= HEIGHT + 4,
      "Invalid position.",
    );
    const seconds = Math.max(0.2, Math.min(2, (at - row.seen_at) / 1000));
    const corrected =
      Math.hypot(x - row.x, z - row.z) > 12 * seconds + 2 ||
      Math.abs(y - row.y) > 14 * seconds + 2;
    let blocked = false;
    for (const ox of [-0.29, 0.29])
      for (const oz of [-0.29, 0.29])
        for (const oy of [0.01, 1.7])
          if (
            readBlock(
              layer,
              Math.floor(x + ox),
              Math.floor(y + oy),
              Math.floor(z + oz),
            ) !== BLOCK.air
          )
            blocked = true;
    if (corrected || blocked)
      return {
        corrected: { x: row.x, y: row.y, z: row.z },
        ...progress(actor, layer),
      };
    return atomic(db, () => {
      db.prepare(
        "UPDATE ml_explorers SET x=?,y=?,z=?,seen_at=? WHERE layer=? AND player_id=?",
      ).run(x, y, z, at, layer.id, actor.id);
      const tile = [Math.floor(x / ATLAS_CELL), Math.floor(z / ATLAS_CELL)];
      const revealed = db.prepare("INSERT OR IGNORE INTO ml_atlas VALUES(?,?,?)").run(layer.id, ...tile);
      if (revealed.changes) activity.record(actor, layer, `tile:${tile}`, "atlas-revealed", { tile });
      story.visit(actor, layer, { x, y, z });
      const mine = MINES[0];
      if (
        Math.hypot(x - mine.entranceX, z - mine.entranceZ) <= 8 &&
        Math.abs(y - 15) < 4
      )
        if (!row.discovered_at) {
          db.prepare("UPDATE ml_explorers SET discovered_at=? WHERE layer=? AND player_id=?").run(at, layer.id, actor.id);
          activity.record(actor, layer, "hollow-found", "hollow-found", { site: mine.id });
        }
      return { corrected: null, ...progress(actor, layer) };
    });
  }
  function once(actor, layer, input, kind, run) {
    assert(
      typeof input.requestId === "string" &&
        /^[A-Za-z0-9_-]{16,80}$/.test(input.requestId),
      "Invalid request ID.",
    );
    const digest = hash(JSON.stringify([kind, input]));
    return atomic(db, () => {
      const saved = db
        .prepare(
          "SELECT digest,result FROM ml_receipts WHERE layer=? AND player_id=? AND request_id=?",
        )
        .get(layer.id, actor.id, input.requestId);
      if (saved) {
        assert(
          saved.digest === digest,
          "Request ID already used for a different action.",
          409,
        );
        return JSON.parse(saved.result);
      }
      const result = run();
      db.prepare("INSERT INTO ml_receipts VALUES(?,?,?,?,?)").run(
        layer.id,
        actor.id,
        input.requestId,
        digest,
        JSON.stringify(result),
      );
      return result;
    });
  }
  function startQuest(actor, input) {
    const layer = layerOf(input.layer);
    nearActor(actor, layer);
    return atomic(db, () => {
      const row = actorRow(actor, layer);
      db.prepare("UPDATE ml_explorers SET started_at=COALESCE(started_at,?) WHERE layer=? AND player_id=?")
        .run(now(), layer.id, actor.id);
      if (!row.started_at) activity.record(actor, layer, "expedition-started", "expedition-started", {});
      return progress(actor, layer);
    });
  }
  function edit(actor, input) {
    const layer = layerOf(input.layer),
      target = coordinates(input);
    assert(
      PLACEABLE.has(input.block) || input.block === BLOCK.air,
      "That block cannot be placed.",
    );
    assert(Number.isInteger(input.expected), "Expected block is required.");
    return once(actor, layer, input, "edit", () => {
      const pose = nearActor(actor, layer);
      assert(
        inPlaza(target.x, target.z) &&
          !protectedPlaza(target.x, target.z) &&
          target.y > PLAZA.y &&
          target.y < 40,
        "Build on the green areas of the public square.",
        403,
      );
      assert(
        Math.hypot(
          target.x + 0.5 - pose.x,
          target.y + 0.5 - pose.y - 1.4,
          target.z + 0.5 - pose.z,
        ) <= 6,
        "Move closer to that block.",
        403,
      );
      assert(
        readBlock(layer, target.x, target.y, target.z) === input.expected,
        "That block changed. Try again.",
        409,
      );
      assert(
        input.block === BLOCK.air ||
          target.x + 1 <= pose.x - 0.3 ||
          target.x >= pose.x + 0.3 ||
          target.z + 1 <= pose.z - 0.3 ||
          target.z >= pose.z + 0.3 ||
          target.y + 1 <= pose.y ||
          target.y >= pose.y + 1.8,
        "You are standing there.",
        409,
      );
      assert(input.block === BLOCK.air || !occupied(layer, target.x, target.y, target.z),
        "Another explorer is standing there.", 409);
      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM ml_blocks WHERE layer=? AND renew_at IS NULL",
        )
        .get(layer.id).n;
      assert(
        count < 8192 || blockRow.get(layer.id, target.x, target.y, target.z),
        "The public square is full. Remove a block first.",
        409,
      );
      db.prepare(
        "INSERT INTO ml_blocks VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(layer,x,y,z) DO UPDATE SET block=excluded.block,renew_at=NULL,author=excluded.author",
      ).run(layer.id, target.x, target.y, target.z, input.block, actor.id);
      activity.record(actor, layer, input.requestId, input.block === BLOCK.air ? "block-removed" : "block-changed", { x: target.x, y: target.y, z: target.z, block: input.block });
      return {
        changes: [[target.x, target.y, target.z, input.block]],
        ...progress(actor, layer),
      };
    });
  }
  function startMining(actor, input) {
    const layer = layerOf(input.layer),
      target = coordinates(input);
    const pose = nearActor(actor, layer),
      block = readBlock(layer, target.x, target.y, target.z);
    assert(
      breakable(layer.seed, target.x, target.y, target.z, block),
      "Use the pickaxe on natural stone or diamond ore in a mine.",
      409,
    );
    assert(
      clearMiningRay(pose, target, (x, y, z) => readBlock(layer, x, y, z)),
      "Move closer and face an exposed block.",
      403,
    );
    const token = id("dig"),
      durationMs = miningDuration(block);
    db.prepare(
      "INSERT INTO ml_mining VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(layer,player_id) DO UPDATE SET token=excluded.token,x=excluded.x,y=excluded.y,z=excluded.z,block=excluded.block,started_at=excluded.started_at,duration_ms=excluded.duration_ms",
    ).run(
      layer.id,
      actor.id,
      token,
      target.x,
      target.y,
      target.z,
      block,
      now(),
      durationMs,
    );
    return { token, durationMs };
  }
  function finishMining(actor, input) {
    const layer = layerOf(input.layer);
    return once(actor, layer, input, "mine", () => {
      const pose = nearActor(actor, layer),
        at = now();
      const job = db
        .prepare("SELECT * FROM ml_mining WHERE layer=? AND player_id=?")
        .get(layer.id, actor.id);
      assert(
        job && input.token === job.token,
        "Start mining that block again.",
        409,
      );
      assert(
        at >= job.started_at + job.duration_ms,
        "Keep mining until the block breaks.",
        409,
      );
      assert(
        at <= job.started_at + 20_000,
        "That mining attempt expired.",
        409,
      );
      assert(
        readBlock(layer, job.x, job.y, job.z) === job.block,
        "Another explorer mined that block first.",
        409,
      );
      assert(
        clearMiningRay(pose, job, (x, y, z) => readBlock(layer, x, y, z)),
        "Move closer and face an exposed block.",
        403,
      );
      const resource = mineable(layer.seed, job.x, job.y, job.z, job.block);
      const diamond = resource && job.block === DIAMOND_ORE;
      db.prepare(
        "INSERT INTO ml_blocks VALUES(?,?,?,?,?,?,?) ON CONFLICT(layer,x,y,z) DO UPDATE SET block=excluded.block,renew_at=excluded.renew_at,author=excluded.author",
      ).run(
        layer.id,
        job.x,
        job.y,
        job.z,
        BLOCK.air,
        diamond ? at + ORE_RENEW_MS : null,
        actor.id,
      );
      db.prepare(
        "UPDATE ml_explorers SET diamonds=diamonds+?,stone=stone+?,quest_diamonds=quest_diamonds+CASE WHEN started_at IS NOT NULL AND discovered_at IS NOT NULL AND completed_at IS NULL THEN ? ELSE 0 END WHERE layer=? AND player_id=?",
      ).run(
        diamond ? 1 : 0,
        resource && !diamond ? 1 : 0,
        diamond ? 1 : 0,
        layer.id,
        actor.id,
      );
      db.prepare(
        "UPDATE ml_explorers SET completed_at=COALESCE(completed_at,?) WHERE layer=? AND player_id=? AND quest_diamonds>=?",
      ).run(at, layer.id, actor.id, DIAMOND_GOAL);
      db.prepare("DELETE FROM ml_mining WHERE layer=? AND player_id=?").run(
        layer.id,
        actor.id,
      );
      const result = progress(actor, layer);
      activity.record(actor, layer, input.requestId, resource ? "resource-mined" : "block-removed",
        { x: job.x, y: job.y, z: job.z, block: job.block, inventory: result.inventory, quest: result.quest });
      return {
        changes: [[job.x, job.y, job.z, BLOCK.air]],
        ...progress(actor, layer),
      };
    });
  }
  function interact(actor, input) {
    const layer = layerOf(input.layer);
    return once(actor, layer, input, "story", () => {
      const pose = nearActor(actor, layer), changes = [];
      if (input.action === "build-marker") {
        assert(story.state(actor, layer, pose).stage === "marker", "Follow the current chapter first.", 409);
        assert(Math.hypot(pose.x - MARKER.x, pose.z - MARKER.z) <= 6, "Move closer to the signal station.", 403);
        for (const b of MARKER.blocks) {
          const previous = readBlock(layer, b.x, b.y, b.z);
          assert(previous === BLOCK.air || previous === BLOCK[b.material], "The marker site has changed. Clear it before placing the template.", 409);
          assert(!occupied(layer, b.x, b.y, b.z), "Another explorer is standing there.", 409);
          db.prepare("INSERT INTO ml_blocks VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(layer,x,y,z) DO UPDATE SET block=excluded.block,renew_at=NULL,author=excluded.author")
            .run(layer.id, b.x, b.y, b.z, BLOCK[b.material], actor.id);
          changes.push([b.x,b.y,b.z,BLOCK[b.material]]);
        }
        activity.record(actor, layer, input.requestId, "marker-built", { changes });
      }
      story.interact(actor, layer, pose, actorRow(actor, layer), { ...input, action: input.action === "build-marker" ? "marker" : input.action });
      return { ...progress(actor, layer), changes };
    });
  }
  return { enter, move, snapshot, startQuest, edit, startMining, finishMining, interact,
    activity: (actor, value) => activity.list(actor, layerOf(value)),
    verifyAction: (actor, input) => activity.verify(actor, layerOf(input.layer), input),
  };
}
