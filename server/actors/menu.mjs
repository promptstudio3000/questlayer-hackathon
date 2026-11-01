// Offer menu hook for encounters (docs/NPC-PLAN.md §14). Slices register a
// builder per actor kind (or per archetype, which wins); the encounter calls
// it before any model runs, hashes the result and binds the hash to the token.
//
//   registerMenuBuilder("npc", buildMenu)          // N1/N2: server/npc/offers.mjs
//   registerMenuBuilder("guardian", buildGuardian) // archetype override
//
// A builder gets {actor, def, persona, player, world, dayId, now, db} and
// returns Offer[] ({id, kind, label, terms, expiresAt}). It may be async.
import { createHash } from "node:crypto";
import { assert } from "../domain.mjs";

const OFFER_KINDS = new Set([
  "quest",
  "chapter",
  "trade_buy",
  "trade_sell",
  "trade_up",
  "challenge",
  "roll",
]);
const builders = new Map();

export function registerMenuBuilder(key, builder) {
  assert(typeof key === "string" && typeof builder === "function", "Invalid menu builder.");
  builders.set(key, builder);
}

// Monsters always offer a challenge, which M1/M2 resolve.
function defaultMenu({ actor, now, expiresAt }) {
  if (actor.kind !== "monster") return [];
  return [
    {
      id: `challenge:${actor.id}`,
      kind: "challenge",
      label: `Challenge ${actor.name}`,
      terms: { actorId: actor.id },
      expiresAt: expiresAt ?? now + 5 * 60_000,
    },
  ];
}

export async function buildActorMenu(context) {
  const builder =
    builders.get(context.actor.archetype) ||
    builders.get(context.actor.kind) ||
    defaultMenu;
  const menu = (await builder(context)) || [];
  assert(Array.isArray(menu) && menu.length <= 6, "Invalid offer menu.");
  for (const offer of menu)
    assert(
      typeof offer?.id === "string" &&
        offer.id.length <= 120 &&
        OFFER_KINDS.has(offer.kind) &&
        typeof offer.label === "string" &&
        offer.label.length <= 120 &&
        offer.terms &&
        typeof offer.terms === "object" &&
        Number.isFinite(offer.expiresAt),
      "Invalid offer in menu.",
    );
  return menu;
}

export function menuHash(menu) {
  return createHash("sha256").update(JSON.stringify(menu)).digest("hex");
}
