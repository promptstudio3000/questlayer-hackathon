# Yield vault plan: liquid staking + stablecoins on Rhea Lend (2 Nov 2026)

Owner decisions (Lubos, 2 Nov 00:41–01:04 UTC):

- Integrate every liquid staking token, more tokens are fine.
- A player counts as **Staker immediately** after depositing; withdrawal only after a lock (24 h, or up to two days).
- Build a contract for stablecoins on Rhea Lend, but first check it is safe and whether a proven pattern exists.
- Offer a Rhea option per token by its interest rate and pool utilization; a full (100 %) pool is not offered.
- The treasury itself should be held in a liquid staking token.
- Start with the treasury stNEAR harvest, then USDC on Rhea Lend.

Decision doc (Czech): https://claude.ai/artifact/Ct8auUPwFRNWxng3x1AWRh. Earlier read-only prototype:
`docs/LIQUID-STAKE.md` (wallet-held tokens counted after a 24 h hold).

## Why a lock contract

"Staker at once" with tokens left in the player's wallet would let the same tokens open Staker for many accounts.
The lock removes that: tokens sit in our contract for the lock period, so the game can count them on deposit.
The wallet-held reader (PR #94) stays as a fallback path that needs 24 h.

## Proven pattern

PoolTogether is the closest proven design: deposits go to a yield source (Aave), principal is returned, and only
the interest funds prizes; the protocol is audited regularly. Its known risk is the yield source itself: a
shortfall at Aave would reach the principal. ([docs](https://docs.pooltogether.com/llms-full.txt)) We found no
NEAR app doing the same on Burrow/Rhea Lend. Burrow (now Rhea Lend) has two BlockSec audits in its original repo
and an Immunefi bug bounty ([repo](https://github.com/NearDeFi/burrowland),
[bounty](https://immunefi.com/bug-bounty/burrow/scope/)); the repo is archived, so the live code must be checked
against the deployed hash before integration.

Rhea Lend mechanics: supply = `ft_transfer_call` to the lending contract with `msg: ""` (after
`storage_deposit`); withdraw = `execute({"actions":[{"Withdraw":{"token_id","amount"}}]})`. Withdrawing supply
without debt needs no oracle prices. Our contract never borrows.

## Contract `questlayer-yield-vault` (new, testnet first)

- **Allowlist** of NEP-141 tokens, each `{kind: lst | stable, strategy: hold | rhea, cap}`. LSTs: stNEAR, LiNEAR
  (testnet + mainnet), rNEAR, NearX (mainnet). Stables: USDC, USDT (testnet fakes on `contract.burrow.testnet`).
- **Deposit** = `ft_on_transfer` from an allowlisted token; anything else is refunded in full. Each deposit is a
  tranche `{amount, value_near_at_deposit (lst), unlock_at = now + lock}`. Lock: 24 h default, owner may set 24–48 h,
  never for existing tranches.
- **Staker** status: the server reads `get_position(account)` and counts the deposit at once (value in NEAR from
  the LST's own price; stables via the existing EUR/NEAR price feed).
- **Withdraw** (`1 yocto`, beneficiary only, after unlock): stables return exact principal; LSTs return tokens
  worth the deposit value plus the player's share of growth. Pausing deposits never pauses withdrawals.
- **Yield to the city:** stables put on Rhea Lend earn interest above principal; a permissionless `harvest(token)`
  withdraws only the excess and sends it to the immutable treasury. LST growth share works the same way.
- **Liquidity buffer:** keep a part of each stable unsupplied (e.g. 20 %) so withdrawals do not wait on Rhea. If
  Rhea cannot pay (pool at 100 %), a withdrawal queues and is finished by a permissionless `advance`.
- **Async safety:** nonce + private callbacks + exact restore on failure, the same pattern as `contracts/vault`.
- **Limits:** per-token caps, small testnet totals, no borrowing, no arbitrary strategy, no owner path to
  player principal. Unaudited: testnet only until an independent review.

## App side

- `GET /api/yield/markets`: Rhea Lend supply APR, supplied, borrowed and utilization per allowlisted token; a
  market at or above `RHEA_MAX_UTILIZATION` (default 95 %) is shown as full and not offered.
- Treasury in stNEAR: the treasury account holds stNEAR; the daily worker sells only the growth through
  `liquid_unstake` and funds the rewards contract as a sponsor receipt labelled lending/staking yield.

## Work split

1. Contract `questlayer-yield-vault` + tests + Docker build + `wasm-sha256.json` (worker thread).
2. Treasury in stNEAR + daily harvester script on the Mac (needs the operator key; worker thread).
3. Rhea markets reader and staker integration (this thread).

## App wiring (done, 2 Nov)

- `server/native/yield-vault-reader.mjs` reads `get_position` for the player's linked accounts. LST principal
  (yoctoNEAR) counts at once; stable principal converts at `YIELD_STABLE_EUR` (0.85 €/USD, conservative) and the
  EUR reference price, and does not count without a price. Contract from `YIELD_VAULT_ACCOUNT` or
  `public/native-yield-vault-<network>.json`; `YIELD_VAULT_ENABLED=0` turns it off. `GET /api/yield/position`.
- The Keeper's reading sums the wallet-held reader (24 h hold) and the yield vault (at once) into the Staker step
  only. Tiers and the city share stay on the native vault.
