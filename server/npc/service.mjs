// NPC service (N1 talk + N2 quest givers and storytellers). Routes from the
// actors layer call it with an actor (ActorDefinition/ActorView), the
// player's live world view and a verified encounter. The encounter proves the
// player stood next to the NPC (N0 checks GPS, speed and cooldowns); this
// module never sees raw coordinates in a prompt.
import { GameError, assert, hash, levelFor } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { recordChainAction } from "../chain-ledger/service.mjs";
import { mintAura } from "../game.mjs";
import { clean } from "../ai/text-policy.mjs";
import { debugRejected } from "../ai/text-policy.mjs";
import { guideFacts } from "../ai/guide.mjs";
import { personaFor } from "./personas.mjs";
import {
  buildMenu,
  lockedOffers,
  menuHash,
  offerFacts,
  MAX_AURAS_PER_NPC_DAY,
  NPC_OFFER_POLICY,
  STORY_SET_SIZE,
} from "./offers.mjs";
import {
  NPC_TALK_POLICY,
  languageOf,
  npcConfiguration,
  npcProviderFor,
  templateReply,
  validateNpcOutput,
} from "./talk.mjs";
import { createNpcStore } from "./store.mjs";
import { NEAR_AI_VERIFY_URL, createNearAiVerifier } from "../ai/near-ai.mjs";
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../actors/schema.mjs";
import { checkGate, playerStakerAccess } from "../staker-gates.mjs";
import { PILGRIM_LINES, awardEditionOnce, ensureEarnedEditions } from "../earned-editions.mjs";
import { missionFor } from "./agents.mjs";
import { createLoreService, createNearAiLoreProvider, topicOfQuestion } from "./lore.mjs";
import { webSearchFor } from "./lore-web.mjs";
import { PATRON_AURA_GATE, PATRON_EDITION, PATRON_PATH_LINES, completedPatronLines, isPatronRow, npcMenuCounts, patronStoryFor } from "./patron-path.mjs";

const WORLD_FACTS = new Set(["mode", "paused", "zones", "progress", "next", "later", "safety"]);
const rowId = (offerId, player) => `${offerId}@${player}`;

export function npcFacts({ persona, world, menu, level, now }) {
  const facts = [
    { id: "npc", text: `You are ${persona.name}${persona.title ? `, ${persona.title}` : ""}.` },
    { id: "player-level", text: `The player is level ${level}.` },
    ...guideFacts({ world, now }).filter((f) => WORLD_FACTS.has(f.id)),
    ...offerFacts(menu),
  ];
  if (!menu.length)
    facts.push({
      id: "no-offers",
      text:
        persona.archetype === "quest_giver" || persona.archetype === "storyteller"
          ? "You have nothing more to offer this player today."
          : "Your trading, vault or game services are not open yet; you can only chat today.",
    });
  return facts;
}

export function createNpcService(
  db,
  {
    env = process.env,
    config = npcConfiguration(env),
    provider = config.provider === "off" ? null : npcProviderFor(config, env),
    verifier = config.nearAi?.active && config.nearAi.verify ? createNearAiVerifier(config.nearAi) : null,
    clock = Date.now,
    personas,
    priceEur = () => null,
    loreProvider = config.provider === "near-ai" && config.nearAi?.active ? createNearAiLoreProvider(config.nearAi) : null,
    lore = null,
  } = {},
) {
  ensureModuleVersion(db, ACTORS_SCHEMA);
  ensureEarnedEditions(db);
  const store = createNpcStore(db, { clock });
  // Shared memory of what explorers taught the NPCs (server/npc/lore.mjs).
  const memory = lore ?? createLoreService(db, { env, provider: loreProvider, clock, web: webSearchFor(env) });
  const playerLevel = (player) => levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
  const personaOf = (actor) => (personas ? personaFor(actor, personas) : personaFor(actor));

  // `bound` is the menu the encounter token was issued with; when present it
  // is the only menu this conversation may use.
  function context(player, actor, world, bound = null) {
    assert(actor && actor.kind !== "monster", "This character does not talk.", 404, "NPC_UNKNOWN");
    const persona = personaOf(actor);
    const now = clock();
    const rows = store.offersFor(player, actor.id);
    const level = playerLevel(player);
    const access = playerStakerAccess(db, player, { worldTier: world?.playerTier, level });
    const counts = npcMenuCounts(db, player, rows, world?.id);
    const menu = bound ?? buildMenu({ actor, persona, world, now, ...counts, level, access });
    // Locked chips are recomputed every time (never bound to the encounter):
    // they are presentation only and can never be accepted.
    const locked = lockedOffers({ actor, persona, world, now, level, access, priceEur: priceEur(), patronDone: counts.patronDone });
    return { persona, now, rows, menu, locked, level };
  }

  function activeView(rows, world) {
    return rows
      .filter((r) => r.state === "accepted" && r.terms.worldId === world?.id)
      .map((r) => ({
        offerId: r.terms.offerId,
        kind: r.kind,
        label: r.terms.label,
        steps: r.terms.steps.map((s) => ({
          ...s,
          done: !!(world?.quests || []).find((q) => q.id === s.questId && q.completed),
        })),
        xp: r.terms.xp,
        aura: !!r.terms.aura,
        ...(r.terms.errand ? { errand: { returnRequired: true, clueBonusXp: r.terms.errand.clueBonusXp || 0 } } : {}),
        ...(r.terms.patron ? { patron: { pathLine: r.terms.pathLine, pathOf: r.terms.pathOf } } : {}),
      }));
  }

  // Greeting + menu for a fresh encounter (no model call: cheap and instant).
  function greet({ player, actor, world, encounter = null }) {
    const { persona, menu, locked, rows } = context(player, actor, world, encounter?.menu);
    const reply = templateReply(persona, menu, { lang: "en" });
    memory.refreshWeb({ world, actor });
    return {
      npc: { id: actor.id, name: persona.name, title: persona.title || null, archetype: persona.archetype },
      say: reply.say,
      emote: reply.emote,
      menu,
      menuHash: menuHash(menu),
      locked,
      active: activeView(rows, world),
      mission: missionView(player, actor, persona),
      source: "template",
      policy: NPC_TALK_POLICY,
    };
  }

  // The NPC's own question (its agent card); the game UI is English.
  function missionView(player, actor, persona) {
    const m = missionFor(persona);
    const s = memory.status(player, actor.id);
    return { topic: m.topic, ask: m.ask.en, answered: s.answeredHere, xp: s.xp, left: Math.max(0, s.dailyLimit - s.rewardedToday) };
  }

  // The player answers the NPC's mission question.
  async function mission({ player, actor, world, answer }) {
    assert(typeof answer === "string" && answer.trim() && answer.length <= 300, "Say something of up to 300 characters.", 400, "NPC_INPUT");
    assert(actor && actor.kind !== "monster", "This character does not talk.", 404, "NPC_UNKNOWN");
    const persona = personaOf(actor);
    const m = missionFor(persona);
    const result = await memory.answer({ player, actor, persona, mission: m, world, text: answer, lang: languageOf(answer) });
    return { ...result, mission: missionView(player, actor, persona), policy: NPC_TALK_POLICY };
  }

  async function talk({ player, actor, world, message, encounter = null }) {
    assert(
      typeof message === "string" && message.trim() && message.length <= 300,
      "Say something of up to 300 characters.",
      400,
      "NPC_INPUT",
    );
    const text = clean(message);
    const { persona, menu, locked, level, now, rows } = context(player, actor, world, encounter?.menu);
    const own = missionFor(persona);
    const tips = memory.facts({ placeKey: memory.placeKeyFor(world, actor), topic: own.topic, message: text });
    const facts = [...npcFacts({ persona, world, menu, level, now }), ...tips];
    const factsHash = hash(JSON.stringify(facts));
    const mh = menuHash(menu);
    const notes = store.memory(player, actor.id);
    let result = null,
      reason = null,
      outcome = "template",
      used = null;
    if (provider) {
      if (store.talkCount(player, 60_000) >= config.perMinute || store.talkCount(player, 3600_000) >= config.perHour) {
        outcome = "limited";
        reason = "rate-limit";
      } else if (store.providerCallsToday() >= config.dailyCalls) {
        outcome = "limited";
        reason = "daily-budget";
      } else {
        try {
          const res = await provider.reply({ persona, mission: own, facts, menu, memory: notes.notes, message: text });
          used = provider.withMeta ? res : { output: res, source: provider.name, model: provider.model };
          const raw = used.output;
          const checked = validateNpcOutput(raw, facts, menu);
          if (checked.value) {
            result = checked.value;
            outcome = "answered";
          } else {
            reason = checked.reason;
            outcome = "fallback";
            debugRejected(env, "npc", reason, raw);
          }
        } catch (error) {
          reason =
            error.reason ||
            (error instanceof SyntaxError
              ? "unparseable-json"
              : /^provider-[a-z]+( \(\d{3}\))?$/.test(error.message || "")
                ? error.message
                : "provider-unavailable");
          outcome = "fallback";
          debugRejected(env, "npc", reason, error.sample);
        }
      }
    }
    // Without the model, only a question about places gets a tip.
    if (!result)
      result = templateReply(persona, menu, { message: text, lang: languageOf(text), tips: topicOfQuestion(text) ? tips : [] });
    if (result.remember) store.remember(player, actor.id, result.remember);
    const receipt = outcome === "answered" && used?.source === "near-ai" ? used.receipt : null;
    const auditId = store.audit({
      player,
      actor: actor.id,
      provider: used?.source || (provider ? provider.name : "template"),
      model: used?.model || provider?.model,
      outcome,
      reason: reason || used?.primaryReason || null,
      factsHash,
      menuHash: mh,
      outputHash: hash(result.say),
    });
    if (receipt && verifier)
      verifier
        .check(receipt)
        .then((v) => {
          try {
            store.attest(auditId, v);
          } catch {
            // database closed (shutdown or test teardown)
          }
        })
        .catch(() => {});
    return {
      say: result.say,
      emote: result.emote,
      // The suggested offer is the server's own menu entry, never model text.
      offer: result.offer ? menu[result.offer.index] : null,
      menu,
      menuHash: mh,
      locked,
      active: activeView(rows, world),
      source: outcome === "answered" ? used.source : "template",
      attested: false,
      // Private inference: the enclave signature is checked in the background
      // and recorded on the audit row; anyone can re-check the chat id at
      // the NEAR AI Verification Center.
      ...(receipt?.chatId
        ? {
            verification: {
              provider: "near-ai",
              model: receipt.model,
              chatId: receipt.chatId,
              status: verifier ? "pending" : "unchecked",
              url: NEAR_AI_VERIFY_URL,
            },
          }
        : {}),
      policy: NPC_TALK_POLICY,
      ...(reason
        ? { note: reason === "rate-limit" || reason === "daily-budget" ? "Chat limit reached; standard reply." : "Standard reply." }
        : {}),
    };
  }

  function accept({ player, actor, world, encounter = null, offerId }) {
    assert(typeof offerId === "string" && offerId.length <= 80, "Choose an offer.", 400, "NPC_OFFER");
    const id = rowId(offerId, player);
    const prior = store.offer(id, player);
    if (prior && prior.actor_id === actor.id) return { offerId, state: prior.state };
    // The offer must be on the encounter's menu AND still on today's menu
    // (a step finished meanwhile, or the daily cap reached, removes it).
    const { menu } = context(player, actor, world);
    const offer = menu.find((o) => o.id === offerId);
    assert(
      offer && (!encounter?.menu || encounter.menu.some((o) => o.id === offerId)),
      "This offer is no longer available.",
      409,
      "NPC_OFFER_GONE",
    );
    const encounterId = encounter?.encounterId ?? "direct";
    return atomic(db, () => {
      store.insertOffer({
        id,
        actor: actor.id,
        player,
        encounter: encounterId,
        kind: offer.kind,
        terms: { ...offer.terms, offerId, label: offer.label, worldId: world.id, policy: NPC_OFFER_POLICY },
        menuHash: menuHash(menu),
        expiresAt: world.endsAt || offer.expiresAt,
      });
      store.remember(player, actor.id, null, 0);
      return { offerId, state: "accepted" };
    });
  }

  // Turn in a finished line at the NPC. Each step must have a quest claim made
  // after the line was accepted, in the same world (day).
  function complete({ player, actor, world, offerId, encounter = null }) {
    const id = rowId(offerId, player);
    const row = store.offer(id, player);
    assert(row && row.actor_id === actor.id, "You have no such task from this character.", 404, "NPC_OFFER");
    if (row.state === "completed") return { offerId, state: "completed", replay: true };
    assert(row.terms.worldId === world?.id, "This task belonged to an earlier day.", 409, "NPC_OFFER_EXPIRED");
    const claimed = (questId) =>
      db.prepare("SELECT 1 FROM quest_claims WHERE quest_id=? AND player_id=? AND created_at>=?").get(questId, player, row.created_at);
    const missing = row.terms.steps.filter((s) => !claimed(s.questId));
    if (missing.length)
      throw new GameError(`Finish ${missing.map((s) => s.title).join(" and ")} first.`, 409, "NPC_STEPS_LEFT");
    // An errand ends with a return: the player must meet this NPC again after
    // the place's quest was done (a fresh encounter, which checks GPS anew).
    let clueBonus = 0;
    if (row.terms.errand) {
      const doneAt = Math.max(
        ...row.terms.steps.map(
          (s) => db.prepare("SELECT created_at FROM quest_claims WHERE quest_id=? AND player_id=?").get(s.questId, player)?.created_at || 0,
        ),
      );
      const metAt = encounter?.encounterId
        ? db.prepare("SELECT created_at FROM actor_encounters WHERE id=? AND player_id=? AND actor_id=?").get(encounter.encounterId, player, row.actor_id)?.created_at
        : null;
      if (!(metAt > doneAt))
        throw new GameError(
          `Walk back to ${personaOf(actor).name} and meet them again to report.`,
          409,
          "NPC_ERRAND_RETURN",
        );
      if (row.terms.errand.clue && row.terms.errand.clueBonusXp)
        try {
          const right = row.terms.steps.some(
            (s) => db.prepare("SELECT correct FROM landmark_clue_answers WHERE quest_id=? AND player_id=?").get(s.questId, player)?.correct === 1,
          );
          if (right) clueBonus = row.terms.errand.clueBonusXp;
        } catch {
          /* No clue answers stored on this host yet. */
        }
    }
    const now = clock();
    return atomic(db, () => {
      assert(store.completeOffer(id, player) === 1, "This task was already turned in.", 409, "NPC_OFFER");
      const xp = row.terms.xp + clueBonus;
      db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(xp, player);
      let aura = null,
        edition = null;
      // NPC-only editions, once per player: the first finished chapter set
      // pays the Chronicle Crown instead of a chest Aura; the fifth turned-in
      // quest-giver line adds Pilgrim's Path on top of the line's Aura.
      if (row.kind === "chapter" && row.terms.aura)
        edition = awardEditionOnce(db, player, "chronicle", `npc:${actor.id}:${offerId}`, now);
      if (row.terms.aura && !edition) {
        if (store.aurasGrantedToday(actor.id) <= MAX_AURAS_PER_NPC_DAY) {
          aura = mintAura(db, player, now, row.terms.zoneTier || 1, playerLevel(player));
        }
      }
      if (row.kind === "quest" && store.completedQuestLines(player) >= PILGRIM_LINES)
        edition = awardEditionOnce(db, player, "pilgrim", `npc:${actor.id}:${offerId}`, now);
      // Patron's Path (P1-1): each patron line reveals the next patron story
      // chapter; the path's end earns the patron edition once per player. A
      // line finished before the edition existed pays it on the next one.
      let patron = null;
      if (isPatronRow(row)) {
        const step = completedPatronLines(db, player);
        // The edition has its own gate (patron_aura); a player below it keeps
        // the progress and gets the Aura on a later patron line.
        const auraOpen = checkGate(PATRON_AURA_GATE, playerStakerAccess(db, player, { worldTier: world?.playerTier, level: playerLevel(player) })).open;
        const seal = step >= PATRON_PATH_LINES && auraOpen ? awardEditionOnce(db, player, PATRON_EDITION, `npc:${actor.id}:${offerId}`, now) : null;
        if (seal && !edition) edition = seal;
        patron = { pathLine: Math.min(step, PATRON_PATH_LINES), pathOf: PATRON_PATH_LINES, story: patronStoryFor(step), edition: seal };
      }
      store.remember(player, actor.id, null, 1);
      const chain = recordChainAction(db, {
        player,
        kind: "errand",
        xp,
        at: Number.isFinite(actor.lat) && Number.isFinite(actor.lng) ? { lat: actor.lat, lng: actor.lng } : null,
        ref: offerId,
        evidence: { actor: actor.id, offerId, kind: row.kind },
        now,
      });
      history(db, player, "npc-quest", `Task from ${personaOf(actor).name}`, 0, {
        actor: actor.id,
        offerId,
        xp,
        aura: aura?.name || null,
        edition: edition?.name || null,
        ...(patron ? { patron: patron.pathLine } : {}),
        policy: NPC_OFFER_POLICY,
      });
      return {
        offerId,
        state: "completed",
        xp,
        aura,
        ...(chain ? { chain } : {}),
        ...(edition ? { edition } : {}),
        ...(patron ? { patron } : {}),
        ...(row.terms.aura && !aura && !edition ? { note: "No Aura edition you are entitled to has supply left today; the XP still counts." } : {}),
        ...(row.kind === "chapter" ? { chapter: row.terms.chapter, setSize: STORY_SET_SIZE } : {}),
        ...(row.terms.errand ? { errand: { clueBonusXp: clueBonus } } : {}),
      };
    });
  }

  return {
    provider: provider ? provider.name : "template",
    attestation: (auditId) => store.attestation(auditId),
    greet,
    talk,
    mission,
    lore: memory,
    accept,
    complete,
    active: ({ player, actor, world }) => activeView(store.offersFor(player, actor.id), world),
    // The player's open lines in one world, for the map: which NPC is waiting
    // for a report (every step done) and which places still need a visit.
    // Information only: turning in still needs a fresh encounter.
    tasks: ({ player, world }) =>
      store
        .acceptedFor(player)
        .filter((r) => r.terms.worldId === world?.id)
        .map((r) => {
          const [view] = activeView([r], world);
          return {
            actorId: r.actor_id,
            ...view,
            ready: view.steps.length > 0 && view.steps.every((s) => s.done),
          };
        }),
  };
}
