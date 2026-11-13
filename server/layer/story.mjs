// Story progression and reconstruction events are isolated from native money,
// XP, badges and NFT ownership. A journal entry never claims a chain reward.
import { assert } from "../domain.mjs";
import { ensureModuleVersion, registerModuleSchema } from "../schema-compatibility.mjs";
import { BASALT_GOAL, MARKER, SIGNAL_SITES, STORY_SEED } from "./story-world.mjs";
import { BLOCK } from "./world.mjs";

export const STORY_SCHEMA = registerModuleSchema({
  name: "metalayer-story", version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS ml_story(
 layer TEXT NOT NULL, player_id TEXT NOT NULL REFERENCES players(id),
 quarry_at INTEGER, signals TEXT NOT NULL DEFAULT '[]', marker_at INTEGER,
 finished_at INTEGER, PRIMARY KEY(layer,player_id)
);
CREATE TABLE IF NOT EXISTS ml_story_world(
 layer TEXT PRIMARY KEY, lit_at INTEGER
);
`,
});

export function createStoryStore(db, { now, readBlock, record }) {
  ensureModuleVersion(db, STORY_SCHEMA);
  function row(actor, layer) {
    db.prepare("INSERT OR IGNORE INTO ml_story(layer,player_id) VALUES(?,?)").run(layer.id, actor.id);
    return db.prepare("SELECT * FROM ml_story WHERE layer=? AND player_id=?").get(layer.id, actor.id);
  }
  function state(actor, layer, explorer) {
    const r = row(actor, layer), signals = JSON.parse(r.signals);
    const stage = !explorer.completed_at ? "expedition" : !r.quarry_at || explorer.stone < BASALT_GOAL
      ? "quarry" : signals.length < SIGNAL_SITES.length ? "signals" : !r.marker_at
        ? "marker" : !r.finished_at ? "beacon" : "complete";
    return {
      seed: STORY_SEED, stage, signals, quarry: !!r.quarry_at,
      basalt: Math.min(BASALT_GOAL, explorer.stone), basaltGoal: BASALT_GOAL,
      marker: !!r.marker_at, finishedAt: r.finished_at,
      sharedBeaconLit: !!db.prepare("SELECT lit_at FROM ml_story_world WHERE layer=?").get(layer.id)?.lit_at,
      markerReady: MARKER.blocks.every(b => readBlock(layer, b.x, b.y, b.z) === BLOCK[b.material]),
    };
  }
  function visit(actor, layer, pose) {
    const r = row(actor, layer);
    if (!r.quarry_at && Math.hypot(pose.x - 53, pose.z + 16) <= 8 && Math.abs(pose.y - 15) < 4) {
      db.prepare("UPDATE ml_story SET quarry_at=? WHERE layer=? AND player_id=?").run(now(), layer.id, actor.id);
      record(actor, layer, "quarry-found", "quarry-found", { site: "basalt-quarry" });
    }
  }
  function interact(actor, layer, pose, explorer, input) {
    const s = state(actor, layer, explorer);
    const near = (x, z) => assert(Math.hypot(pose.x - x, pose.z - z) <= 6 && Math.abs(pose.y - 15) < 4,
      "Move closer to the signal station.", 403);
    if (input.action === "signal") {
      assert(s.stage === "signals", "Follow the current chapter first.", 409);
      const site = SIGNAL_SITES[s.signals.length];
      assert(input.site === site.id, "Read the next signal in your journal.", 409);
      near(site.x, site.z);
      assert(input.symbol === site.symbol, "That symbol does not match the inscription. Read the clue and try again.", 409);
      const signals = [...s.signals, site.id];
      db.prepare("UPDATE ml_story SET signals=? WHERE layer=? AND player_id=?").run(JSON.stringify(signals), layer.id, actor.id);
      record(actor, layer, `signal:${site.id}`, "signal-tuned", { site: site.id, symbol: site.symbol });
    } else if (input.action === "marker") {
      assert(s.stage === "marker", "Follow the current chapter first.", 409);
      near(MARKER.x, MARKER.z);
      assert(s.markerReady, "Build two spore stalk blocks with a lamp on top at the marked site.", 409);
      db.prepare("UPDATE ml_story SET marker_at=? WHERE layer=? AND player_id=?").run(now(), layer.id, actor.id);
      record(actor, layer, "marker-checked", "marker-checked", { blocks: MARKER.blocks });
    } else {
      assert(input.action === "beacon" && s.stage === "beacon", "Follow the current chapter first.", 409);
      near(0, 0);
      assert(explorer.diamonds >= 10, "Bring your expedition diamonds to the beacon.", 409);
      db.prepare("UPDATE ml_story SET finished_at=? WHERE layer=? AND player_id=?").run(now(), layer.id, actor.id);
      db.prepare("INSERT INTO ml_story_world(layer,lit_at) VALUES(?,?) ON CONFLICT(layer) DO NOTHING").run(layer.id, now());
      record(actor, layer, "beacon-restored", "beacon-restored", { seed: STORY_SEED });
    }
    return state(actor, layer, explorer);
  }
  return { state, visit, interact };
}
