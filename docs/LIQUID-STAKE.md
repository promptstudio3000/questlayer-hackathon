# Liquid staking tokens: second path to the Staker step (prototype)

Status 2 Nov 2026: read-only prototype, **off by default**, testnet only. Decision doc (Czech):
https://claude.ai/artifact/Ct8auUPwFRNWxng3x1AWRh

## Idea

A player may hold stNEAR (Meta Pool) or LiNEAR in a linked wallet instead of opening a vault position. The
server values the balance at the protocol's own on-chain price (`get_st_near_price`, `ft_price`; never 1:1) and
counts only what stayed in that wallet for the whole hold window (default 24 h). Selling is instant through
Meta Pool's `liquid_unstake` (0.30–3 % on testnet) or a DEX; the count drops at the next reading.

The game never signs, swaps or holds a token, and the city receives **no yield share** from liquid tokens.
Tier 2/3 and the city share stay with the vault (`contracts/vault`).

## Why a hold window

A vault position cannot be transferred; moving money to another account takes a 4-epoch exit. A token can be
transferred at once, so without a window the same 2 NEAR could open Staker for many accounts in turn. The
module reads `ft_balance_of` at 7 checkpoints spread over the window (RPC nodes keep about two days of state)
and counts the lowest one. A balance missing at any checkpoint resets the count; an unreadable past block fails
closed. A transfer out and back between two checkpoints (4 h apart) is not seen; acceptable for story and
cosmetic gates, reconsider before trader rates use it.

## Code and settings

- `server/native/liquid-stake.mjs`: `liquidStakeSettings`, `readLiquidStake`, `createLiquidStake` (10-min cache).
- `GET /api/staker/liquid`: the player's linked accounts, `matureNear` (yocto) and per-token readings, including
  Meta Pool's current instant-exit fee (`instantExitFeeBps`).
- Tests: `tests/liquid-stake.test.mjs` (no network).

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIQUID_STAKE_ENABLED` | off | `1` turns the reading and the route on |
| `LIQUID_STAKE_TOKENS` | `stnear,linear` on testnet, empty on mainnet | allowlist; mainnet knows `stnear,linear,rnear` |
| `LIQUID_HOLD_HOURS` | `24` | hold window, 1–36 h |
| `LIQUID_HOLD_CHECKPOINTS` | `7` | past balances read per token, 2–12 |

Known contracts: testnet `meta-v2.pool.testnet`, `linear-protocol.testnet`; mainnet `meta-pool.near`,
`linear-protocol.near`, `lst.rhealab.near` (rNEAR, mainnet only).

## Next steps

1. After PR #90 merges: `staker_status` adds `matureNear` to matured vault principal for the Staker step only
   (`STAKER_MIN_NEAR`), and the locked chip offers "or hold 2 NEAR of stNEAR for 24 h".
2. Profile → Stake: a "Liquid stake" card with value, countdown, instant-exit fee and a link to the protocol app.
3. Later, post-hackathon: vault v3 holding stNEAR with `liquid_unstake` exit (new contract, review, Docker build).
