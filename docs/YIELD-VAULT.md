# questlayer-yield-vault (contract)

Status 2 Nov 2026: built and unit-tested, **testnet only, unaudited**. Plan and owner decisions:
`docs/YIELD-VAULT-PLAN.md`. Source: `contracts/yield-vault`. Deploy: `node scripts/deploy-yield-vault-testnet.mjs`
on the Mac (operator key), which writes `public/native-yield-vault-testnet.json`.

## Proven pattern it follows

- **PoolTogether v5 PrizeVault** (audited by Code4rena and Cantina): players hold a claim on exact principal
  ("total debt"); only assets above total debt plus a small *yield buffer* are liquidatable yield; when assets fall
  below debt, withdrawals share the loss pro-rata. Our `harvest` is the same rule: surplus = assets − principal −
  `safety_bps` of principal, and it can only go to the immutable treasury.
- **Rhea Lend (ex-Burrow)**: we only use supply and withdraw, never collateral or borrowing. Code read from the
  original `NearDeFi/burrowland` repo (two BlockSec audits, Immunefi bounty). Supply = `ft_transfer_call(msg "")`;
  withdraw = `execute({actions:[{Withdraw:{token_id, amount}}]})`. Rhea's `execute` returns nothing and sends the
  tokens in a detached `ft_transfer`; on failure its `after_ft_transfer` puts them back into our supply. That is
  why a Rhea withdrawal is counted only after `confirm_inbound` checks Rhea's own record of our supply.
- **contracts/vault**: per-operation nonce, `#[private]` callbacks, exact restore on every failed promise.

No live NEAR app that does exactly this on Rhea was found; Rhea's own risk (bad debt, pause) reaches principal.

## Tokens (allowlist is in code)

| Token | Kind | Value unit | Price source | Strategy |
| --- | --- | --- | --- | --- |
| `meta-v2.pool.testnet` (stNEAR) | lst | yoctoNEAR | `get_st_near_price` | hold |
| `linear-protocol.testnet` (LiNEAR) | lst | yoctoNEAR | `ft_price` | hold |
| `usdc.fakes.testnet` | stable | token (6 dp) | none | rhea |
| `usdt.fakes.testnet` | stable | token (6 dp) | none | rhea |

Both price methods return yoctoNEAR per 10^24 token units. Mainnet tokens (rNEAR, NearX, real USDC/USDT) need a
new allowlist, a review and Lubos's go.

## Player flow

- **Deposit**: `ft_transfer_call(receiver_id = vault, amount, msg = "deposit")`. Anything else, an unknown token, a
  cap breach or a failed price read refunds the whole amount. LST deposits are valued at the protocol price.
- **Staker at once**: `get_position({account_id})` returns per token `principal` (counts immediately),
  `withdrawable`, `queued` and `tranches: [{amount, locked_until_ms}]`.
- **Lock**: each deposit is its own tranche, `lock_ms` 24 h by default; the owner may set 24–48 h, which applies to
  new deposits only. At most 16 locked tranches per token and account.
- **Withdraw**: `withdraw({token_id, amount})`, 1 yoctoNEAR, `amount` in the value unit. Stables return exact
  principal from the buffer, or join a FIFO queue when the buffer is short (one queued withdrawal per account;
  a withdrawal must be at least the minimum deposit unless it takes the whole free balance). LSTs return tokens worth the NEAR
  value at today's price; if the vault ever holds less (slashing), the payout is the pro-rata share. Withdrawals
  are never paused.

## Keepers (anyone may call)

| Call | What it does |
| --- | --- |
| `rebalance(token_id)` | Stables. Supplies idle above the buffer target (queue + `buffer_bps`, default 20 %) to Rhea if Rhea accepts deposits and utilization < `max_util_bps` (default and maximum 95 %, same as `RHEA_MAX_UTILIZATION`). Otherwise withdraws from Rhea up to Rhea's free liquidity to refill the buffer. With the Rhea strategy off, it drains Rhea. |
| `confirm_inbound(token_id)` | After 30 blocks, reads our Rhea supply: if it is still below the pre-withdrawal level minus half the amount, Rhea's transfer went through and the tokens are credited; if it is back up, the transfer bounced and nothing is credited. Our own token balance is never used (donations and refunds distort it). |
| `advance(token_id)` | Pays up to 5 queued withdrawals, oldest first. |
| `harvest(token_id)` | Sends the surplus above principal + `safety_bps` (default 0.1 %) to the treasury. LSTs: by today's price; stables: idle + Rhea supply, paid from idle only and never from money the queue needs. |
| `reset_op(token_id)` | Frees a keeper slot whose callback never ran, after 15 min. |

One keeper operation runs per token at a time; each read callback checks its nonce. Payment callbacks settle the
money even when their nonce is stale (after `reset_op`) and only skip freeing the slot. Keepers attach 250 TGas to
`rebalance` and 100 TGas to `harvest`, `confirm_inbound` and `withdraw`.

## Owner powers (configuration only)

`add_token` (allowlisted ids only), `set_token_limits` (caps up to a ceiling in code, buffer 20–100 %, utilization
cap ≤ 95 %, safety 0.1–10 %, Rhea on/off), `set_lock_hours` (24–48), `set_deposits_paused` (deposits, Rhea supply and
harvest; never withdrawals), `register_on_token`, `register_on_rhea`. No method moves player principal; the treasury
and Rhea account are fixed at init. The yield goes to one global treasury, never per city.

The contract account still has the operator's full-access key on testnet, so the operator could redeploy code:
that is a complete path to principal. Before any mainnet use the key must be removed (or the code locked behind a
reviewed upgrade path).

## Known limits

- Unaudited; small caps (LST 100 NEAR per token, 10 per account; stables 10 000 per token, 1 000 per account).
- Rhea risk (bad debt, paused withdrawals) can delay or reduce stable principal. The queue waits for liquidity.
- At most 1 000 positions in total (the contract pays their storage, about 2 NEAR); after that new accounts are
  refunded. A NEP-145 storage deposit replaces this before mainnet.
- If a keeper slot is reset while a Rhea withdrawal callback is pending, two withdrawals can share one
  `confirm_inbound`; the stricter threshold is kept. This needs a callback delayed over 15 minutes.
- Tokens sent without `msg = "deposit"` (plain `ft_transfer`) are not tracked and stay in the contract.
- LST surplus is skimmed in full; the player gets the deposit's NEAR value back, not the LST growth.
