// Hackathon season settings (docs/SEASON.md, docs/GAME-LOOPS.md P1-3). Every
// default can be changed in the runtime environment without a code change:
//   SEASON=0|1                 off / on (default on, except on mainnet: off)
//   SEASON_ID                  stable id, never reuse (default hackathon-2026)
//   SEASON_NAME                shown to players (default "Hackathon season")
//   SEASON_STARTS_AT           ISO time (default 2026-11-01T00:00:00Z)
//   SEASON_ENDS_AT             ISO time (default 2026-11-14T23:59:59Z)
//   SEASON_GOAL                season points for the season mark and Aura (default 30)
//   SEASON_POINTS              points per action, "hunt:1,visit:2,line:3"
//   SEASON_POT_TARGET_NEAR     meter target in NEAR (default 1)
//   SEASON_AURA                catalog edition awarded at the goal (default "season")
// The leaderboard is cosmetic: it counts hunts, visits and NPC lines, never
// money, and its rank never changes GOLD, XP, odds or payouts.
export const DEFAULT_SEASON_ID = "hackathon-2026";
export const DEFAULT_STARTS_AT = "2026-11-01T00:00:00Z";
export const DEFAULT_ENDS_AT = "2026-11-14T23:59:59Z";
export const DEFAULT_GOAL = 30;
export const DEFAULT_POINTS = Object.freeze({ hunt: 1, visit: 2, line: 3 });
export const DEFAULT_POT_TARGET_NEAR = "1";
const YOCTO = 10n ** 24n;

function int(value, fallback, min, max, name) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be ${min}–${max}.`);
  return n;
}

function time(value, fallback, name) {
  const t = Date.parse(value || fallback);
  if (!Number.isFinite(t)) throw new Error(`${name} must be an ISO date-time.`);
  return t;
}

function points(text) {
  const out = { ...DEFAULT_POINTS };
  if (!text) return Object.freeze(out);
  for (const part of String(text).split(",").map((x) => x.trim()).filter(Boolean)) {
    const [kind, raw] = part.split(":").map((x) => x.trim());
    if (!(kind in DEFAULT_POINTS)) throw new Error(`SEASON_POINTS: unknown action "${kind}" (use hunt, visit, line).`);
    out[kind] = int(raw, 1, 0, 100, `SEASON_POINTS ${kind}`);
  }
  return Object.freeze(out);
}

function near(value) {
  const text = String(value || DEFAULT_POT_TARGET_NEAR);
  const m = /^(\d{1,6})(?:\.(\d{1,24}))?$/.exec(text);
  if (!m) throw new Error("SEASON_POT_TARGET_NEAR must be a NEAR amount like 1 or 0.5.");
  const yocto = BigInt(m[1]) * YOCTO + BigInt((m[2] || "").padEnd(24, "0") || "0");
  if (yocto <= 0n) throw new Error("SEASON_POT_TARGET_NEAR must be above zero.");
  return yocto.toString();
}

export function seasonSettings(env = process.env, network = "testnet") {
  const flag = env.SEASON;
  if (flag !== undefined && !["", "0", "1"].includes(flag)) throw new Error("SEASON must be 0 or 1.");
  const enabled = flag === "1" || ((flag === undefined || flag === "") && network !== "mainnet");
  const id = env.SEASON_ID || DEFAULT_SEASON_ID;
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(id)) throw new Error("SEASON_ID must be 2–48 lowercase letters, digits or dashes.");
  const startsAt = time(env.SEASON_STARTS_AT, DEFAULT_STARTS_AT, "SEASON_STARTS_AT");
  const endsAt = time(env.SEASON_ENDS_AT, DEFAULT_ENDS_AT, "SEASON_ENDS_AT");
  if (endsAt <= startsAt) throw new Error("SEASON_ENDS_AT must be after SEASON_STARTS_AT.");
  const name = String(env.SEASON_NAME || "Hackathon season").slice(0, 60);
  const aura = env.SEASON_AURA === undefined ? "season" : String(env.SEASON_AURA);
  return Object.freeze({
    enabled,
    id,
    name,
    startsAt,
    endsAt,
    goal: int(env.SEASON_GOAL, DEFAULT_GOAL, 1, 10_000, "SEASON_GOAL"),
    points: points(env.SEASON_POINTS),
    potTarget: near(env.SEASON_POT_TARGET_NEAR),
    aura,
  });
}
