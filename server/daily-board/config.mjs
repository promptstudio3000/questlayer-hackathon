// Daily board settings (docs/DAILY-BOARD.md). Every default can be changed in
// the runtime environment without a code change, because the owner may still
// tune the board:
//   DAILY_BOARD=0|1            off / on (default on, except on mainnet: off)
//   DAILY_BOARD_GOALS          preferred goals, "kind:target,…" (default coins:10,monster:1,npc:1)
//   DAILY_BOARD_FALLBACK       used when a preferred goal can't be played today
//                              (for example monsters are off), default finds:2,quest:1,coins:20
//   DAILY_BOARD_SIZE           goals on the board, 1–5 (default 3)
//   DAILY_BOARD_BONUS_XP       XP for finishing every goal, 0–1000 (default 50)
// There is deliberately no streak and no penalty (rule D29).
export const GOAL_KINDS = Object.freeze(["coins", "finds", "quest", "monster", "npc", "boss"]);
export const DEFAULT_GOALS = "coins:10,monster:1,npc:1";
export const DEFAULT_FALLBACK = "finds:2,quest:1,coins:20";
export const DEFAULT_SIZE = 3;
export const DEFAULT_BONUS_XP = 50;

function goals(text, name) {
  const out = [];
  for (const part of String(text).split(",").map((x) => x.trim()).filter(Boolean)) {
    const [kind, raw = "1"] = part.split(":").map((x) => x.trim());
    const target = Number(raw);
    if (!GOAL_KINDS.includes(kind)) throw new Error(`${name}: unknown goal "${kind}" (use ${GOAL_KINDS.join(", ")}).`);
    if (!Number.isSafeInteger(target) || target < 1 || target > 500) throw new Error(`${name}: target for ${kind} must be 1–500.`);
    if (!out.some((g) => g.kind === kind)) out.push({ kind, target });
  }
  return out;
}

function int(value, fallback, min, max, name) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be ${min}–${max}.`);
  return n;
}

export function dailyBoardSettings(env = process.env, network = "testnet") {
  const flag = env.DAILY_BOARD;
  if (flag !== undefined && !["", "0", "1"].includes(flag)) throw new Error("DAILY_BOARD must be 0 or 1.");
  const enabled = flag === "1" || ((flag === undefined || flag === "") && network !== "mainnet");
  const preferred = goals(env.DAILY_BOARD_GOALS || DEFAULT_GOALS, "DAILY_BOARD_GOALS");
  const fallback = goals(env.DAILY_BOARD_FALLBACK || DEFAULT_FALLBACK, "DAILY_BOARD_FALLBACK");
  const size = int(env.DAILY_BOARD_SIZE, DEFAULT_SIZE, 1, 5, "DAILY_BOARD_SIZE");
  const bonusXp = int(env.DAILY_BOARD_BONUS_XP, DEFAULT_BONUS_XP, 0, 1000, "DAILY_BOARD_BONUS_XP");
  if (!preferred.length) throw new Error("DAILY_BOARD_GOALS needs at least one goal.");
  return Object.freeze({ enabled, goals: preferred, fallback, size, bonusXp });
}
