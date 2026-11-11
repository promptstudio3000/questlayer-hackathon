// NEAR of matured weighted stake each place tier needs (the vault contract's
// tiers, mirrored from TIER_NEAR in server/staker-gates.mjs). Weighted stake =
// principal × the share of yield sent to the prize pool, so at a 100 % share
// Tier 3 needs 100 NEAR and at 50 % it needs 200.
export const TIER_NEAR = Object.freeze({ tier2: 50, tier3: 100 });
export const tierStakeNear = (tier: number) => (tier >= 3 ? TIER_NEAR.tier3 : TIER_NEAR.tier2);
