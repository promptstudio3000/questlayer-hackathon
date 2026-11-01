// Light stance duel, our own design. Three rounds; each round the player picks
// Strike, Guard or Trick (Strike breaks Trick, Trick slips past Guard, Guard
// stops Strike) and taps a closing ring. The monster's three stances are fixed
// by the seed before round one and published as a hash commitment, revealed at
// the end. Power comes only from account level and the timed tap; Auras and
// items never enter this file.
import { seededRandom, sha256 } from "./rng.mjs";

export const STANCES = ["strike", "guard", "trick"];
export const BEATS = { strike: "trick", trick: "guard", guard: "strike" };
export const DUEL_ROUNDS = 3;
export const PLAYER_HP = 100;
export const LEVEL_CAP = 20; // levels past this add nothing, so veterans can't one-shot everything
export const TAP_WINDOW_MS = 260; // offset at which the tap skill reaches zero
export const TAP_FLOOR_MS = 35; // offsets below this count as this: no superhuman bonus

export const MONSTER_STATS = {
  roamer: { hp: 50, attack: 26, tendency: "strike" },
  guardian: { hp: 62, attack: 30, tendency: "guard" },
  lurker: { hp: 42, attack: 24, tendency: "trick" },
};

export function playerPower(level) {
  const l = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(level) || 1)));
  return 20 + 2 * (l - 1);
}

export function tapSkill(offsetMs) {
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) return 0;
  const off = Math.max(TAP_FLOOR_MS, Math.abs(offsetMs));
  return Math.max(0, Math.round((1 - off / TAP_WINDOW_MS) * 100) / 100);
}

export function createDuel(seed, { archetype, tendency } = {}) {
  const stats = MONSTER_STATS[archetype] || MONSTER_STATS.roamer;
  const lean = STANCES.includes(tendency) ? tendency : stats.tendency;
  const rng = seededRandom(`${seed}:duel`);
  const picks = [];
  const targets = [];
  for (let i = 0; i < DUEL_ROUNDS; i++) {
    const r = rng.random();
    // Half the time the published tendency, otherwise either other stance.
    const others = STANCES.filter((s) => s !== lean);
    picks.push(r < 0.5 ? lean : r < 0.75 ? others[0] : others[1]);
    targets.push(Math.round(rng.range(700, 1300))); // ring closes at this ms
  }
  const salt = sha256(`${seed}:duel-salt`).slice(0, 16);
  return {
    kind: "duel",
    tendency: lean,
    monsterHp: stats.hp,
    attack: stats.attack,
    picks,
    targets,
    salt,
    commitment: sha256(`${picks.join(",")}:${salt}`),
  };
}

// Resolve one round. state: { round, playerHp, monsterHp, log }.
export function duelRound(duel, state, { stance, tapOffsetMs }, level) {
  if (!STANCES.includes(stance)) throw new RangeError("stance");
  if (state.round >= DUEL_ROUNDS) throw new RangeError("finished");
  const monster = duel.picks[state.round];
  const skill = tapSkill(tapOffsetMs);
  const power = playerPower(level);
  let dealt = 0;
  let taken = 0;
  let outcome;
  if (BEATS[stance] === monster) {
    outcome = "win";
    dealt = Math.round(power * (1 + 0.5 * skill));
  } else if (BEATS[monster] === stance) {
    outcome = "lose";
    taken = Math.round(duel.attack * (1 - 0.4 * skill)); // a clean tap softens the blow
  } else {
    outcome = "clash";
    dealt = Math.round(power * 0.5 * (1 + 0.5 * skill));
    taken = Math.round(duel.attack * 0.5);
  }
  const next = {
    round: state.round + 1,
    playerHp: Math.max(0, state.playerHp - taken),
    monsterHp: Math.max(0, state.monsterHp - dealt),
    log: [...state.log, { stance, monster, outcome, skill, dealt, taken }],
  };
  return next;
}

export function duelStart(duel) {
  return { round: 0, playerHp: PLAYER_HP, monsterHp: duel.monsterHp, log: [] };
}

export function duelOver(state) {
  return state.round >= DUEL_ROUNDS || state.playerHp <= 0 || state.monsterHp <= 0;
}

// Win by knocking the monster out within three rounds. Reading its tendency
// and tapping cleanly matters at every level; levels make the margin wider.
export function duelVerdict(duel, state) {
  const won = state.monsterHp <= 0 && state.playerHp > 0;
  return {
    won,
    score: duel.monsterHp - state.monsterHp,
    max: duel.monsterHp,
    reveal: { picks: duel.picks, salt: duel.salt, commitment: duel.commitment },
  };
}
