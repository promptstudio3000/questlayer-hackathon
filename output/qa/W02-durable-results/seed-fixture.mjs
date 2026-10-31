import assert from 'node:assert/strict';
import { openDatabase } from '../../../server/database.mjs';
import { ensureWorld, HOME } from '../../../server/world.mjs';
import { claimQuest } from '../../../server/game.mjs';
import { createAdventureResults } from '../../../server/adventure-results.mjs';
const path = process.argv[2];
assert(path?.startsWith('/private/tmp/questlayer-results-qa.'), 'Use a dedicated temporary result QA database.');
const db = openDatabase(path);
try {
  const player = db.prepare("SELECT id FROM players WHERE name='River explorer'").get();
  assert(player, 'Create the synthetic River explorer through the local UI first.');
  const now = Date.now();
  const world = await ensureWorld(db, HOME, true, now);
  const quest = db.prepare("SELECT * FROM quests WHERE world_id=? AND kind='chest' AND tier=1 AND opens_at<=? AND closes_at>? ORDER BY id LIMIT 1").get(world.id, now, now);
  assert(quest, 'The current arena must contain an open free chest for this QA run.');
  const result = claimQuest(db, player.id, quest.id, {lat:quest.lat,lng:quest.lng,accuracy:0,timestamp:now}, now);
  const counts = () => ({
    claims:db.prepare('SELECT COUNT(*) AS n FROM quest_claims WHERE player_id=?').get(player.id).n,
    receipts:db.prepare('SELECT COUNT(*) AS n FROM adventure_results WHERE player_id=?').get(player.id).n,
    xp:db.prepare('SELECT xp FROM players WHERE id=?').get(player.id).xp,
    auras:db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE player_id=? AND kind='aura'").get(player.id).n,
  });
  const before=counts();
  const retry=claimQuest(db, player.id, quest.id, null, now + 1);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.id, result.result.id);
  assert.deepEqual(counts(), before);
  assert.equal(createAdventureResults(db).get(player.id, result.result.id).viewedAt, null);
  console.log(JSON.stringify({fixture:'Isolated synthetic actor; official demo arena chest, simulated evidence; the result is committed without delivery to the browser', result:result.result, duplicateRetryUnchanged:before},null,2));
} finally {db.close();}
