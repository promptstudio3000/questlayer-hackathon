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
import { MAX_PATRON_LINES_PER_DAY, PATRON_PATH_LINES, patronEditionLive, patronGateKey } from "./patron-path.mjs";
import { checkGate, defaultStakerGates, stakerAccess } from "../staker-gates.mjs";

export const NPC_OFFER_POLICY = "npc-offers-v1";
export const LINE_XP_PER_STEP = 20;
export const LINE_BONUS_XP = 10;
export const CHAPTER_XP = 15;
export const STORY_SET_SIZE = 3;
export const MAX_LINES_PER_DAY = 2; // per player and NPC
export const MAX_AURAS_PER_NPC_DAY = 40; // every player together
// NPC errands (docs/WORLDS-PLAN.md C.4 `npc-errand`): a quest giver sends the
// player to one of today's POI quests and wants them back to report. The POI
// visit is the ordinary quest claim; the return is a fresh encounter with the
// same NPC after that claim (server/npc/service.mjs complete). XP only.
export const ERRAND_XP = 40;
export const ERRAND_CLUE_BONUS_XP = 10; // the landmark clue was answered right
export const MAX_ERRANDS_PER_DAY = 1; // per player and NPC
export const OFFER_TTL_MS = 15 * 60_000;
const MIN_TIME_LEFT_MS = 30 * 60_000;

// Locked staker chips (docs/GAME-LOOPS.md §5, P0-2): content in Tier 2/3
// zones is shown to every player, greyed, with exactly what is missing. Lines
// open by step AND level (owner decision 1 Nov 23:47, server/data/
// staker-gates.json: t2_lines = Tier 2 + L6, t3_lines = Tier 3 + L6). Lures
// are things to do or wear; a gate never changes odds.
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
const LINE_GATE = { 2: "t2_lines", 3: "t3_lines" };

/** Staker access for menus: the caller's (cached vault status) or the world tier. */
const accessOf = (world, level, access, gates) =>
  access?.step != null ? access : stakerAccess({ tier: playerTierOf(world), level }, gates);

/** Gate of a quest line into a zone of this tier (Tier 1 is always open). */
export function lineGate(zoneTier, access, { gates = defaultStakerGates(), priceEur = null } = {}) {
  const key = LINE_GATE[Math.min(3, zoneTier)];
  if (!key) return { open: true, missing: [] };
  const g = checkGate(key, access, { settings: gates, priceEur });
  // The zone's own tier rule (E16) still applies, whatever the table says.
  if (access.tier < zoneTier && g.open) return { ...g, open: false, missing: [{ kind: "tier", tier: zoneTier, label: `Reach Tier ${zoneTier}` }] };
  return g;
}

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

export function openSteps(world, now, { level = 1, access = null, gates = defaultStakerGates() } = {}) {
  const a = accessOf(world, level, access, gates);
  const open = new Map();
  const isOpen = (t) => {
    if (!open.has(t)) open.set(t, lineGate(t, a, { gates }).open);
    return open.get(t);
  };
  return liveSteps(world, now).filter((q) => q.tier <= a.tier && isOpen(q.tier));
}

/**
 * Locked chips: quest lines and chapters in zones whose line gate is still
 * closed, one per tier, shown greyed with `locked: {tier, step, level,
 * missing, stakeNear}`. They are NOT offers: they never enter the menu, its
 * hash, the model's facts or accept.
 */
export function lockedOffers({
  actor,
  persona,
  world,
  now = Date.now(),
  level = 1,
  access = null,
  gates = defaultStakerGates(),
  priceEur = null,
  patronDone = 0,
}) {
  const archetype = actor?.archetype || persona?.archetype;
  if (!world || !actor || (archetype !== "quest_giver" && archetype !== "storyteller")) return [];
  const a = accessOf(world, level, access, gates);
  const quest = archetype === "quest_giver";
  // The next Patron's Path step, greyed with exactly what is missing.
  const pathGate = checkGate(patronGateKey(patronDone), a, { settings: gates, priceEur });
  const pathChip =
    !pathGate.open && liveSteps(world, now).length
      ? [
          {
            id: `locked:${hash(`${actor.id}|${world.id}|patron-path`).slice(0, 16)}`,
            kind: "patron_path",
            label: `Patron's Path, step ${Math.min(patronDone + 1, PATRON_PATH_LINES)} of ${PATRON_PATH_LINES}: ${quest ? "a patron walk" : "a patron chapter"}`,
            perk: "A patron story chapter and XP; the last step earns the patron Aura",
            locked: {
              step: pathGate.need?.step || "staker",
              level: pathGate.need?.level || 1,
              missing: pathGate.missing.map((m) => m.label),
              stakeNear: pathGate.stakeNear || gates.minNear,
            },
          },
        ]
      : [];
  const zones = new Map((world.zones || []).map((z) => [z.id, z]));
  const seed = `${actor.id}|${world.id}`;
  const byTier = new Map();
  const gateOf = new Map();
  for (const q of liveSteps(world, now).sort((x, y) => order(seed, x.id) - order(seed, y.id))) {
    if (q.tier < 2 || byTier.has(q.tier)) continue;
    if (!gateOf.has(q.tier)) gateOf.set(q.tier, lineGate(q.tier, a, { gates, priceEur }));
    if (!gateOf.get(q.tier).open) byTier.set(q.tier, q);
  }
  return [
    ...pathChip,
    ...[...byTier.values()]
    .sort((a, b) => a.tier - b.tier)
    .slice(0, MAX_LOCKED_CHIPS)
    .map((q) => {
      const zone = zones.get(q.zone_id)?.name;
      return {
        id: `locked:${hash(`${seed}|${q.id}`).slice(0, 16)}`,
        kind: quest ? "patron_quest" : "patron_chapter",
        label: `${quest ? "Patron walk" : "Patron chapter"}: ${q.title}${zone ? ` in ${zone}` : ""}`.slice(0, 120),
        perk: quest ? "A walk into a patron zone, XP and an Aura" : "A patron chapter in a patron zone, with XP",
        locked: {
          tier: q.tier,
          step: gateOf.get(q.tier).need?.step || `tier${q.tier}`,
          level: gateOf.get(q.tier).need?.level || 1,
          missing: gateOf.get(q.tier).missing.map((m) => m.label),
          stakeNear: gateOf.get(q.tier).stakeNear || gates.minNear,
        },
      };
    }),
  ];
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
export function buildMenu({
  actor,
  persona,
  world,
  now = Date.now(),
  done = new Set(),
  linesToday = 0,
  chapters = 0,
  level = 1,
  access = null,
  gates = defaultStakerGates(),
  patronToday = 0,
  patronDone = 0,
  errandsToday = 0,
}) {
  const archetype = actor?.archetype || persona?.archetype;
  if (!world || !actor) return [];
  const zones = new Map((world.zones || []).map((z) => [z.id, z]));
  const seed = `${actor.id}|${world.id}`;
  const expiresAt = Math.min(now + OFFER_TTL_MS, world.endsAt || Infinity);
  const steps = openSteps(world, now, { level, access, gates }).sort(
    (a, b) =>
      liked(persona, zones.get(b.zone_id)) - liked(persona, zones.get(a.zone_id)) ||
      order(seed, a.id) - order(seed, b.id),
  );
  const offers = [];
  // Patron's Path (P1-1): its first step opens at patron_chapter_1, the rest
  // at patron_line (server/data/staker-gates.json, step AND level).
  const pathAccess = accessOf(world, level, access, gates);
  const patronOpen =
    patronToday < MAX_PATRON_LINES_PER_DAY && checkGate(patronGateKey(patronDone), pathAccess, { settings: gates }).open;
  // Patron stops lead into the highest zone tier the player may enter.
  const topTier = Math.max(1, ...steps.map((q) => Math.min(q.tier, zones.get(q.zone_id)?.tier || 1)));
  const inTop = (q) => Math.min(q.tier, zones.get(q.zone_id)?.tier || 1) === topTier;
  if (archetype === "quest_giver") {
    const used = new Set();
    // Patron walk: two stops ending in the highest zone tier open to the
    // player. Same XP formula as any line; the lure is the walk, the patron
    // story chapter and, at the path's end, the patron edition.
    const target = patronOpen && steps.find(inTop);
    if (target) {
      const lead =
        steps.find((q) => q.id !== target.id && q.zone_id !== target.zone_id && inTop(q)) ||
        steps.find((q) => q.id !== target.id && q.zone_id !== target.zone_id);
      const line = lead ? [lead, target] : [target];
      const offerId = `quest:${hash(`${seed}|patron|${line.map((q) => q.id).join(",")}`).slice(0, 16)}`;
      line.forEach((q) => used.add(q.id));
      if (!done.has(offerId)) {
        const where = line.map((q) => `${q.title}${zones.get(q.zone_id) ? ` in ${zones.get(q.zone_id).name}` : ""}`);
        const pathLine = Math.min(patronDone + 1, PATRON_PATH_LINES);
        offers.push({
          id: offerId,
          kind: "quest",
          label: `Patron walk: ${where.join(", then ")}`.slice(0, 120),
          terms: {
            steps: line.map((q) => stepView(q, zones)),
            xp: LINE_XP_PER_STEP * line.length + LINE_BONUS_XP,
            aura: true,
            zoneTier: Math.max(...line.map((q) => zones.get(q.zone_id)?.tier || 1)),
            patron: true,
            pathLine,
            pathOf: PATRON_PATH_LINES,
            pathEnds: patronDone + 1 === PATRON_PATH_LINES && patronEditionLive(),
          },
          expiresAt,
        });
      }
    }
    // Errand: one POI quest of today (a landmark clue first), then back here.
    const errand =
      errandsToday < MAX_ERRANDS_PER_DAY &&
      steps
        .filter((q) => !used.has(q.id) && q.kind !== "route" && zones.get(q.zone_id)?.source === "poi")
        .sort((a, b) => Number(!!b.clue) - Number(!!a.clue) || order(seed, a.id) - order(seed, b.id))[0];
    if (errand) {
      const zone = zones.get(errand.zone_id);
      const offerId = `quest:${hash(`${seed}|errand|${errand.id}`).slice(0, 16)}`;
      used.add(errand.id);
      if (!done.has(offerId))
        offers.push({
          id: offerId,
          kind: "quest",
          label: `Errand: ${errand.clue ? "find out about" : "check on"} ${zone.name} and come back`.slice(0, 120),
          terms: {
            steps: [stepView(errand, zones)],
            xp: ERRAND_XP,
            aura: false,
            zoneTier: zone.tier || 1,
            errand: {
              poiId: zone.poi?.ids?.[0] || null,
              category: zone.poi?.category || null,
              clue: !!errand.clue,
              clueBonusXp: errand.clue ? ERRAND_CLUE_BONUS_XP : 0,
              returnRequired: true,
            },
          },
          expiresAt,
        });
    }
    // L7 unlock (server/data/level-table.json): one more line per NPC and day.
    if (linesToday >= MAX_LINES_PER_DAY + extraQuestLines(level)) return offers;
    for (const first of steps) {
      if (offers.filter((o) => !o.terms.patron).length >= 3) break;
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
    // Patron chapter: set in the highest zone tier open to the player. It is
    // a step on the Patron's Path, outside the story sets.
    const scene = patronOpen && steps.find(inTop);
    if (scene) {
      const offerId = `chapter:${hash(`${seed}|patron|${scene.id}`).slice(0, 16)}`;
      if (!done.has(offerId))
        offers.push({
          id: offerId,
          kind: "chapter",
          label: `Patron chapter: ${scene.title}${zones.get(scene.zone_id) ? ` in ${zones.get(scene.zone_id).name}` : ""}`.slice(0, 120),
          terms: {
            steps: [stepView(scene, zones)],
            xp: CHAPTER_XP,
            aura: false,
            zoneTier: zones.get(scene.zone_id)?.tier || 1,
            patron: true,
            pathLine: Math.min(patronDone + 1, PATRON_PATH_LINES),
            pathOf: PATRON_PATH_LINES,
            pathEnds: patronDone + 1 === PATRON_PATH_LINES && patronEditionLive(),
          },
          expiresAt,
        });
    }
    for (const q of steps) {
      // L8 unlock (server/data/level-table.json): one more chapter on offer.
      if (offers.filter((o) => !o.terms.patron).length >= 2 + extraStoryChapters(level)) break;
      if (scene && q.id === scene.id) continue;
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
  trade_buy: "the player sells this Aura to you; both sides settle at once on NEAR Intents",
  trade_sell: "you sell this Aura from your stock; both sides settle at once on NEAR Intents",
  trade_up: "the player hands you three common Auras and receives one rare Aura",
};
function tradeFact(o, index) {
  return { id: `offer-${index}`, text: `Offer ${index}: ${o.label}. Trade: ${TRADE_TEXT[o.kind]}.` };
}

function questFact(o, index) {
  if (o.terms.errand)
    return {
      id: `offer-${index}`,
      text: `Offer ${index}: ${o.label}. An errand: the player walks to that place, does its quest there, then comes back to you and reports. Reward: ${o.terms.xp} XP${
        o.terms.errand.clueBonusXp ? `, plus ${o.terms.errand.clueBonusXp} XP if they answered the place's question right` : ""
      }.`,
    };
  if (o.terms.patron)
    return {
      id: `offer-${index}`,
      text: `Offer ${index}: ${o.label}. A patron ${o.kind === "chapter" ? "chapter" : "walk"} for stakers: ${o.terms.xp} XP${
        o.terms.aura ? " and one Aura you are entitled to" : ""
      }, and step ${o.terms.pathLine} of ${o.terms.pathOf} on the Patron's Path, which reveals a patron story chapter${
        o.terms.pathEnds ? " and finishes the path with the patron edition Aura" : ""
      }. It does not change any luck or payout.`,
    };
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
