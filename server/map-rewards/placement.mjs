// Deterministic coin placement in one H3 cell (docs/MAP-REWARDS.md).
//
// Input: candidate points on mapped public paths (every ~16 m), the zones of
// the cell, a seed, a coin count and one coin value. Output: coins at least
// 60-120 m apart (Poisson disc; 60 m within 300 m of a zone, so 3x denser
// there), all worth the same, each in one of the day's six waves. Same input, same coins: the seed comes from the day
// plan, so a cell's coins can be recomputed and checked against its leaf.
import { createHash } from "node:crypto";
import { distance } from "../domain.mjs";
import { localDateBounds } from "../spatial/calendar.mjs";
import {
  COIN_SPACING_M,
  COIN_SPACING_NEAR_ZONE_M,
  COIN_TIER,
  MAX_COINS_PER_CELL,
  WAVES,
  ZONE_PULL_M,
} from "./policy.mjs";

/** Uniform [0,1) from a seed and a label. */
export function unit(seed, label) {
  const h = createHash("sha256").update(`${seed}|${label}`).digest();
  return h.readUInt32BE(0) / 2 ** 32;
}

const nearZone = (p, zones) => zones.some((z) => distance(z, p) <= ZONE_PULL_M);

/** Spacing grid: one bucket per ~60 m so a check looks at 9 buckets. */
function grid(cell = 60) {
  const buckets = new Map();
  const key = (p) => {
    const x = Math.floor(
        (p.lng * 111320 * Math.cos((p.lat * Math.PI) / 180)) / cell,
      ),
      y = Math.floor((p.lat * 110540) / cell);
    return [x, y];
  };
  return {
    add(p) {
      const [x, y] = key(p);
      const k = `${x},${y}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    },
    near(p, reach) {
      const [x, y] = key(p),
        n = Math.ceil(reach / cell),
        out = [];
      for (let dx = -n; dx <= n; dx++)
        for (let dy = -n; dy <= n; dy++) {
          const b = buckets.get(`${x + dx},${y + dy}`);
          if (b) out.push(...b);
        }
      return out;
    },
  };
}

/**
 * Pick coin spots. Candidates are visited in a seeded order; a spot is kept
 * when every kept coin is at least the mean of both spacings away.
 */
export function spaceCoins(
  samples,
  zones = [],
  { seed, max = MAX_COINS_PER_CELL } = {},
) {
  const order = samples
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
    .map((p, i) => ({
      lat: p.lat,
      lng: p.lng,
      k: unit(seed, `spot:${p.lat.toFixed(6)},${p.lng.toFixed(6)}:${i}`),
    }))
    .sort((a, b) => a.k - b.k);
  const kept = [],
    g = grid();
  for (const p of order) {
    if (kept.length >= max) break;
    const near = nearZone(p, zones);
    const r = near
      ? COIN_SPACING_NEAR_ZONE_M
      : COIN_SPACING_M.min +
        (COIN_SPACING_M.max - COIN_SPACING_M.min) * unit(seed, `r:${p.k}`);
    if (
      g.near(p, COIN_SPACING_M.max).some((q) => distance(p, q) < (r + q.r) / 2)
    )
      continue;
    const coin = { lat: p.lat, lng: p.lng, r, nearZone: near };
    kept.push(coin);
    g.add(coin);
  }
  return kept;
}

/**
 * Coins of one cell for one day: at most `count` spots, every coin worth the
 * same `valueU` (0 = XP only, e.g. the demo arena). Returns { coins, spentU };
 * what the paths cannot hold stays in the treasury.
 * Each coin: { i, lat, lng, valueU, tier, wave }.
 */
export function placeCellCoins({
  samples,
  zones = [],
  seed,
  count = MAX_COINS_PER_CELL,
  valueU = 0,
  tier = COIN_TIER,
  waves = WAVES.count,
}) {
  const max = Math.max(0, Math.min(MAX_COINS_PER_CELL, Math.floor(count)));
  const value = Math.max(0, Math.floor(Number(valueU) || 0));
  if (max < 1 || !samples?.length) return { coins: [], spentU: 0 };
  const spots = spaceCoins(samples, zones, { seed, max });
  const coins = spots.map((s, i) => ({
    i,
    lat: Number(s.lat.toFixed(7)),
    lng: Number(s.lng.toFixed(7)),
    valueU: value,
    tier,
    wave: waves > 1 ? Math.floor(unit(seed, `wave:${i}`) * waves) : 0,
  }));
  return { coins, spentU: coins.length * value };
}

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/**
 * Opening times of the day's waves (ms), in local time. The first wave opens
 * at 07:00 +-jitter, the last before 22:00. The day seed moves each start by up
 * to +-30 minutes, so the times cannot be read off a clock in advance.
 */
export function waveTimes(day, timezone, seed, { count = WAVES.count } = {}) {
  const { startsAt, endsAt } = localDateBounds(day, timezone);
  if (count <= 1) return [startsAt];
  const from = minutes(WAVES.from),
    to = minutes(WAVES.to),
    step = (to - from) / count;
  const out = [];
  for (let k = 0; k < count; k++) {
    const jitter =
      k === 0
        ? Math.abs(WAVES.jitterMin * (2 * unit(seed, `wave-at:${k}`) - 1))
        : WAVES.jitterMin * (2 * unit(seed, `wave-at:${k}`) - 1);
    const at = startsAt + Math.round((from + k * step + jitter) * 60000);
    out.push(Math.min(endsAt - 60000, Math.max(startsAt, at)));
  }
  return out;
}
