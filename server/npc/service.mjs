// NPC service (N1 talk + N2 quest givers and storytellers). Routes from the
// actors layer call it with an actor (ActorDefinition/ActorView), the
// player's live world view and a verified encounter. The encounter proves the
// player stood next to the NPC (N0 checks GPS, speed and cooldowns); this
// module never sees raw coordinates in a prompt.
import { GameError, assert, hash, levelFor } from "../domain.mjs";
import { atomic, history } from "../database.mjs";
import { mintAura } from "../game.mjs";
import { clean } from "../ai/text-policy.mjs";
import { debugRejected } from "../ai/text-policy.mjs";
import { guideFacts } from "../ai/guide.mjs";
import { personaFor } from "./personas.mjs";
import {
  buildMenu,
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
import { ensureModuleVersion } from "../schema-compatibility.mjs";
import { ACTORS_SCHEMA } from "../actors/schema.mjs";
import { PILGRIM_LINES, awardEditionOnce, ensureEarnedEditions } from "../earned-editions.mjs";

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
    clock = Date.now,
    personas,
  } = {},
) {
  ensureModuleVersion(db, ACTORS_SCHEMA);
  ensureEarnedEditions(db);
  const store = createNpcStore(db, { clock });
  const playerLevel = (player) => levelFor(db.prepare("SELECT xp FROM players WHERE id=?").get(player)?.xp || 0);
  const personaOf = (actor) => (personas ? personaFor(actor, personas) : personaFor(actor));

  // `bound` is the menu the encounter token was issued with; when present it
  // is the only menu this conversation may use.
  function context(player, actor, world, bound = null) {
    assert(actor && actor.kind !== "monster", "This character does not talk.", 404, "NPC_UNKNOWN");
    const persona = personaOf(actor);
    const now = clock();
    const rows = store.offersFor(player, actor.id);
    const today = rows.filter((r) => r.terms.worldId === world?.id);
    const menu = bound ?? buildMenu({
      actor,
      persona,
      world,
      now,
      done: new Set(today.map((r) => r.terms.offerId)),
      linesToday: today.filter((r) => r.kind === "quest").length,
      chapters: rows.filter((r) => r.kind === "chapter" && r.state === "completed").length,
    });
    return { persona, now, rows, menu, level: playerLevel(player) };
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
      }));
  }

  // Greeting + menu for a fresh encounter (no model call: cheap and instant).
  function greet({ player, actor, world, encounter = null }) {
    const { persona, menu, rows } = context(player, actor, world, encounter?.menu);
    const reply = templateReply(persona, menu, { lang: "cs" });
    return {
      npc: { id: actor.id, name: persona.name, title: persona.title || null, archetype: persona.archetype },
      say: reply.say,
      emote: reply.emote,
      menu,
      menuHash: menuHash(menu),
      active: activeView(rows, world),
      source: "template",
      policy: NPC_TALK_POLICY,
    };
  }

  async function talk({ player, actor, world, message, encounter = null }) {
    assert(
      typeof message === "string" && message.trim() && message.length <= 300,
      "Say something of up to 300 characters.",
      400,
      "NPC_INPUT",
    );
    const text = clean(message);
    const { persona, menu, level, now, rows } = context(player, actor, world, encounter?.menu);
    const facts = npcFacts({ persona, world, menu, level, now });
    const factsHash = hash(JSON.stringify(facts));
    const mh = menuHash(menu);
    const memory = store.memory(player, actor.id);
    let result = null,
      reason = null,
      outcome = "template";
    if (provider) {
      if (store.talkCount(player, 60_000) >= config.perMinute || store.talkCount(player, 3600_000) >= config.perHour) {
        outcome = "limited";
        reason = "rate-limit";
      } else if (store.providerCallsToday() >= config.dailyCalls) {
        outcome = "limited";
        reason = "daily-budget";
      } else {
        try {
          const raw = await provider.reply({ persona, facts, menu, memory: memory.notes, message: text });
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
    if (!result) result = templateReply(persona, menu, { message: text, lang: languageOf(text) });
    if (result.remember) store.remember(player, actor.id, result.remember);
    store.audit({
      player,
      actor: actor.id,
      provider: provider ? provider.name : "template",
      model: provider?.model,
      outcome,
      reason,
      factsHash,
      menuHash: mh,
      outputHash: hash(result.say),
    });
    return {
      say: result.say,
      emote: result.emote,
      // The suggested offer is the server's own menu entry, never model text.
      offer: result.offer ? menu[result.offer.index] : null,
      menu,
      menuHash: mh,
      active: activeView(rows, world),
      source: outcome === "answered" ? provider.name : "template",
      attested: false,
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
  function complete({ player, actor, world, offerId }) {
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
    const now = clock();
    return atomic(db, () => {
      assert(store.completeOffer(id, player) === 1, "This task was already turned in.", 409, "NPC_OFFER");
      const xp = row.terms.xp;
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
      store.remember(player, actor.id, null, 1);
      history(db, player, "npc-quest", `Task from ${personaOf(actor).name}`, 0, {
        actor: actor.id,
        offerId,
        xp,
        aura: aura?.name || null,
        edition: edition?.name || null,
        policy: NPC_OFFER_POLICY,
      });
      return {
        offerId,
        state: "completed",
        xp,
        aura,
        ...(edition ? { edition } : {}),
        ...(row.terms.aura && !aura && !edition ? { note: "No Aura edition you are entitled to has supply left today; the XP still counts." } : {}),
        ...(row.kind === "chapter" ? { chapter: row.terms.chapter, setSize: STORY_SET_SIZE } : {}),
      };
    });
  }

  return {
    provider: provider ? provider.name : "template",
    greet,
    talk,
    accept,
    complete,
    active: ({ player, actor, world }) => activeView(store.offersFor(player, actor.id), world),
  };
}
