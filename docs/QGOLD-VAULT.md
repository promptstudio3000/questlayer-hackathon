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
  supply reaches 0, any leftover backing moves to the insurance fund, so the next minter pays the peak R
  and gets no gift.
- **Invariant check on every change.** `after_change()` asserts this:
  balance ≥ backing + insurance + treasury_due + queued exits + refundable storage deposits + storage cost.
  If any bug drains NEAR, every later state change fails, so the vault freezes itself.
- **Recovery after an incident.** `reconcile()` (anyone may call it) books the shortfall against the
  insurance fund first and against the backing second. It then refills the backing from the insurance
  fund back to the highest R reached (`r_peak`).
- **Monitor.** `audit()` is the invariant monitor. Its `ok` field means the balance covers everything
  owed and R is at or above its peak.
- **Pause only.** The guardian, or any council member, can `pause()` for at most 72 h. A pause stops
  mints, transfers, burns and exits, but moves no funds. A council member can `unpause()`.
  - While paused, a council member can `void_exit` a queued exit. The NEAR goes back to the backing, and
    the same QGOLD is minted back to the same account, so nothing leaves the contract.
- **Council and 48 h timelock.** The council is a multisig with a threshold. All of these go through
  `propose` → `approve` → 48 h wait → `execute` or `apply_upgrade`:
  - upgrades, by the sha256 of the code;
  - changes to the parameter bounds;
  - changes to the guardian, treasury, minters or council.
  - The timelock is a constant in the code.
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
grant. Its reserve and marker survive empty-holder unregister/register cycles; the
recipient cannot withdraw the grant as NEAR. Repeated grants refund the sponsor.
Standard NEP-145 `storage_deposit` remains refundable to the holder, including when
a sponsor subsequently encounters an already registered player. Existing root
Borsh layout is unchanged; the new grant map uses a separate `sg` prefix. Historical
sponsored deposits are not reclassified automatically. The paired escrow candidate
requires this token method before its new `withdraw_for` path can run. Release
hashes and on-chain state have not been updated or inspected.
