// Monster challenge service (NPC-PLAN §13.2, slices M1 + M2). A player who
// holds a valid encounter token for a monster starts one challenge: a quiz, a
// mini-game or a stance duel. The server derives a secret seed, keeps the
// answers, replays the player's inputs and decides the outcome. The client is
// never trusted to say "I won".
//
// Dependencies are injected so the service stays testable and builds on the
// shared actor interfaces (§14) without owning their tables:
//   encounters.requireEncounter({ token, player, actorId })
//     -> { encounterId, actor: ActorView, def, dayId, cityId?, placeName? }
//   levelOf(player) -> account level (account-bound XP only)
//   store: cooldowns, defeats and audit rows (store.mjs: actor_progress and
//     actor_challenges in production, memory in unit tests)
//   onResult(result): hook for rewards (slice M3)
import { randomBytes } from "node:crypto";
import { deriveSeed, sha256 } from "./rng.mjs";
import { memoryChallengeStore } from "./store.mjs";
import { createQuiz, quizView, scoreQuiz, loadQuizBank, QUIZ_QUESTIONS, QUIZ_SECONDS_PER_QUESTION, QUIZ_PASS } from "./quiz.mjs";
import { MINIGAMES, createMinigame, scoreMinigame, minimumPlayMs } from "./minigames.mjs";
import { createDuel, duelStart, duelRound, duelOver, duelVerdict, STANCES, MONSTER_STATS, playerPower } from "./duel.mjs";

export const FORMATS = ["quiz", ...MINIGAMES, "duel"];
export const ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const NETWORK_SLACK_MS = 400;

class ChallengeError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const check = (ok, message, status = 400, code = "CHALLENGE") => {
  if (!ok) throw new ChallengeError(message, status, code);
};

// Which formats a monster offers. Every monster offers the quiz and the duel;
// the mini-game is picked per monster per day so the map feels varied.
export function formatsFor(actor, dayId) {
  const pick = parseInt(sha256(`${actor.id}:${dayId}:minigame`).slice(0, 8), 16) % MINIGAMES.length;
  return ["quiz", MINIGAMES[pick], "duel"];
}

export function createChallengeService({
  secret = randomBytes(32).toString("hex"),
  encounters,
  levelOf,
  store = memoryChallengeStore(),
  bank = loadQuizBank(),
  now = () => Date.now(),
  onResult = () => {},
} = {}) {
  if (!encounters?.requireEncounter) throw new Error("Monster challenges need the actor encounter service.");
  if (typeof levelOf !== "function") throw new Error("Monster challenges need levelOf(player).");
  const active = new Map(); // challenge id -> record

  const sweep = (t) => {
    for (const [id, c] of active) if (c.expiresAt < t || c.state !== "open") active.delete(id);
  };

  function statusFor(player, actor, dayId) {
    const t = now();
    if (store.defeated(player, actor.id, dayId)) return { state: "defeated" };
    const until = store.cooldownUntil(player, actor.id);
    if (until != null && t < until) return { state: "cooldown", retryAt: until };
    return { state: "active" };
  }

  function owned(player, actorId, challengeId) {
    const c = active.get(challengeId);
    check(c && c.player === player && c.actorId === actorId, "This challenge is not yours or no longer exists.", 404, "CHALLENGE_NOT_FOUND");
    check(c.state === "open", "This challenge is already finished.", 409, "CHALLENGE_FINISHED");
    check(now() <= c.expiresAt, "The monster lost interest. Start a new encounter later.", 410, "CHALLENGE_EXPIRED");
    return c;
  }

  function finish(c, verdict) {
    c.state = "done";
    active.delete(c.id);
    const result = {
      challengeId: c.id,
      actorId: c.actorId,
      archetype: c.archetype,
      format: c.format,
      outcome: verdict.won ? "won" : "lost",
      score: verdict.score,
      max: verdict.max,
      dayId: c.dayId,
      finishedAt: now(),
      seedCommitment: c.seedCommitment,
    };
    store.recordOutcome(c.player, c.actorId, c.dayId, verdict.won, result.finishedAt);
    store.closeChallenge(c.id, verdict.won, { ...result, reason: verdict.reason }, result.finishedAt);
    try {
      onResult({ ...result, player: c.player });
    } catch {
      // Reward hooks must never turn a verified result into an error.
    }
    return { result, detail: verdict, retryAt: verdict.won ? undefined : c.startedAt + ATTEMPT_COOLDOWN_MS };
  }

  const LABELS = { quiz: "Answer its riddles", rhythm: "Match its rhythm", trace: "Trace its rune path", memory: "Repeat its rune song", duel: "Duel it" };

  // Offer[] for the §14 encounter menu (kind "challenge").
  function offers(player, actor, dayId, expiresAt) {
    if (actor?.kind !== "monster" || !MONSTER_STATS[actor.archetype]) return [];
    const status = statusFor(player, actor, dayId);
    if (status.state !== "active") return [];
    return formatsFor(actor, dayId).map((format) => ({
      id: `challenge-${format}`,
      kind: "challenge",
      label: LABELS[format],
      terms: { format },
      expiresAt,
    }));
  }

  return {
    formatsFor,
    offers,

    async menu({ player, actorId, encounter }) {
      check(player, "Sign in to challenge monsters.", 401, "AUTH");
      const enc = await encounters.requireEncounter({ token: encounter, player, actorId });
      const actor = enc.actor;
      check(actor?.kind === "monster", "Only monsters can be challenged.", 400, "NOT_A_MONSTER");
      const stats = MONSTER_STATS[actor.archetype];
      return {
        actorId: actor.id,
        status: statusFor(player, actor, enc.dayId),
        formats: stats ? formatsFor(actor, enc.dayId) : [],
        tendency: stats ? actor.tendency || stats.tendency : undefined,
        level: levelOf(player),
        offers: offers(player, actor, enc.dayId, enc.expiresAt),
      };
    },

    // Status for an ActorView: defeated today, on cooldown or ready.
    status: (player, actor, dayId) => statusFor(player, actor, dayId),

    async start({ player, actorId, encounter, format }) {
      check(player, "Sign in to challenge monsters.", 401, "AUTH");
      const enc = await encounters.requireEncounter({ token: encounter, player, actorId });
      const actor = enc.actor;
      check(actor?.kind === "monster", "Only monsters can be challenged.", 400, "NOT_A_MONSTER");
      check(MONSTER_STATS[actor.archetype], "This monster is fought in a shared boss event, not a duel.", 400, "BOSS_EVENT");
      const offered = formatsFor(actor, enc.dayId);
      check(offered.includes(format), "This monster does not offer that challenge today.", 400, "FORMAT");
      const status = statusFor(player, actor, enc.dayId);
      check(status.state !== "defeated", "You already beat this monster today.", 409, "ALREADY_DEFEATED");
      check(status.state !== "cooldown", "This monster is still wary of you. Try again later.", 429, "COOLDOWN");
      const t = now();
      sweep(t);
      for (const c of active.values())
        check(c.player !== player, "Finish your current challenge first.", 409, "CHALLENGE_ACTIVE");
      // Starting counts as the attempt, so walking away and retrying gains nothing.
      store.recordAttempt(player, actor.id, enc.dayId, t, t + ATTEMPT_COOLDOWN_MS);
      const id = `chl_${randomBytes(12).toString("base64url")}`;
      const seed = deriveSeed(secret, player, actor.id, enc.dayId, id);
      const c = {
        id,
        player,
        encounterId: enc.encounterId,
        actorId: actor.id,
        archetype: actor.archetype,
        format,
        dayId: enc.dayId,
        seedCommitment: sha256(seed),
        startedAt: t,
        expiresAt: t + CHALLENGE_TTL_MS,
        state: "open",
      };
      let view;
      if (format === "quiz") {
        c.plan = createQuiz(bank, { seed, cityId: enc.cityId, placeName: enc.placeName });
        view = { questions: quizView(bank, c.plan), secondsPerQuestion: QUIZ_SECONDS_PER_QUESTION, pass: QUIZ_PASS };
      } else if (format === "duel") {
        c.duel = createDuel(seed, { archetype: actor.archetype, tendency: actor.tendency });
        c.level = levelOf(player);
        c.fight = duelStart(c.duel);
        c.roundOpenedAt = t;
        view = {
          tendency: c.duel.tendency,
          monsterHp: c.duel.monsterHp,
          playerHp: c.fight.playerHp,
          power: playerPower(c.level),
          level: c.level,
          rounds: c.duel.targets.length,
          ringMs: c.duel.targets[0],
          commitment: c.duel.commitment,
        };
      } else {
        c.game = createMinigame(format, seed);
        const { kind, ...rest } = c.game;
        view = rest;
      }
      store.openChallenge({ ...c, seed });
      active.set(id, c);
      return { challenge: { id, actorId: actor.id, format, expiresAt: c.expiresAt, seedCommitment: c.seedCommitment, ...view } };
    },

    // Quiz and mini-games: one submit with the raw inputs.
    submit({ player, actorId, challengeId, input }) {
      const c = owned(player, actorId, challengeId);
      check(c.format !== "duel", "Duels are played round by round.", 400, "FORMAT");
      const elapsed = now() - c.startedAt;
      if (c.format === "quiz") {
        check(Array.isArray(input?.answers) && input.answers.length <= QUIZ_QUESTIONS, "Send your answers.", 400, "INPUT");
        return finish(c, scoreQuiz(bank, c.plan, input.answers, { elapsedMs: elapsed }));
      }
      // A submit can't arrive before the cues it answers were even shown.
      const verdict =
        elapsed + NETWORK_SLACK_MS < minimumPlayMs(c.game)
          ? { won: false, score: 0, max: 0, reason: "too-fast" }
          : scoreMinigame(c.game, input);
      return finish(c, verdict);
    },

    // Duel: one round per call, the monster's stance is revealed after yours.
    round({ player, actorId, challengeId, stance, tapOffsetMs }) {
      const c = owned(player, actorId, challengeId);
      check(c.format === "duel", "This challenge is not a duel.", 400, "FORMAT");
      check(STANCES.includes(stance), "Pick Strike, Guard or Trick.", 400, "INPUT");
      const t = now();
      const target = c.duel.targets[c.fight.round];
      // The ring starts closing when the round opens; a tap can't land before
      // the ring could have closed by more than the window allows.
      const offset = Number(tapOffsetMs);
      const plausible = Number.isFinite(offset) && t - c.roundOpenedAt + NETWORK_SLACK_MS >= target + Math.min(0, offset);
      c.fight = duelRound(c.duel, c.fight, { stance, tapOffsetMs: plausible ? offset : NaN }, c.level);
      c.roundOpenedAt = t;
      const last = c.fight.log.at(-1);
      const out = {
        round: c.fight.round,
        playerHp: c.fight.playerHp,
        monsterHp: c.fight.monsterHp,
        last,
        ringMs: c.duel.targets[c.fight.round],
      };
      if (!duelOver(c.fight)) return { duel: out };
      return { duel: out, ...finish(c, duelVerdict(c.duel, c.fight)) };
    },
  };
}

export { ChallengeError };
