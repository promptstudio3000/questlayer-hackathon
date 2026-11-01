// NPC rules engine (N2): the offer menu an NPC may present, computed from the
// player's live world BEFORE any model is called. The model can only point at
// one of these entries by index; it never creates, changes or prices an offer
// (docs/NPC-PLAN.md §1, §5.5).
//
// Quest lines reuse today's discoveries: a line is 1–2 open discoveries the
// player can do now. Completion is proven by the ordinary quest claims
// (quest_claims rows written after the line was accepted), so no new location
// proof exists here. Rewards are XP plus, for quest-giver lines, one demo Aura
// chosen by the chest entitlement rules; the player secures it on NEAR through
// the existing award-signed `redeem_aura` claim.
import { hash } from "../domain.mjs";
import { extraQuestLines, extraStoryChapters } from "../levels.mjs";

export const NPC_OFFER_POLICY = "npc-offers-v1";
export const LINE_XP_PER_STEP = 20;
export const LINE_BONUS_XP = 10;
export const CHAPTER_XP = 15;
export const STORY_SET_SIZE = 3;
export const MAX_LINES_PER_DAY = 2; // per player and NPC
export const MAX_AURAS_PER_NPC_DAY = 40; // every player together
export const OFFER_TTL_MS = 15 * 60_000;
const MIN_TIME_LEFT_MS = 30 * 60_000;

// Locked staker chips (docs/GAME-LOOPS.md §5, P0-2): content in Tier 2/3
// zones is shown to every player, greyed with its tier, and becomes usable when
// the player's stake matures into that tier (owner decision 1 Nov: tier only,
// no level gate). Lures are things to do or wear; a gate never changes odds.
export const MAX_LOCKED_CHIPS = 2;

// Shape families each persona "likes" map onto (persona.likes are prose).
const LIKE_FAMILIES = [
  [/park|garden|sady|meadow/i, ["garden", "park"]],
  [/river|bank|water/i, ["river", "water", "waterfront"]],
  [/church|landmark|monument|square/i, ["landmark", "square", "plaza", "church"]],
];

function liked(persona, zone) {
  const families = LIKE_FAMILIES.filter(([re]) => (persona?.likes || []).some((l) => re.test(l))).flatMap(
    ([, f]) => f,
  );
  return zone && families.includes(zone.shapeFamily) ? 1 : 0;
}

// Stable pseudo-random order per actor and day, so the same player sees the
// same menu on every encounter of that day (no re-roll farming).
const order = (seed, key) => parseInt(hash(`${seed}|${key}`).slice(0, 8), 16);

const playerTierOf = (world) => (Number.isInteger(world?.playerTier) ? world.playerTier : 1);

function liveSteps(world, now) {
  if (!world || world.operatorPause) return [];
  const zones = new Map((world.zones || []).map((z) => [z.id, z]));
  return (world.quests || []).filter(
    (q) =>
      !q.completed &&
      q.placeStatus !== "closed" &&
      zones.has(q.zone_id) &&
      q.opens_at <= now &&
      q.closes_at > now + MIN_TIME_LEFT_MS,
  );
}

export function openSteps(world, now) {
  const tier = playerTierOf(world);
  return liveSteps(world, now).filter((q) => q.tier <= tier);
}

/**
 * Locked chips: quest lines and chapters in zones above the player's tier,
 * one per tier, shown greyed with `locked: {tier}`. They are NOT offers: they
 * never enter the menu, its hash, the model's facts or accept.
 */
export function lockedOffers({ actor, persona, world, now = Date.now() }) {
  const archetype = actor?.archetype || persona?.archetype;
  if (!world || !actor || (archetype !== "quest_giver" && archetype !== "storyteller")) return [];
  const tier = playerTierOf(world);
  const zones = new Map((world.zones || []).map((z) => [z.id, z]));
  const seed = `${actor.id}|${world.id}`;
  const byTier = new Map();
  for (const q of liveSteps(world, now).sort((a, b) => order(seed, a.id) - order(seed, b.id)))
    if (q.tier > tier && !byTier.has(q.tier)) byTier.set(q.tier, q);
  return [...byTier.values()]
    .sort((a, b) => a.tier - b.tier)
    .slice(0, MAX_LOCKED_CHIPS)
    .map((q) => {
      const zone = zones.get(q.zone_id)?.name;
      const quest = archetype === "quest_giver";
      return {
        id: `locked:${hash(`${seed}|${q.id}`).slice(0, 16)}`,
        kind: quest ? "patron_quest" : "patron_chapter",
        label: `${quest ? "Patron walk" : "Patron chapter"}: ${q.title}${zone ? ` in ${zone}` : ""}`.slice(0, 120),
        perk: quest ? "A walk into a patron zone, XP and an Aura" : "A patron chapter in a patron zone, with XP",
        locked: { tier: q.tier },
      };
    });
}

const stepView = (q, zones) => ({
  questId: q.id,
  title: q.title,
  kind: q.kind,
  tier: q.tier,
  zone: zones.get(q.zone_id)?.name || null,
  lat: q.lat,
  lng: q.lng,
});

/**
 * Menu for one NPC and player. `done` is the set of offer ids this player
 * already accepted from this NPC today; `chapters` is the player's finished
 * chapter count with this storyteller (for the story Aura at the set's end).
 */
export function buildMenu({ actor, persona, world, now = Date.now(), done = new Set(), linesToday = 0, chapters = 0, level = 1 }) {
  const archetype = actor?.archetype || persona?.archetype;
  if (!world || !actor) return [];
  const zones = new Map((world.zones || []).map((z) => [z.id, z]));
  const seed = `${actor.id}|${world.id}`;
  const expiresAt = Math.min(now + OFFER_TTL_MS, world.endsAt || Infinity);
  const steps = openSteps(world, now).sort(
    (a, b) =>
      liked(persona, zones.get(b.zone_id)) - liked(persona, zones.get(a.zone_id)) ||
      order(seed, a.id) - order(seed, b.id),
  );
  const offers = [];
  if (archetype === "quest_giver") {
    // L7 unlock (server/data/level-table.json): one more line per NPC and day.
    if (linesToday >= MAX_LINES_PER_DAY + extraQuestLines(level)) return [];
    const used = new Set();
    for (const first of steps) {
      if (offers.length >= 3) break;
      if (used.has(first.id)) continue;
      // Second stop in another zone when possible, so a line is a real walk.
      const second =
        steps.find((q) => !used.has(q.id) && q.id !== first.id && q.zone_id !== first.zone_id) ||
        steps.find((q) => !used.has(q.id) && q.id !== first.id);
      const line = second ? [first, second] : [first];
      const offerId = `quest:${hash(`${seed}|${line.map((q) => q.id).join(",")}`).slice(0, 16)}`;
      line.forEach((q) => used.add(q.id));
      if (done.has(offerId)) continue;
      const xp = LINE_XP_PER_STEP * line.length + LINE_BONUS_XP;
      const where = line.map((q) => `${q.title}${zones.get(q.zone_id) ? ` in ${zones.get(q.zone_id).name}` : ""}`);
      offers.push({
        id: offerId,
        kind: "quest",
        label: `Walk: ${where.join(", then ")}`.slice(0, 120),
        terms: {
          steps: line.map((q) => stepView(q, zones)),
          xp,
          aura: true,
          zoneTier: Math.max(...line.map((q) => zones.get(q.zone_id)?.tier || 1)),
        },
        expiresAt,
      });
    }
  } else if (archetype === "storyteller") {
    for (const q of steps) {
      // L8 unlock (server/data/level-table.json): one more chapter on offer.
      if (offers.length >= 2 + extraStoryChapters(level)) break;
      const offerId = `chapter:${hash(`${seed}|${q.id}`).slice(0, 16)}`;
      if (done.has(offerId)) continue;
      const finishesSet = (chapters + 1) % STORY_SET_SIZE === 0;
      offers.push({
        id: offerId,
        kind: "chapter",
        label: `Chapter: ${q.title}${zones.get(q.zone_id) ? ` in ${zones.get(q.zone_id).name}` : ""}`.slice(0, 120),
        terms: {
          steps: [stepView(q, zones)],
          xp: CHAPTER_XP,
          aura: finishesSet,
          chapter: chapters + 1,
          zoneTier: zones.get(q.zone_id)?.tier || 1,
        },
        expiresAt,
      });
    }
  }
  // Trader offers come from server/npc/trader.mjs (registered as the
  // "trader" menu builder); keepers only explain; wandering rares arrive in N4.
  return offers;
}

export const menuHash = (menu) =>
  hash(JSON.stringify(menu.map((o) => ({ id: o.id, kind: o.kind, terms: o.terms }))));

// One short grounded fact per offer, so the model can describe it and every
// number it uses is checkable.
export function offerFacts(menu) {
  return menu.map((o, index) =>
    o.kind.startsWith("trade_") ? tradeFact(o, index) : questFact(o, index),
  );
}

// Trader offers (N3, server/npc/trader.mjs): every number is already in the label.
const TRADE_TEXT = {
  trade_buy: "the player sells this Aura to you; they fill your signed buy order on the market",
  trade_sell: "you sell this Aura from your stock; the player fills your signed sell order on the market",
  trade_up: "the player hands you three common Auras and receives one rare Aura",
};
function tradeFact(o, index) {
  return { id: `offer-${index}`, text: `Offer ${index}: ${o.label}. Trade: ${TRADE_TEXT[o.kind]}.` };
}

function questFact(o, index) {
  return ({
    id: `offer-${index}`,
    text: `Offer ${index}: ${o.label}. Reward: ${o.terms.xp} XP${
      o.terms.aura
        ? o.kind === "chapter"
          ? " and a story Aura for finishing the chapter set"
          : " and one Aura you are entitled to"
        : ""
    }.${o.kind === "chapter" ? ` This is chapter ${o.terms.chapter} of ${STORY_SET_SIZE}.` : ""}`,
  });
}
