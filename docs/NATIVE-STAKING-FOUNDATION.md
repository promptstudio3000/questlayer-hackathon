# Native staking foundation — W05

This increment contains a live read adapter and executable financial specifications. It is **not a deployed vault**, does not accept player deposits, does not turn demo GOLD into NEAR and cannot verify or authorize a native payment. Game money remains in the isolated demo ledger.

## Implemented code

| Owner | Implemented | Boundary |
| --- | --- | --- |
| `server/native/staking-pool.mjs` | Testnet chain check; finalized-block-pinned account, fee, pause, owner, key and delegator views; strict u128 money; net-yield quote; E+2 weighted access | No transaction, APY inference, share custody or deposit permission |
| `server/native/exit-scheduler.mjs` | One sealed batch per underlying pool/delegator context; later exits queue independently; callback IDs, failure/restart recovery, pool release gate, cash-receipt replay protection and unclassified surplus | Synthetic executable specification; a real adapter must authenticate callbacks and persist atomically |
| `server/native/treasury-model.mjs` | Exactly-once liquid-income allocation, versioned current 50/50 and future creator policy, finite backed reservations, first award and same-bucket expiry | Receipt evidence is supplied by the model caller; it is not independently verified on chain |

Use `npm run staking:probe` to read a bounded testnet watchlist. Use `npm run funding:simulate` to reproduce a synthetic two-batch funding scenario. Neither command has access to a player key or sends a chain transaction. The probe requires network access; the simulation is entirely local. Their JSON reports explicitly distinguish live views from modeled balances.

## Observed protocol, not an invented APY

The 31 October snapshot in `output/qa/W05/staking-pools.json` pins all pool reads to one finalized block and reads its validator epoch. Aurora, Stakely and TS watchlist accounts were active and keyless at that point; their reward fees differed. These are **testnet observations**, not mainnet recommendations, code audits or permanent availability guarantees. Some legitimate current testnet validators have `.m0` account names, so network verification must use the RPC chain identity rather than a `.testnet` suffix assumption.

Pool balances and total delegated stake do not establish an attributable annual yield. The adapter reports APY as unavailable. A standard pool's public interface also does not expose its internal total share count through a `get_total_stake_shares` method; the adapter does not invent that method or infer profit from total-stake changes. Future monitoring needs attributable balances plus cash-flow history, verified share accounting or a reviewed reward indexer.

## Daily accrual versus actual cash

The reference [staking pool](https://github.com/near/core-contracts/blob/master/staking-pool/src/lib.rs) distinguishes staked shares and unstaked funds. Its [unstake implementation](https://github.com/near/core-contracts/blob/master/staking-pool/src/internal.rs) updates the **delegator account's** unlock epoch on each new unstake. Therefore a daily skim on the same account can delay an older exit.

The implementation direction is sealed batches. Do not send another unstake from that pool/delegator account until the previous batch is actually received and reconciled. New player exits and later game-harvest requests stay queued; their arrival never edits the older batch's unlock. Independent reviewed strategy accounts may improve throughput later. Depositing, restaking queued funds or switching pools must not accidentally reuse an unlocking account's liquidity.

The model conservatively uses confirmation epoch + 4 and also requires the pool's actual `can_withdraw` flag. It does not convert epochs into fixed hours. The observed protocol configuration has a nominal 43,200-block epoch, but real timing and RPC/strategy availability vary. The normal 1–7-day product estimate remains an estimate. A complete live unstake/withdraw cycle is still an exit gate.

A successful pool method callback alone is not proof that the final NEAR transfer has arrived. The real adapter must reconcile the transfer outcome and available cash, while excluding unrelated deposits, storage/gas, retained yield and existing obligations. A partial or ambiguous incoming amount remains pending. Excess rounding/donations remain unclassified until attributed; they do not silently become new game income.

## Contribution, access and losses

Money uses integer yoctoNEAR throughout. One micro-GOLD is exactly 10^15 yoctoNEAR; GOLD remains a display unit. Contributions use 0–10,000 basis points (0–100%).

Access uses confirmed active tranche values, not an advertised deposit or a fixed APR. A tranche first counts at E+2. A top-up cannot erase the eligibility of older tranches. Increases in the contribution fraction mature independently; decreases apply immediately. The executable history rule is the minimum committed fraction over the maturity window, preserving staged increases while preventing an immediate decrease/reincrease from restoring access. Pool losses lower current eligible value; withdrawals remove the affected active tranches immediately in the future authoritative vault.

Net-yield quotes compare attributable value with its cash-flow-adjusted high-water basis. Recovery to that basis produces no new game contribution. Quotes remain unrealized and always report zero spendable cash. The actual contract must establish per-position shares, external cash flows, retained entitlements, proportional exits, rounding and high-water updates before accepting a deposit.

**Open accounting decision:** provisional game-fee entitlement must have an explicit loss/recovery treatment before realization. Simply transferring fee shares to a treasury on every positive mark can leave the treasury positive after the user's position falls below its recovery basis. Do not implement that shortcut as a claim that principal never funds rewards. The reviewed design must specify when fees vest, how unvested fees reverse after losses, how contribution changes close periods and how already realized distributions affect later high-water accounting.

## Confirmed game income and conservation

Only a verified, newly received **game-yield portion** may enter the current income path. A mixed pool withdrawal must classify principal, retained yield, game yield and unclassified surplus first. The model rejects other receipt kinds. A hash in the model is an integrity identifier, not a cryptographic proof that an income source is genuine; native receipt verification is still required.

Current policy splits each received amount 50/50 between coins and zones, with indivisible residual units going to zones. A future version can first take the accepted configurable creator share, then split the remainder 50/50. Policy changes affect only new receipts. Historical commitments retain their original source and amounts.

The executable invariant is, per bucket: `allocated income = available + held reservations + awarded obligations`. Expiry returns held backing only to its original bucket. It is not a new receipt. Replaying expiry, receiving a receipt twice or awarding a prize twice cannot increase money. A different beneficiary cannot steal an already awarded prize. No future income can back today's publication.

The simulation classifies 1,161 synthetic units as 1,100 principal, 20 retained yield, 40 game yield and 1 unclassified surplus. Only 40 enter game funding. Two received game receipts remain two despite retries; later requests leave the earlier unlock unchanged. A street reservation returns to its bucket once, while a zone winner's obligation stays backed. These are modeled units, not testnet earnings or transactions.

## Remaining native activation gates

1. Reproducible deployed-code/source review and an explicit funding allowlist; a successful interface probe is insufficient.
2. Reviewed share/high-water/fee/loss attribution, deposits and E+2 tranches, pool changes and storage/gas separation.
3. Authenticated asynchronous callbacks, durable operation/receipt correlation, reconciliation and bounded recovery after interrupted promises.
4. Actual cash delivery and native reward claims with receipt verification independent from the demo ledger.
5. Upgrade/permission policy, emergency paths that preserve user exits, independent financial review and a complete live exit cycle.
6. Real wallet/device flows and sustainable city reward calibration from liquid income rather than demo prize examples.

W05 remains building. This code deliberately provides no mainnet or player-fund entry point.
