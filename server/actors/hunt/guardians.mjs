// Guardian-locked zone chests (docs/NPC-PLAN.md §13.1, slice M3). While a
// guardian monster is on duty at a zone, that zone's chest opens only for a
// player who beat that guardian today. Outside the guardian's hours (or when
// actors are off) the chest is open as before, so a chest is never stuck.
import { assert } from "../../domain.mjs";
import { positionAt } from "../schedule.mjs";

/**
 * guardianFor(actorService, manifest, zoneId, now) -> instance | null
 * The guardian standing at this zone right now, if any.
 */
export function guardianFor(actorService, manifest, zoneId, now) {
  const plan = actorService?.planFor?.(manifest);
  if (!plan || !zoneId) return null;
  return (
    plan.instances.find(
      (i) => i.def.archetype === "guardian" && i.guards?.zoneId === zoneId && positionAt(i.segments, now),
    ) || null
  );
}

export function createChestGuard(db, actorService, { clock = Date.now } = {}) {
  const beaten = db.prepare("SELECT defeats FROM actor_progress WHERE player_id=? AND actor_id=? AND day_id=?");
  const questRow = db.prepare(
    "SELECT q.kind,q.zone_id,w.manifest FROM quests q JOIN worlds w ON w.id=q.world_id WHERE q.id=?",
  );

  /** Status of a zone chest for a player: null when unguarded. */
  function status(player, manifest, zoneId, now = clock()) {
    const g = guardianFor(actorService, manifest, zoneId, now);
    if (!g) return null;
    const defeated = (beaten.get(player || "", g.id, manifest.day)?.defeats || 0) > 0;
    return { actorId: g.id, name: g.def.name, model: g.def.model, defeated };
  }

  /** Throws 423 GUARDED when a chest quest's guardian still stands. */
  function assertOpen(player, questId, now = clock()) {
    if (!actorService || typeof questId !== "string") return;
    const q = questRow.get(questId);
    if (q?.kind !== "chest") return;
    // An already opened chest replays its result; never lock that.
    if (db.prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=?").get(questId, player || "")) return;
    // A newcomer's first chest is never guarded: the first-steps coach sends
    // them to the nearest chest, and in the city demo every zone chest has a
    // guardian on duty, so the first session would stop at "Beat it first".
    const openedChest = db
      .prepare(
        "SELECT 1 FROM quest_claims c JOIN quests q ON q.id=c.quest_id WHERE c.player_id=? AND q.kind='chest' LIMIT 1",
      )
      .get(player || "");
    if (!openedChest) return;
    const s = status(player, JSON.parse(q.manifest), q.zone_id, now);
    assert(
      !s || s.defeated,
      `${s?.name} guards this chest. Beat it first, then open the chest.`,
      423,
      "GUARDED",
    );
  }

  return { status, assertOpen };
}
