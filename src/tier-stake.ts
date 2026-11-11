// NEAR of matured weighted stake each place tier needs (the vault contract's
// tiers, mirrored from TIER_NEAR in server/staker-gates.mjs). Weighted stake =
// principal × the share of yield sent to the prize pool, so at a 100 % share
// Tier 3 needs 50 NEAR and at 50 % it needs 100 (Lubos, 11 Nov 2026: Tier 2 = 10, Tier 3 = 50).
export const TIER_NEAR = Object.freeze({ tier2: 10, tier3: 50 });
export const tierStakeNear = (tier: number) => (tier >= 3 ? TIER_NEAR.tier3 : TIER_NEAR.tier2);
