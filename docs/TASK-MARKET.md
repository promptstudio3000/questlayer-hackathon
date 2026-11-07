# Task market, Secrets and conditional sends

QGOLD build stream 3 (see `/mnt/project-files/tokenomics/QGOLD-BUILD-PLAN.md`). Players pay
each other for real-world tasks, sell hidden places ("Secrets") and send GOLD on a condition.
Testnet only.

## Settlement

All money is real QGOLD (6 decimals; 1 micro-GOLD = 1 base unit) held by `contracts/qgold-escrow`
(docs/QGOLD-ESCROW.md). `players.gold_u` is never read or written by the market.

1. The server creates the row in state `funding` and returns the exact call the player signs:
   `ft_transfer_call(receiver_id = escrow, amount, msg)` on the QGOLD token, 1 yocto, 200 Tgas.
   The relayer sponsors it for the explorer account (policy: only into the escrow).
2. The app signs it (`fundMarketEscrow` in `src/App.tsx`) and calls `POST /api/market/funded {id}`.
   The server reads `get_task` / `get_secret` / `get_transfer` from the configured escrow at FINAL
   finality and checks the full persisted intent and lifecycle before applying it atomically.
   The escrow worker re-checks waiting fundings every 15 s. Only an explicit absent (`null`) view
   can expire a waiting row after 2 h; an RPC error or incomplete response is not proof of absence.
3. Every payout or refund is a queued publisher call in `mk_chain_ops` (`server/market/chain.mjs`),
   written in the same database transaction as the row change and sent in order per escrow id.
   The worker persists the exact signed transaction before broadcast and acknowledges receipt evidence.
   After a payout the worker calls `withdraw_for(account)`, so QGOLD lands in the receiver's
   account without them doing anything.

### Funding verification and recovery

`server/market/funding.mjs` binds the view ID and payer to the persisted funding request and checks
exact integer amounts. A task also binds its reward, fee, slots, per-slot reward, assignee and
deadline; a Secret binds its Secret ID, creator, price, creator share and seven-day release time;
a conditional send binds its receiver, expiry and every field of its release condition.

The immutable agreement in the configured contract is evidence of accepted funding: its ID can
be created only once, through the configured token's successful exact-amount `ft_on_transfer`.
This relies on the reviewed contract code/configuration and a trusted FINAL RPC response. A client
claim, matching amount alone, arbitrary contract view or submitted transaction hash is insufficient.

| Observed agreement | Local result |
| --- | --- |
| Entire task/sponsor collateral still open | Open the existing offer with its original capacity |
| All task/sponsor slots paid or refunded | Keep it closed, zero held funds and record an earned fee only if paid |
| Secret held or disputed | Preserve that state and the original on-chain funding timestamp |
| Secret released or refunded | Preserve legitimate paid access after release; grant no access after refund; zero held funds |
| Transfer held, released or refunded | Preserve that state and existing confirmation flags; zero held funds if settled |
| Partly consumed/disputed task, consumed counteroffer, mismatched or incomplete view | Keep unresolved for reconciliation; never recreate full collateral or guess who is entitled |

Recognizing an already settled payment does not submit another release/refund. It may queue only
`withdraw_for` to deliver the contract's existing credit to its owner. Fee records, withdrawal
requests, the target row and the funding claim commit together. A stale check cannot reactivate a
dropped or changed intent. Repeated confirmation is idempotent, and failed/interrupted activation
rolls back before retry. Bounded worker checks rotate past unresolved/malformed entries.

This change requires no extra player signature, approval dialog or new economy value. It does not
reconcile already-confirmed historic rows or solve funding accepted
after the existing two-hour absence timeout. Review those separately before release; late payments
must be reconciled to their original agreement, not retried as a new purchase blindly.

### Durable delivery and refund recovery

`server/market/delivery.mjs` uses a renewable, fenced database lease for the configured chain and
escrow. Each operation's immutable signed bytes, hash, signer/configuration identity and outcome
are stored in `mk_delivery_attempts` before broadcast. Restart recovery queries that hash, or
rebroadcasts those exact bytes; it never silently signs a replacement after an unknown outcome.
A definitive FINAL contract rejection permits a new attempt after backoff. Ambiguous or incomplete
receipts remain pending and block later publisher nonces until reconciled.

A withdrawal is delivered only when the matching FINAL transaction links the escrow's start event,
the configured token's transfer to the correct account for the exact amount, and the escrow's
successful callback. A successful outer transaction returning zero is not payment: if receipt
evidence proves token failure and restored credit, retry automatically with capped backoff, without
an attempt-count cutoff. A lost final reply is acknowledged from its recorded hash, without paying
again. A new credit obligation cannot disappear into a push whose credit is being read, signed or
sent. An unattempted push with no current credit is retired as `no_current_credit`, not as evidence
of historical delivery. Receipt verification relies on a trusted configured RPC and reviewed WASM.

The additive `task-market-delivery` schema is part of the schema/backup catalog. Keep its rows and
signed bytes private and preserve them with the same consistent database snapshot. Old attempted
operations without this journal, exhausted operations, expired unknown transactions and signer
changes need operator reconciliation; no error-string heuristic or guessed `approve_task` fallback
may turn them into success. Existing `sent` rows are not retroactively validated. Core exploration,
demo balances and existing player confirmations are unchanged; settlement can remain pending.

| Market event | Escrow call |
| --- | --- |
| task posted / counteroffer accepted | player `ft_transfer_call` kind `task` (the counteroffer extra is its own escrow task with the worker as assignee) |
| auto-checked completion | `approve_task(id, worker)` |
| proof waits for review | `open_dispute(id, worker)` holds the slot |
| review approved / timeout / moderator pays | `resolve_dispute(id, worker, true)` (or `approve_task` without a hold) |
| review rejected / moderator rejects | `resolve_dispute(id, worker, false)` |
| task cancelled or expired | `cancel_task(id)` (refunds every unpaid slot and its fee to the poster) |
| Secret reveal (paid) | player `ft_transfer_call` kind `secret`; then `confirm_visit`, `release_secret` after 7 days, `dispute_secret`, `resolve_secret` |
| sponsored Secret | sponsor funds a `task` with a slot per visit; each finder visit is `approve_task`; closing is `cancel_task` |
| conditional send | player `ft_transfer_call` kind `transfer`; `confirm_transfer`, `release_transfer`, `confirm_transfer_gps`, `decline_transfer`, `refund_transfer` |

Limits that come from the escrow: a task pays at most 50 completions over all rounds; an account is
paid once per task (also across recurring rounds); a sponsored Secret funds 1–50 visits; a sender
gets an unreleased send back only after it expires (the receiver can decline sooner). Everyone who
moves QGOLD needs a NEAR account (the explorer account is created at login).

| Flow | Who pays | Fee to treasury |
| --- | --- | --- |
| Task | poster pays reward + 10 % on top | 10 %, only when a completion is paid; refunds return reward and fee |
| Secret (paid) | buyer pays the price | 10 % taken from the price; creator gets 90 % |
| Secret (sponsored) | sponsor prepays visit rewards + 10 % | 10 % per paid visit |
| Conditional send | sender | none |

No paid chance: nothing here is a lottery or a prize draw.

## Tasks

- **Types:** go, photo, deliver, meet, collect, event, answer, create, recurring, chain.
  - The server checks go, meet, collect, event and deliver by GPS at the pin (20–500 m).
  - Answer tasks store only a hash of the answer and pay automatically when it matches.
- **Visibility:**
  - `public` is listed in Explorer · Nearby within 5 km.
  - `link` can be opened by anyone with `/#task=<id>`.
  - `private` needs `/#task=<id>&k=<key>`.
  - `user` is for one named player (player id or NEAR account).
  - `group` is for 2–20 players.
- **Payout modes:**
  - `auto` pays as soon as the server has verified the completion.
  - `review` waits for the poster. Proof that is not reviewed within 72 h pays the worker.
  - `best` lets the poster pick the winners.
- **Slots:** 1–50 per task.
  - Recurring tasks run 2–12 rounds, with the slots limit applying to each round.
  - A chain step opens only after you are paid for the step before it.
- **Interactions:**
  - A reservation holds a slot for 3 h.
  - A counteroffer (up to 10× the reward) is accepted by the poster, who pays the difference + 10 %.
  - Messages.
  - Reject, then dispute (within 3 days), then a moderator decides.
  - 1–5 star ratings both ways.
- The poster can close a task at any time and get back unpaid rewards with their fee. This is blocked
  while proof is waiting for review or a dispute is open.

## Secrets

- The creator must stand within 150 m of the place when hiding it.
- Others see only a fog circle of 500–1000 m. Its centre is offset by 20–60 % of the radius, so the
  circle does not give the place away. They see "?" while they are inside it.
- A reveal shows the text and the exact place.
- The creator is paid 90 % after the buyer's GPS visit (within 60 m), or after 7 days without a
  dispute. A moderator can refund a disputed reveal.
- **Kinds:**
  - `place`;
  - `route`, 2–30 points, where the visit is the last point (server only for now);
  - `sponsored`, free to reveal, and each finder gets the sponsor's visit reward;
  - `private`, shown only with `/#secret=<id>&k=<key>` and never listed.

## Conditional sends

- **Release conditions:**
  - `both_confirm`: both sides confirm.
  - `after`: a date arrives. It releases by itself.
  - `gps`: the receiver reaches a place.
- The receiver can decline at any time.
- Unreleased sends return to the sender at expiry (1–60 days).

## API

All routes are under `/api/market/` and need a session.

| Method | Route | Use |
| --- | --- | --- |
| GET | `nearby?lat&lng` | Explorer · Nearby data |
| GET | `task?id&k` | Read a task |
| GET | `secret?id&k&lat&lng` | Read a Secret |
| GET | `transfers` | List conditional sends |
| GET | `stats` | Escrow totals, fees and the invariant |
| POST | `tasks` | Create a task |
| POST | `task/reserve` | Take a task, or send a counteroffer |
| POST | `task/accept-offer` | Accept a counteroffer |
| POST | `task/submit` | Send proof |
| POST | `task/review` | Approve or reject proof |
| POST | `task/dispute` | Open a dispute |
| POST | `task/resolve` | Moderator decides a dispute |
| POST | `task/cancel` | Close a task and get the rest back |
| POST | `task/message` | Message about a task |
| POST | `task/rate` | Rate the other side |
| POST | `secrets` | Hide a Secret |
| POST | `secret/reveal` | Reveal a Secret |
| POST | `secret/visit` | Confirm a visit |
| POST | `secret/dispute` | Dispute a reveal |
| POST | `secret/resolve` | Moderator decides a dispute |
| POST | `secret/close` | Close your Secret |
| POST | `transfers` | Create a conditional send |
| POST | `transfer/act` | Confirm, arrive, decline or cancel a send |

Moderators are `MARKET_MODERATORS` (player ids or NEAR accounts, comma separated), plus
`CREATOR_MODERATORS`.

## Invariant

Every QGOLD that leaves a player sits in the escrow contract until it is paid or refunded; the
contract asserts `total_held == escrowed + credits + pending` after every change. The database
mirrors it: closed rows hold nothing (`marketInvariant`). `tests/task-market.test.mjs` checks each
flow's escrow calls; `contracts/qgold-escrow/src/tests.rs` checks the money.

## Not yet

- Drawing Secret fog circles on the map; for now they are in the Nearby list.
- Creating route Secrets from the UI.
- Photo upload for task proof; proof is text with a link for now.

## QGOLD hand-off (from the vault stream, PR #174)

- QGOLD is a standard NEP-141 token with 6 decimals, and the vault contract issues it. The planned
  testnet account is `questlayer-qgold-vault-20261104.testnet`.
- The escrow receives QGOLD through `ft_transfer_call`.
- Before anyone can receive QGOLD they need a `storage_deposit` on QGOLD (0.00125 NEAR). That covers
  the escrow account, the treasury, and every player who withdraws.
- Fees stay in QGOLD and are credited to the treasury account (`questlayer-dev-20261101.testnet` on
  testnet).
