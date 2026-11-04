# Pay now with future yield (proposal)

Status: proposal, 1 November 2026. Nothing here is implemented or deployed. It records the owner's idea in a form
the contract lane can build and review. Current rules stay in force: prizes and reward days are backed only by
received liquidity (`docs/ECONOMY-RULES.md`, `IMPLEMENTATION-PLAN.md`); estimated yield never backs a prize.

## The idea in one paragraph

A player who has staked but has not yet earned enough GOLD can still open a paid quest today. They pledge the
future earnings of their own staking position: their principal stays locked in the vault until the realized
yield has paid the price. A second unlock adds to what is owed and extends the lock. The lock can never run longer
than about ten years, and the player can always pay the rest from their balance or principal to end it early.

Example from the owner: "I want to open this quest for 100 GOLD, but I will only earn that in three months. I
confirm that I cannot take my stake out of the protocol until the yield has paid it."

## How long a pledge locks the stake

The planning yield is deliberately conservative and is published with every quote:

    owner yield per year = stake × planning APR × (1 − contribution share)
    estimated lock       = amount owed ÷ owner yield per year

| Stake | Contribution to the city | Planning APR | Owner yield / year | 100 GOLD unlock locks about |
| --- | --- | --- | --- | --- |
| 10,000 GOLD (10 NEAR) | 50 % | 5 % | 250 GOLD | 4.8 months |
| 10,000 GOLD | 0 % | 5 % | 500 GOLD | 2.4 months |
| 8,000 GOLD | 0 % | 5 % | 400 GOLD | 3 months |
| 2,000 GOLD | 50 % | 5 % | 50 GOLD | 2 years |

The estimate is a promise of nothing. Repayment counts only realized yield, harvested and received in cash by the
vault. If real yield is lower, the lock lasts longer; if higher, it ends sooner.

## Limits

- **Time:** a pledge's deadline is at most 10 years from its creation; a quote whose estimate exceeds it is refused.
- **Collateral:** everything owed by one vault stays at or below 50 % of its principal. With a 5 % planning APR the
  two limits coincide (ten years of yield is half the stake), which keeps the rule easy to explain.
- **Stacking:** each new unlock adds to the amount owed and moves the estimated end date; both limits apply to the
  total. The quote shows the new end date before the player confirms.
- **Deadline reached:** whatever is still owed is paid from principal, which the player agreed to when pledging.
- **Early end:** the player can pay the remainder from their balance at any time, or request exit and have the
  remainder taken from the returned principal first.

## Who receives the money, and when

**Phase A, deferred settlement (no new capital at risk).** Access is granted immediately; the creator receives a
receivable instead of cash. Each realized harvest pays the owner share to open pledges first, oldest first, and the
creator's credit grows as it arrives. The creator sees "100 GOLD pledged, about 40 % received". The 80/20 split of
`questlayer-creators` applies to each payment as it lands.

**Phase B, optional advance pool.** A separately funded pool (sponsor or treasury money that is already received)
may buy receivables at a disclosed discount and pay the creator at once. The pool, its discount and its losses are
its own ledger; it never uses reward buckets, player principal or estimated yield.

## What the player sees

> **Open now, pay with your staking earnings.** Price 100 GOLD. Your stake of 8,000 GOLD stays in place until
> your earnings have paid it, about 3 months (around 1 February 2027). You can pay the rest at any time.
> [Open quest] [Not now]

Afterwards the profile shows each pledge with amount paid, amount left, estimated end and a "Pay the rest" action.
No chain words; the reviewed quote carries the exact numbers.

## Contract sketch (vault v2 and creators v2)

Vault state gains `liens: Vec<Lien { id, creditor, payee, owed, created_at, deadline }>`.

- `pledge_yield(creditor, payee, amount, deadline)`, beneficiary only, 1 yoctoNEAR. Checks both limits against the
  total owed, then calls the creditor contract (`on_pledge`) which grants access and records the receivable. A
  failed callback removes the lien.
- In the existing harvest cash branch, the owner share pays liens first (FIFO) by transfer to the creditor with
  `on_lien_payment`; only the remainder becomes `owner_credit`.
- `request_exit` stays possible; final cash pays liens before the owner. `withdraw_owner` cannot reduce principal
  below what is owed.
- `pay_lien(id)`, beneficiary only, with an attached deposit, pays down early.
- After `deadline`, a keeper call `enforce_lien(id)` starts the exit path and settles from principal.
- Creditors are an allowlist (the creators contract); the creators contract accepts pledges only from vaults the
  factory registered with the reviewed code hash.

Invariants to test: total owed ≤ 50 % of principal at every step; lien payments + owner credit = owner share of each
harvest; a lien is paid exactly once; a failed creditor callback restores the vault; deadlines are enforceable.

## Risks and open questions

- This is a form of credit. Fine on testnet; before mainnet it needs a legal and product review, plain disclosure,
  and probably regional limits.
- Validator performance and protocol inflation change real yield; the conservative APR and the 50 % collateral rule
  bound, but do not remove, a long lock.
- The vault is a reviewed, deployed contract; v2 means a new code hash, a factory update and migration of positions.
- Should pledges also unlock tier access or market purchases? Proposed answer: no, only creator quests at first.

## Order of work

1. Contract design review of this sketch (contract lane), then vault v2 + creators v2 with tests.
2. Server quotes (`/api/native/pledges/prepare`) and the reviewed player transaction; relayer allowlist for
   `pledge_yield` (1 yocto, relayed) and `pay_lien` (self-paid).
3. UI from the copy above; profile pledge list.
4. Testnet proof with a live harvest paying a pledge. Not planned before the 14 November submission; the
   submission may describe it as the next step.
