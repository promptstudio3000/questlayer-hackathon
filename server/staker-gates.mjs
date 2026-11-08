// Staker gates (owner decision 1 Nov 2026, 23:47 UTC): staker content opens
// gradually, by step AND level, so it does not block beginners while every
// player is pulled toward a first small stake (about 5 €).
//
// Steps, lowest first:
//   staker  patron rank 0: matured (E+2) active stake >= STAKER_MIN_NEAR (2)
//   tier2   the vault contract's Tier 2 (50 NEAR weighted)
//   tier3   the vault contract's Tier 3 (100 NEAR weighted)
// A higher step includes the lower ones. The table lives in
// server/data/staker-gates.json; STAKER_GATES_PATH (a JSON file) or
// STAKER_GATES_JSON (inline JSON) override single gates, STAKER_MIN_NEAR the
// minimum. A gate decides what a player may see, do or wear. It never changes
// odds, damage, prices of a roll or a payout.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerModuleSchema, ensureModuleVersion } from "./schema-compatibility.mjs";

export const STAKER_GATES_POLICY = "staker-gates-v1";
export const STEPS = ["none", "staker", "tier2", "tier3"];
const YOCTO = 10n ** 24n;
const TIER_NEAR = { tier2: 50, tier3: 100 };
const DEFAULT_PATH = fileURLToPath(new URL("./data/staker-gates.json", import.meta.url));

const big = (v) => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
};

/** "2" / "2.5" NEAR → yocto bigint, or null when malformed or out of range. */
export function nearToYocto(near) {
  const s = String(near ?? "").trim();
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const y = BigInt(whole) * YOCTO + BigInt((frac + "000").slice(0, 3)) * 10n ** 21n;
  return y > 0n ? y : null;
}

function validGate(g) {
  return (
    g &&
    typeof g === "object" &&
    STEPS.includes(g.step) &&
    g.step !== "none" &&
    Number.isInteger(g.level) &&
    g.level >= 1 &&
    g.level <= 50
  );
}

function readJson(source, inline = false) {
  try {
    return JSON.parse(inline ? source : readFileSync(source, "utf8"));
  } catch {
    return null;
  }
}

/** The gate table with every override applied. Broken overrides are ignored. */
export function stakerGateSettings(env = process.env, { path = DEFAULT_PATH } = {}) {
  const base = readJson(path) || { gates: {} };
  const gates = {};
  for (const [key, g] of Object.entries(base.gates || {}))
    if (validGate(g)) gates[key] = { step: g.step, level: g.level, label: String(g.label || key).slice(0, 80) };
  for (const extra of [env.STAKER_GATES_PATH && readJson(env.STAKER_GATES_PATH), env.STAKER_GATES_JSON && readJson(env.STAKER_GATES_JSON, true)]) {
    const list = extra?.gates || extra;
    if (!list || typeof list !== "object") continue;
    for (const [key, g] of Object.entries(list)) {
      if (!/^[a-z0-9_]{2,40}$/.test(key)) continue;
      const merged = { ...(gates[key] || { label: key }), ...(g || {}) };
      if (validGate(merged)) gates[key] = { step: merged.step, level: merged.level, label: String(merged.label || key).slice(0, 80) };
    }
  }
  const minNear = nearToYocto(env.STAKER_MIN_NEAR) ? String(env.STAKER_MIN_NEAR).trim() : nearToYocto(base.stakerMinNear) ? String(base.stakerMinNear) : "2";
  return {
    policy: STAKER_GATES_POLICY,
    version: base.version || STAKER_GATES_POLICY,
    minNear,
    minYocto: nearToYocto(minNear),
    gates,
  };
}

let cached = null;
/** Settings read once per process (the env does not change at runtime). */
export const defaultStakerGates = () => (cached ||= stakerGateSettings(process.env));
export const resetStakerGatesForTests = () => {
  cached = null;
};

/**
 * Normalised access for one player.
 *   tier     highest tier (1–3) from the vault contract or the demo stake
 *   matured  matured active stake in yoctoNEAR (string or bigint)
 *   pending  stake that is still maturing (E+2), yoctoNEAR
 *   weighted the contract's weighted stake, yoctoNEAR (for "how far to Tier 2")
 */
export function stakerAccess({ tier = 1, matured = 0n, pending = 0n, weighted = 0n, level = 1 } = {}, settings = defaultStakerGates()) {
  const t = Number.isInteger(tier) ? Math.max(1, Math.min(3, tier)) : 1;
  const m = big(matured);
  const staker = t >= 2 || m >= settings.minYocto;
  const step = t >= 3 ? 3 : t >= 2 ? 2 : staker ? 1 : 0;
  return {
    step,
    stepName: STEPS[step],
    staker,
    tier: t,
    matured: m.toString(),
    pending: big(pending).toString(),
    weighted: big(weighted).toString(),
    level: Number.isInteger(level) && level >= 1 ? level : 1,
  };
}

export const formatEur = (near, priceEur) => {
  if (!(priceEur > 0)) return null;
  const v = Number(near) * priceEur;
  if (!(v > 0)) return null;
  return v < 10 ? `${Math.round(v * 2) / 2}`.replace(/\.0$/, "") : `${Math.round(v)}`;
};

const nearText = (yocto) => {
  const n = Number(big(yocto) / 10n ** 21n) / 1000;
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
};

/** What is missing for one need, as chips the client shows word for word. */
function missingStake(need, access, settings, priceEur) {
  if (need <= access.step) return null;
  if (need === 1) {
    const eur = formatEur(settings.minNear, priceEur);
    if (big(access.matured) + big(access.pending) >= settings.minYocto)
      return { kind: "maturing", near: settings.minNear, label: "Your stake is maturing (E+2)" };
    return {
      kind: "stake",
      near: settings.minNear,
      eur,
      label: `Stake ${settings.minNear} NEAR${eur ? ` (~${eur} €)` : ""}`,
    };
  }
  const name = STEPS[need];
  return { kind: "tier", tier: need, near: String(TIER_NEAR[name]), label: `Reach Tier ${need} (${TIER_NEAR[name]} NEAR matured)` };
}

/** Amount the stake sheet prefills from a locked chip, in NEAR. */
function stakeNearFor(need, access, settings) {
  if (need <= 1) return settings.minNear;
  const missing = BigInt(TIER_NEAR[STEPS[need]]) * YOCTO - big(access.weighted);
  return missing > settings.minYocto ? String(Math.ceil(Number(missing / 10n ** 21n) / 1000)) : settings.minNear;
}

/**
 * One gate for one player: {key, label, open, need, missing[], stakeNear}.
 * An unknown key is closed and says so (a typo must never open content).
 */
export function checkGate(key, access, { settings = defaultStakerGates(), priceEur = null } = {}) {
  const g = settings.gates[key];
  const a = access?.step != null ? access : stakerAccess(access, settings);
  if (!g) return { key, label: key, open: false, need: null, missing: [{ kind: "unknown", label: "Not available here" }], stakeNear: settings.minNear };
  const need = STEPS.indexOf(g.step);
  const missing = [];
  const stake = missingStake(need, a, settings, priceEur);
  if (stake) missing.push(stake);
  if (a.level < g.level) missing.push({ kind: "level", level: g.level, label: `Reach level ${g.level}` });
  return {
    key,
    label: g.label,
    open: !missing.length,
    need: { step: g.step, level: g.level },
    missing,
    stakeNear: stakeNearFor(need, a, settings),
  };
}

/** Every gate at once, for GET /api/staker/gates and the profile. */
export function allGates(access, opts = {}) {
  const settings = opts.settings || defaultStakerGates();
  return Object.fromEntries(Object.keys(settings.gates).map((k) => [k, checkGate(k, access, { ...opts, settings })]));
}

/** Short chip text: "Stake 2 NEAR (~5 €) · Reach level 4". */
export const missingText = (gate) => gate.missing.map((m) => m.label).join(" · ");

// Staker status cache: the Keeper's vault reading (the only place that sees
// maturity) records it here, so NPC menus can check gates without a chain call.
export const STAKER_STATUS_SCHEMA = registerModuleSchema({
  name: "staker-status",
  version: 1,
  sql: `
CREATE TABLE IF NOT EXISTS staker_status(
  player_id TEXT PRIMARY KEY,
  tier INTEGER NOT NULL,
  matured TEXT NOT NULL,
  pending TEXT NOT NULL,
  weighted TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
});

const ready = new WeakSet();
const init = (db) => {
  if (!ready.has(db)) ensureModuleVersion(db, STAKER_STATUS_SCHEMA);
  ready.add(db);
};

export function recordStakerStatus(db, player, { tier = 1, matured = 0n, pending = 0n, weighted = 0n }, now = Date.now()) {
  init(db);
  db.prepare(
    "INSERT INTO staker_status(player_id,tier,matured,pending,weighted,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET tier=excluded.tier,matured=excluded.matured,pending=excluded.pending,weighted=excluded.weighted,updated_at=excluded.updated_at",
  ).run(player, tier, big(matured).toString(), big(pending).toString(), big(weighted).toString(), now);
}

/** Last recorded status, or null. Never creates the table on a read path. */
export function readStakerStatus(db, player) {
  try {
    const r = db.prepare("SELECT tier,matured,pending,weighted,updated_at updatedAt FROM staker_status WHERE player_id=?").get(player);
    return r || null;
  } catch {
    return null;
  }
}

/**
 * The player's stake tier (1–3) for Tier 2/3 places: only the vault contract's
 * reading recorded above counts. The old simulated staking never grants a tier.
 */
export function playerStakeTier(db, player) {
  const t = player ? readStakerStatus(db, player)?.tier : null;
  return Number.isInteger(t) ? Math.max(1, Math.min(3, t)) : 1;
}

/**
 * Tier for opening Tier 2/3 places on the map. Owner decision 8 Nov 2026:
 * places are open to everyone until launch, so this is 3 unless
 * TIER_PLACES=stake, which gates them by the real vault tier instead.
 * Staker gates (NPC menus, patron content) always use playerStakeTier.
 */
export function placeTier(db, player, env = process.env) {
  return env.TIER_PLACES === "stake" ? playerStakeTier(db, player) : 3;
}

/** Access for a player from the cache plus the world's tier and level. */
export function playerStakerAccess(db, player, { worldTier = 1, level = 1, settings = defaultStakerGates() } = {}) {
  const s = player ? readStakerStatus(db, player) : null;
  return stakerAccess(
    {
      tier: Math.max(Number.isInteger(worldTier) ? worldTier : 1, s?.tier || 1),
      matured: s?.matured,
      pending: s?.pending,
      weighted: s?.weighted,
      level,
    },
    settings,
  );
}
