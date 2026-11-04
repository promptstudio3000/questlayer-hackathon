# QGOLD escrow (`contracts/qgold-escrow`)

Status: **not deployed.** It is deployed to testnet after the QGOLD token
(`contracts/soulbound-ft`) becomes a transferable NEP-141 token with
`ft_transfer_call`. WASM sha256 is pinned in `contracts/wasm-sha256.json` as
`questlayer_qgold_escrow`.

## Purpose

One contract holds QGOLD for three kinds of agreements:

| Kind | Who funds | Who is paid | Platform fee |
|---|---|---|---|
| `task` | poster | worker(s) | 10 % **on top** of the reward, paid by the poster, to the treasury only when a slot pays out |
| `secret` | buyer | Secret creator | 10 % **taken from** the price (creator 90 %, treasury 10 %) |
| `transfer` | sender | receiver | none |

Fees use `FEE_BPS = 1000` (of 10 000) and round **up**: `fee = ceil(x * 1000 / 10000)`.

## Funding: `ft_transfer_call` messages

Funds arrive only through `ft_transfer_call(receiver_id = escrow, amount, msg)` on
the configured `token_id`. `ft_on_transfer` panics for any other predecessor. An
invalid `msg` panics, so the token refunds the full amount. All `U128`/`U64`
values are decimal strings. Ids are 1-64 chars of `[A-Za-z0-9-_.:]`, unique per
kind forever (a finished id can never be reused).

```jsonc
// Task: amount must be exactly reward + ceil(reward * 10 %)
{"kind":"task","id":"task-123","reward":"100000000","deadline_ms":"1800000000000",
 "slots":3,                     // optional, 1..=50, default 1; reward % slots == 0
 "assignee":"alice.testnet"}    // optional named-user task; then slots must be 1

// Secret purchase: amount must equal price exactly
{"kind":"secret","id":"purchase-9","secret_id":"route-42","creator":"bob.testnet","price":"5000000"}

// Conditional transfer: no fee; expires_ms within 365 days
{"kind":"transfer","id":"gift-7","to":"carol.testnet","expires_ms":"1800000000000",
 "condition":{"type":"both_confirm"}}
//          {"type":"after","at_ms":"1799999000000"}       // at_ms < expires_ms
//          {"type":"gps","place_id":"place-7","radius_m":50} // 1..=10000 m
```

`ft_on_transfer` returns `"0"` when the escrow is created, and the full amount
while the contract is paused (the token refunds it).

## Roles

| Role | Can |
|---|---|
| `owner_id` | `set_publisher`, `set_moderator`, `set_guardian`, `set_treasury`, `pause`, `unpause`. Nothing else: **no admin withdrawal exists.** |
| `publisher_id` (game server) | `approve_task` (after off-chain GPS/photo check), `confirm_visit`, `confirm_transfer_gps` |
| `moderator_id` | `resolve_dispute`, `resolve_secret` |
| `guardian_id` | `pause` |
| `treasury_id` | receives fee credit; withdraws it like any account |

## Release rules

**Task** (per slot: worker gets `reward/slots`, treasury gets `fee/slots`; the last
slot to settle, paid or refunded, takes the fee rounding remainder):
- `approve_task(id, worker)` — publisher or poster; one payout per worker; worker ≠ poster; must be the assignee if one is set; needs an unreserved open slot.
- `cancel_task(id)` — poster; only when no dispute is open; refunds reward + fee of every unpaid slot.
- `expire_task(id)` — anyone, at/after `deadline_ms`; refunds reward + fee of every unpaid slot that has no open dispute.
- `open_dispute(id, worker)` — worker or poster; reserves one slot so cancel/expire cannot touch it; once per worker per task.
- `resolve_dispute(id, worker, pay)` — moderator. `pay=true` pays the slot; `pay=false` frees it (refunded to the poster at once if the deadline has passed).

**Secret:**
- `confirm_visit(id)` — publisher attests the GPS visit → creator 90 %, treasury 10 %.
- `release_secret(id)` — anyone, 7 days after funding, if not disputed.
- `dispute_secret(id)` — buyer, within 7 days.
- `resolve_secret(id, refund)` — moderator: `refund=true` returns the full price to the buyer, otherwise 90/10 release.

**Transfer:**
- `both_confirm`: `confirm_transfer(id)` by sender and by receiver, before expiry; the second releases.
- `after`: `release_transfer(id)` by anyone at/after `at_ms`.
- `gps`: `confirm_transfer_gps(id)` by the publisher before expiry.
- `refund_transfer(id)` — sender, at/after `expires_ms`, if still held.
- `decline_transfer(id)` — receiver, any time while held → sender refunded.

## Withdrawals (pull model)

Every payout, fee and refund becomes a credit (`get_credit(account)`). The owner
of the credit calls `withdraw()` with **exactly 1 yoctoNEAR** and **≥ 50 Tgas**;
the escrow calls `token.ft_transfer(account, credit)` with 1 yocto and then
`on_withdraw`, which restores the credit if the transfer failed. The account must
be registered on the token (`storage_deposit`); the game server pre-registers
players, creators and the treasury.

## Safety invariants

- `total_held` = accepted deposits − completed withdrawals.
- `total_held == escrowed + credits + pending_withdrawals`, asserted after every
  mutation; `get_stats().conserved` reports it.
- Only the configured token can deposit; amounts must match exactly.
- Funds only move to the funder (refund) or the named counterparty/treasury per the rules above.
- Paused blocks every call except views, admin calls and the `on_withdraw` callback; deposits are refunded.
- Bounds: id ≤ 64 bytes, ≤ 50 slots, ≤ 100 disputes per task, ≤ 200 open escrows per funding account, deadlines ≤ 365 days.
- QGOLD sent with plain `ft_transfer` (not `ft_transfer_call`) is not accounted and cannot be recovered.

## Views

`get_task(id)`, `get_secret(id)`, `get_transfer(id)`, `get_credit(account_id)`,
`get_open_count(account_id)`, `get_stats()`, `get_config()`.

Events: NEP-297 logs `EVENT_JSON:{"standard":"questlayer-escrow","version":"1.0.0","event":…,"data":[…]}`
with `funded`, `paid`, `refunded`, `disputed`, `resolved`, `withdraw_started`,
`withdrawn`, `withdraw_failed`, `deposit_refunded`, `paused`, `unpaused`, `config_changed`.

## Testnet deploy (after QGOLD is transferable)

```sh
bash scripts/build-contracts.sh            # or npm run contracts:docker for the pinned hash
near deploy escrow.questlayer.testnet contracts/target/wasm32-unknown-unknown/release/questlayer_qgold_escrow.wasm \
  --initFunction new --initArgs '{"owner_id":"…","token_id":"<qgold>.testnet","publisher_id":"…","moderator_id":"…","guardian_id":"…","treasury_id":"…"}'
near call <qgold>.testnet storage_deposit '{"account_id":"escrow.questlayer.testnet"}' --deposit 0.0125 --accountId …
```

The escrow account must be registered on the token and keep a NEAR balance for
its own storage (records are kept forever so ids stay unique).
Storage is paid by the escrow account, since `ft_on_transfer` carries no NEAR.
