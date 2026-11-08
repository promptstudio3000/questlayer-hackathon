// Isolated acceptance, never the running game's state or financial activation.
import { readFileSync } from 'node:fs';
import { openDatabase, createPlayer } from '../database.mjs';
import { installGlobalActivityDay } from '../global-activities.mjs';
import { worldView } from '../world.mjs';
import { claimQuest } from '../game.mjs';
import { requireValue } from './canonical.mjs';
export function verifyPreparedActivities(manifestFile) {
  const manifest = JSON.parse(readFileSync(manifestFile)), db = openDatabase(':memory:');
  try {
    const treasury = () => JSON.stringify(db.prepare('SELECT * FROM treasury ORDER BY bucket').all());
    const before = treasury();
    const status = installGlobalActivityDay(db, manifestFile);
    const now = manifest.epoch.startsAt + 12 * 3600000;
    let visits = 0, zones = 0;
    for (const row of db.prepare('SELECT id,manifest FROM worlds').all()) {
      const player = createPlayer(db, 'Collector acceptance', now), view = worldView(db, row.id, player, { now });
      requireValue(view.globalPreparation?.financialActivation === false, 'Unexpected financial activation.');
      const world = JSON.parse(row.manifest); zones += world.cityZoneCount;
      for (const zone of world.zones.filter(z => z.source === 'global-geography')) {
        requireValue(zone.geometry?.type === 'Polygon', 'Runtime dropped the real zone polygon.');
        requireValue(view.quests.some(q => q.zone_id === zone.id), 'Zone has no playable objective.');
      }
      const quest = view.quests.find(q => q.kind === 'visit' && world.zones.some(z => z.id === q.zone_id && z.source === 'global-geography')) || view.quests.find(q => q.kind === 'visit');
      if (!quest) continue;
      const fix = { lat: quest.lat, lng: quest.lng, accuracy: 5, timestamp: now };
      let rejected = false; try { claimQuest(db, player, quest.id, { ...fix, lat: fix.lat + .01 }, now); } catch (e) { rejected = /closer|range/i.test(e.message); }
      requireValue(rejected, 'Distant evidence was not rejected.');
      const result = claimQuest(db, player, quest.id, fix, now), replay = claimQuest(db, player, quest.id, fix, now);
      requireValue(result.reward === 0 && result.item === null && replay.replayed === true && replay.result.id === result.result.id, 'Runtime visit/receipt acceptance failed.');
      visits++;
    }
    requireValue(zones === manifest.counts.zone, 'Prepared and runtime zone counts differ.');
    requireValue(treasury() === before, 'Content acceptance changed treasury.');
    return { state: 'passed', regions: manifest.regions.length, zones, visits, status: JSON.parse(JSON.stringify(status)), scope: 'Isolated runtime and simulated GPS; not field/device or financial verification.' };
  } finally { db.close(); }
}
