// Monster hunt wiring (docs/NPC-PLAN.md §13, slices M3 + M4) on top of the
// shared actor service (§14) and the challenge service (M1/M2):
//   - rewards for challenge wins (XP, shards, roll tickets) and crafting,
//   - guardian-locked zone chests,
//   - the weekly co-op boss with its Great Portal arena.
// Returns null when actors are off, so the routes answer 503.
import { registerMenuBuilder } from "../menu.mjs";
import { registerActorDecorator } from "../service.mjs";
import { createHuntRewards } from "./rewards.mjs";
import { createChestGuard } from "./guardians.mjs";
import { createBossService } from "./boss.mjs";

export const BOSS_ARENA_MODEL = "great-portal";
export const CRAFT_ALTAR_MODEL = "golden-altar";

export function createMonsterHunt(db, actorService, { levelOf, now = () => Date.now(), bossHp, secret, altarFees = false } = {}) {
  if (!actorService) return null;
  const rewards = createHuntRewards(db, { now, altarFees });
  const chests = createChestGuard(db, actorService, { clock: now });
  const cityOf = (worldId) => {
    const row = db.prepare("SELECT manifest FROM worlds WHERE id=?").get(worldId);
    return row ? JSON.parse(row.manifest).cityId : null;
  };
  const boss = createBossService(db, {
    encounters: {
      async requireEncounter(args) {
        const enc = await actorService.requireEncounter(args);
        return { ...enc, cityId: enc.cityId || cityOf(enc.worldId) };
      },
    },
    levelOf,
    rewards,
    now,
    secret,
    ...(Number.isSafeInteger(bossHp) && bossHp > 0 ? { maxHp: bossHp } : {}),
  });

  // The boss menu: one "strike" offer while the weekly event is still active.
  registerMenuBuilder("boss", ({ actor, player, world, dayId, expiresAt }) => {
    const ev = boss.event(world.cityId, dayId, actor.id, player);
    if (ev.state !== "active") return [];
    return [
      {
        id: "boss-hit",
        kind: "challenge",
        label: `Strike ${actor.name}`,
        terms: { format: "boss-hit", eventId: ev.id },
        expiresAt,
      },
    ];
  });

  // Boss views carry the shared HP pool and the Great Portal arena at its home.
  registerActorDecorator((view, { instance, player, dayId, cityId }) => {
    if (view.archetype !== "boss" || !cityId) return null;
    const ev = boss.event(cityId, dayId, view.id, player);
    return {
      boss: { hp: ev.hp, maxHp: ev.maxHp, weekId: ev.weekId, participants: ev.participants, state: ev.state },
      arena: { model: BOSS_ARENA_MODEL, lat: instance.home.lat, lng: instance.home.lng },
      ...(ev.state === "defeated" ? { state: "defeated" } : {}),
    };
  });

  return {
    rewards,
    chests,
    boss,
    onChallengeResult: (result) => rewards.onChallengeResult(result),
  };
}
