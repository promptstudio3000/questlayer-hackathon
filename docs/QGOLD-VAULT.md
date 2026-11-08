# QGOLD vault

Stream 1 of the approved QGOLD build (`/mnt/project-files/tokenomics/QGOLD-BUILD-PLAN.md`, design doc
"QGOLD: návrh ekonomiky"). Testnet only and unaudited. Mainnet needs Lubos's explicit go, an external
audit of this contract and a legal opinion on the token.

## What it is

`contracts/qgold` is one contract that is both the QGOLD token and the vault that backs it.

- **Token.** A transferable NEP-141 with 6 decimals and NEP-145 storage (0.00125 NEAR per holder). Any
  holder can call `ft_burn({amount, memo})`, and that is how in-game spending works.
- **Backing.** Every QGOLD is a share of `backing`, the NEAR this contract holds for it.
  R = backing / supply, in yoctoNEAR per whole QGOLD. The initial R is 0.001 NEAR.
- **Why one contract.** The burn, the payout and R are all decided in one synchronous call, so a
  cross-contract race can never pay out against a burn that did not happen. The minter is the vault itself.
  The ledger no longer mints QGOLD (see "Hand-off" below).

## Money in

| Call | Who | Price | Fee |
|---|---|---|---|
| `mint_for({account_id, memo})` + NEAR | approved minters only (the rewards contract) | exactly R | none |
| `deposit({min_out, receiver_id?})` + NEAR | anyone | R + 1 % | 1 % |
| `fund_insurance()` + NEAR | anyone (10 % of outside fees) | – | – |

These are the only mints. A mint always adds its NEAR to the backing in the same call, so QGOLD without
backing cannot exist.

A collected coin pays QGOLD like this. The player (or the game) calls `withdraw` on the rewards contract,
as before. The rewards contract then sends the player's NEAR credit to `mint_for` instead of to the player,
and the player receives b/R QGOLD. If the vault refuses (for example while it is paused), the callback puts
the exact credit back. The rewards contract sets its vault with `set_qgold_vault` once, and it can never
be changed after that, so nobody can redirect players' rewards.

## Money out

`redeem({amount, path, min_out})` with 1 yocto works in this order:

1. It burns the caller's QGOLD first. Only the caller's own balance can be used.
2. It takes their share, gross = amount × backing / supply, rounded down.
3. It pays gross − 1 %.

| path | what happens |
|---|---|
| `near_instant` (default) | Paid at once if it fits both caps. Otherwise it is queued automatically. |
| `near_queue` | Always queued. |
| `lst` | Not enabled yet (see "Not in this release"). |

**Caps on instant exits.** Both caps are counted over 24 h windows, measured against the backing at the
start of the window, and changed only by the council with the timelock.

- Global cap: 5 % of the backing, but at least 1 NEAR so a young vault is still usable.
- Per-account cap: 1 % of the backing, but at least 0.2 NEAR, and never more than the global cap.

**Queue.** A queued exit holds its gross NEAR outside the backing, so R does not change. It can be claimed
after the safe window (24 h by default, bounded to 24–48 h). Anyone may call `claim_exit({exit_id})`, but
the NEAR goes only to the account that burned. If a payout transfer fails, the NEAR becomes a claimable
exit again, with no second fee.

A queued exit must be worth at least 0.005 NEAR after the fee. That first 0.005 NEAR (`EXIT_STORAGE_BOND`)
is a storage bond: it is not counted as owed while the exit record exists, so the record never costs the
vault's operating balance, and it is paid back as part of the claim. `get_state().exit.queue_bonds` shows
the bonds held. A fee-free retry smaller than the bond is bonded in full and still paid in full.

**Dust supply.** A burn or redeem leaves either no supply at all or at least 1 QGOLD (`MIN_SUPPLY`).
Without this rule one early holder could burn all but one unit, leave R at backing per unit (about a
billion times the start) and make every later coin mint zero.

**Quotes.** `quote_redeem({account_id, amount})` tells the UI whether an exit would be instant.
`get_account_exits({account_id})` lists that account's open exits.

## Fees

The deposit and redeem fees are 1 % each. Of every fee, 10 % goes to the insurance fund and the rest to
`treasury_due`. `flush_treasury()` sends `treasury_due` to the fixed treasury account. Anyone may call it,
and it pays nobody else.

## Safety rules (Lubos's hard requirements)

- **Nobody gets what is not theirs.** Every payout follows a burn of the payee's own QGOLD, at most
  their exact share. There is no admin withdraw, and no method sends NEAR to an address the contract
  chose itself.
- **R never falls through a call.** Mints round down and redeems round down. A burn raises R. When
  supply reaches 0, any leftover backing moves to the insurance fund, so the next minter gets no gift;
  `r_peak` then returns to the initial R, because with no holders there is nobody whose R the peak
  protects, and the next minter is backed only by their own NEAR.
- **Invariant check on every change.** `after_change()` asserts this:
  balance ≥ backing + insurance + treasury_due + queued exits (less their bonds) + refundable storage
  deposits + unconverted game earnings + storage cost.
  If any bug drains NEAR, every later state change fails, so the vault freezes itself.
- **Recovery after an incident.** `reconcile()` (anyone may call it) books the shortfall of *money owed*
  against the insurance fund first and against the backing second. It then refills the backing from the
  insurance fund back to the highest R reached (`r_peak`). Storage that outgrew the operating balance is
  reported (`storage_shortfall`) but never booked as a loss: it keeps the vault frozen until
  `fund_operating()` (see "Storage and the operating balance").
- **Monitor.** `audit()` is the invariant monitor. Its `ok` field means the balance covers everything
  owed and R is at or above its peak; `operating_slack` is what is left for sponsored storage.
- **Pause only.** The guardian, or any council member, can `pause()` for at most 72 h. A pause stops
  mints, transfers, burns and exits, but moves no funds. One account can start or extend a pause only
  once per 7 days (`PAUSE_COOLDOWN_MS`), so a single compromised key cannot keep the vault paused; another
  guardian or member must take over. `unpause()` ends a pause once `threshold` council members have
  voted on it (one member, when the threshold is 1).
  - While paused, a council member can `void_exit` a queued exit. The NEAR goes back to the backing, and
    the same QGOLD is minted back to the same account, so nothing leaves the contract.
- **Council and 48 h timelock.** The council is a multisig with a threshold. All of these go through
  `propose` → `approve` → 48 h wait → `execute` or `apply_upgrade`:
  - upgrades, by the sha256 of the code;
  - changes to the parameter bounds;
  - changes to the guardian, treasury, minters or council.
  - The timelock is a constant in the code.
  - `cancel` works for the proposer alone, or once `threshold` members have voted to cancel
    (`get_cancel_votes`); one member cannot veto the others' proposals.
- **No access keys.** The deploy script deletes the vault account's full-access key. Code can then change
  only through the council and the timelock.

## Server and health

`server/native/qgold-vault.mjs` reads `get_state` and `audit` every 60 s and serves:

- `GET /api/qgold`: state, audit, the monitor's verdict, token and method names from the manifest.
- `GET /api/qgold/account?account=…`: balance, NEP-145 registration, and open exits with a
  `claimable` flag.
- `/api/health` → `qgoldVault`: `ok`, `paused` or `impaired`, with issues `balance-short`,
  `rate-below-peak`, `backing-below-supply-at-peak` and `no-backing`. It also gives R, supply,
  backing, insurance and the queue.

The contract comes from `public/native-qgold-vault-testnet.json` or from `QGOLD_VAULT_ACCOUNT`.
`QGOLD_VAULT_ENABLED=0` switches the reader off.

## Deploy (Mac, operator key)

```
bash scripts/build-contracts.sh          # or the CI artifact; hashes must match contracts/wasm-sha256.json
node scripts/deploy-qgold-testnet.mjs --reviewed
```

The script does these steps in order:

1. Creates `questlayer-qgold-vault-20261104.testnet`.
2. Initializes it with council = operator (threshold 1), guardian = operator, treasury = operator and
   minter = the rewards contract.
3. Tops up the operating balance to 1 NEAR.
4. Deletes every access key.
5. Upgrades the rewards contract in place, with a backup of the old WASM, and checks that its treasury
   reads back unchanged.
6. Calls `set_qgold_vault`.
7. Runs a smoke test: deposit, then burn, then an instant redeem, with the audit ok and R not lower.
8. Writes `public/native-qgold-vault-testnet.json` and the new rewards code hash.

Then commit both manifests and `contracts/wasm-sha256.json`, and deploy the VPS.

## Hand-off

- **Ledger (PR #163).** QGOLD is no longer minted by the ledger. Keep `set_gold_token(None)`; the ledger
  records the GOLD amount in its memos only. The old soulbound `questlayer-qgold-20261104.testnet` and
  `contracts/soulbound-ft` are retired. The ledger thread removes them from its deploy script.
- **Token page and market (stream 2).**
  - Buy with `deposit`. Sell with `redeem`.
  - Read numbers from `/api/qgold`.
  - The keeper buys with `deposit` like everyone else (1 %). It burns bought-back QGOLD with `ft_burn`.
    When the market price is below R, redeeming at R − 1 % is the arbitrage that pulls the price back.
- **Task market and Secrets (stream 3), GOLD spending (stream 4).**
  - Escrow contracts receive QGOLD with `ft_transfer_call` and must call `storage_deposit` first.
  - Spending is `ft_burn` with a memo (for example `"npc gear aura-17"`).

## Not in this release

- **LST backing.** The plan holds the backing in stNEAR and LiNEAR plus about 10 % NEAR, and sends their
  staking yield to the daily budget. Testnet LST prices are frozen
  (see the yield status of 3 Nov), so this release holds the backing in NEAR. The `lst` exit path and
  `get_state.lsts` stay empty until the next release adds the LST strategy behind the same interface.
- **Mainnet.** The contract refuses `new` on any account outside `.testnet`.

## Local security candidate: sponsored registration

`storage_deposit_sponsored(account_id)` is an explicit application-funded lifetime
grant of 0.0025 NEAR (`SPONSORED_STORAGE_FEE`: the holder record plus the grant
marker). It is not refundable to anyone, so it is not booked as an obligation; it
stays on the balance and pays for exactly the storage it created. The marker
survives empty-holder unregister/register cycles; the recipient cannot withdraw the
grant as NEAR. Repeated grants refund the sponsor. Standard NEP-145 `storage_deposit`
(0.00125 NEAR) remains refundable to the holder, including when a sponsor
subsequently encounters an already registered player. Existing root Borsh layout is
unchanged; the grant map uses a separate `sg` prefix. Grants recorded before this
change were added to `storage_deposits` and are not reclassified: that only
over-reserves. The paired escrow candidate requires this token method before its
`withdraw_for` path can run. Release hashes and on-chain state have not been updated
or inspected.

## Storage and the operating balance

Every record the vault stores is paid by someone, or bounded (security review of
8 Nov 2026, H2):

| Record | Paid by |
|---|---|
| Holder record of `deposit` / `storage_deposit` | the holder's refundable 0.00125 NEAR |
| Holder record of `storage_deposit_sponsored` | the sponsor's 0.0025 NEAR grant |
| Queued exit record | the exit's own 0.005 NEAR bond, returned with the claim |
| Instant-exit window record | freed with the holder record on `storage_unregister`; at most one per holder |
| Holder record created by `mint_for` (a player's first coin) | the operating balance |
| Game conversion receipt (`mint_with_carry_for`) | the operating balance; anyone may `prune_game_conversion` after 30 days |

The operating balance is NEAR above everything owed and the storage cost
(`audit().operating_slack`). Contract-paid storage may not take it below 0.1 NEAR
(`MIN_OPERATING_SLACK`): a `mint_for` for a new player or a world conversion then
fails with "Operating balance is low" and the rewards contract keeps the credit, while
exits, deposits and transfers keep working. `fund_operating()` (anyone, attach NEAR)
refills it and is the one call that never fails on the invariant. The deploy script's
1 NEAR top-up is this balance; `/api/health` should alert on `operating_slack`.
