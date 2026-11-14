// Map reward policy (docs/MAP-REWARDS.md, QGOLD build plan stream 5).
// Numbers are versioned tuning values: a change bumps MAP_REWARDS_POLICY so a
// published day plan never changes meaning.
export const MAP_REWARDS_POLICY = "map-rewards-v2";

// Coins: Poisson-disc spacing along mapped public paths.
export const COIN_SPACING_M = Object.freeze({ min: 95, max: 120 });
// 3x denser within 300 m of a zone: spacing / sqrt(3) ~ 60 m.
export const ZONE_PULL_M = 300;
export const COIN_SPACING_NEAR_ZONE_M = 60;
export const MAX_COINS_PER_CELL = 400;

// Coin values (map-rewards-v2, 14 Nov 2026): every coin on the map is backed
// and worth the same. A day's coin budget is priced for COIN_TARGET coins
// (MAP_COIN_TARGET), so one coin = budget / target, but never under
// MIN_COIN_U (1 QGOLD): the owner wants coins everywhere, each worth at least
// something, rather than a few valuable ones. An opened street cell gets
// CELL_COINS coins (the owner's "about 10 per city"), the Plzeň city demo
// ARENA_COINS, and placement stops once the day's budget is placed: a coin
// on the map is always covered. Unplaced budget stays in the treasury.
export const CELL_COINS = 10;
export const ARENA_COINS = 50;
export const COIN_TARGET = 100_000;
export const MIN_COIN_U = 1;
// Coin tiers are only drawing sizes now: "small" is a normal coin, "medium" a
// pioneer coin worth two shares.
export const COIN_TIER = "small";
export const PIONEER_COIN_TIER = "medium";

// Waves: 6 per local day between 07:00 and 22:00, each start moved by up to
// +-30 min from the day seed so nobody can time them.
export const WAVES = Object.freeze({
  count: 6,
  from: "07:00",
  to: "22:00",
  jitterMin: 30,
});

// Daily budget when the chain has not reported today's caps yet (testnet:
// half of the 0.1 NEAR per-date cap for coins, half for zones) and the QGOLD
// backing rate R it is priced at (yoctoNEAR per whole QGOLD, 6 decimals).
export const DEFAULT_COIN_DAY_YOCTO = 5n * 10n ** 22n;
export const DEFAULT_ZONE_DAY_YOCTO = 5n * 10n ** 22n;
export const DEFAULT_QGOLD_RATE_YOCTO = 10n ** 21n;
export const QGOLD_UNITS = 1_000_000n; // micro-QGOLD per QGOLD
// Zone prizes still follow the formula below (votes steer up to 50 %).
export const FORMULA = Object.freeze({
  votes: 5000, // up to 50 %; unused share is redistributed (votes ship with stream 7)
  demand: 2000,
  random: 1500,
  potential: 1000,
  stake: 500,
});
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
