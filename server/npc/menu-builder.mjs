// Registers the NPC offer menu with the actors encounter hook
// (server/actors/menu.mjs). Imported for its side effect by server/index.mjs.
import { registerMenuBuilder } from "../actors/menu.mjs";
import { worldView } from "../world.mjs";
import { levelFor } from "../domain.mjs";
import { buildMenu } from "./offers.mjs";
import { personaFor } from "./personas.mjs";
import { createNpcStore } from "./store.mjs";
import { playerStakerAccess } from "../staker-gates.mjs";

export function npcMenu({ actor, def, player, world, now = Date.now(), db }) {
  const persona = personaFor({ ...def, ...actor, persona: def?.persona ?? actor?.persona });
  // The encounter may hand over a world id or a view; quest lines need the
  // player's own view (completions, tier, open places).
  const view = typeof world === "string" ? worldView(db, world, player, { now }) : world?.quests ? world : world?.id ? worldView(db, world.id, player, { now }) : null;
  if (!view) return [];
  const rows = createNpcStore(db).offersFor(player, actor.id);
  const today = rows.filter((r) => r.terms.worldId === view.id);
  const level = levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
  return buildMenu({
    actor: { ...actor, archetype: actor.archetype || def?.archetype },
    persona,
    world: view,
    now,
    done: new Set(today.map((r) => r.terms.offerId)),
    linesToday: today.filter((r) => r.kind === "quest").length,
    chapters: rows.filter((r) => r.kind === "chapter" && r.state === "completed").length,
    level,
    access: playerStakerAccess(db, player, { worldTier: view.playerTier, level }),
  });
}

registerMenuBuilder("npc", npcMenu);
