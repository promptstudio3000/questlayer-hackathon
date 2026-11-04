// Map reward policy (docs/MAP-REWARDS.md, QGOLD build plan stream 5).
// Numbers are versioned tuning values: a change bumps MAP_REWARDS_POLICY so a
// published day plan never changes meaning.
import { COIN_VALUE } from "../domain.mjs";

export const MAP_REWARDS_POLICY = "map-rewards-v1";

// Coins: Poisson-disc spacing along mapped public paths.
export const COIN_SPACING_M = Object.freeze({ min: 95, max: 120 });
// 3x denser within 300 m of a zone: spacing / sqrt(3) ~ 60 m.
export const ZONE_PULL_M = 300;
export const COIN_SPACING_NEAR_ZONE_M = 60;
export const MAX_COINS_PER_CELL = 400;

// Coin values: small, medium and rare, multiples of one unit.
export const COIN_TIERS = Object.freeze([
  Object.freeze({ id: "small", mult: 1 }),
  Object.freeze({ id: "medium", mult: 3 }),
  Object.freeze({ id: "rare", mult: 10 }),
]);
// Odds [small, medium, rare] in basis points.
export const COIN_ODDS = Object.freeze({
  far: [8000, 1700, 300],
  nearZone: [6000, 3000, 1000],
});
export const MEAN_MULT = 1.6; // planning estimate of the average multiplier
export const MIN_UNIT_U = COIN_VALUE; // a small coin is never below 0.01 GOLD
export const MAX_UNIT_U = 20 * COIN_VALUE; // money that would need bigger coins stays in the treasury

// Waves: 6 per local day between 07:00 and 22:00, each start moved by up to
// +-30 min from the day seed so nobody can time them.
export const WAVES = Object.freeze({
  count: 6,
  from: "07:00",
  to: "22:00",
  jitterMin: 30,
});

// Daily plan: share of the coin treasury per day and the formula weights.
export const DAILY_SHARE_BPS = 1000; // 10 % of the available coin treasury (only opened cells reserve it)
export const ZONE_SHARE_BPS = 400; // 4 % of the available zone treasury
export const FORMULA = Object.freeze({
  votes: 5000, // up to 50 %; unused share is redistributed (votes ship with stream 7)
  demand: 2000,
  random: 1500,
  potential: 1000,
  stake: 500,
});
export const PIONEER_RESERVE_BPS = 500; // 5 % of the day, off the top
export const AREA_CAP_BPS = 2500; // at most 25 % of a day per res-5 area
export const CELL_CAP_BPS = 100; // and at most 1 % per res-7 cell
export const RANDOM_CELLS_BPS = 300; // 3 % of cells are today's random picks
export const DEMAND_DAYS = 7;
export const STAKE_DAYS = 30;
export const PIONEER_DAYS = 30;
export const PIONEER_MULT = 2;

// Zones per cell: 1 to 3, by POI density (a proxy for population and interest).
export const CELL_ZONE_STEPS = Object.freeze([30, 150]);
export const MAX_CELL_ZONES = 3;
