// Registers the NPC offer menu with the actors encounter hook
// (server/actors/menu.mjs). Imported for its side effect by server/index.mjs.
import { registerMenuBuilder } from "../actors/menu.mjs";
import { worldView } from "../world.mjs";
import { levelFor } from "../domain.mjs";
import { buildMenu } from "./offers.mjs";
import { personaFor } from "./personas.mjs";
import { createNpcStore } from "./store.mjs";
import { playerStakerAccess } from "../staker-gates.mjs";
import { npcMenuCounts } from "./patron-path.mjs";

export function npcMenu({ actor, def, player, world, now = Date.now(), db }) {
  const persona = personaFor({ ...def, ...actor, persona: def?.persona ?? actor?.persona });
  // The encounter may hand over a world id or a view; quest lines need the
  // player's own view (completions, tier, open places).
  const view = typeof world === "string" ? worldView(db, world, player, { now }) : world?.quests ? world : world?.id ? worldView(db, world.id, player, { now }) : null;
  if (!view) return [];
  const rows = createNpcStore(db).offersFor(player, actor.id);
  const level = levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
  return buildMenu({
    actor: { ...actor, archetype: actor.archetype || def?.archetype },
    persona,
    world: view,
    now,
    ...npcMenuCounts(db, player, rows, view.id),
    level,
    access: playerStakerAccess(db, player, { worldTier: view.playerTier, level }),
  });
}

registerMenuBuilder("npc", npcMenu);
