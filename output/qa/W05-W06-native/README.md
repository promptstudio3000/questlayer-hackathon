# Native funding and expeditions verification

Scope: W05/W06 experimental testnet implementation, 31 October 2026. These packages remain building. The player problem was that validator discovery, simulated GOLD and on-chain collectible proofs did not provide an actual player-controlled staking position or a funded, durable exploration reward path.

## Implemented boundary

Three Rust contracts provide isolated staking, a keyless position factory and separate 50/50-backed rewards. The server publishes immutable city manifests, attests eligible visits, persists accepted rights before signing, relays/reconciles through a restricted key and maintains staking operations. Wallet displays native balances and actions separately from the demo economy. See `docs/NATIVE-REWARDS-AND-VAULT.md` for invariants, funding, permissions, storage capacity and operating limits.

## Verification

- 112 application tests passed, including old economy/spatial invariants, native acceptance/order/retry, owner-bound vault quotes, backup keys and crash-after-chain reconciliation. `final-checks.txt` includes the final build.
- 66 Rust tests passed across six contracts. New cases include failed callbacks, actual-cash gating, high-water loss recovery, immutable older unlocks, keyless factory receipts, registration recovery, idempotent native settlement, fixed recipient withdrawals and pre-funded receipt storage. `contracts-final.txt`.
- Real testnet deployment, code fingerprints, sponsor funding, operating storage and initial 0.1 test NEAR validator deposit: `public/native-rewards-testnet.json`. Initial and reviewed-upgrade logs are historical; the public manifest is authoritative for currently reviewed bytecode.
- The completed live API/factory/withdrawal rehearsal is recorded in `live-pilot.json`: a keyless position, 0.01 test NEAR delegation and queued exit, 82 XP and a 0.000001 test NEAR reward withdrawal. Synthetic GPS must not be described as a physical walk or anti-spoofing evidence.
- UI inspected in the in-app browser at 360×800, 390×844, 844×390 and 1280×720. No document horizontal overflow in those layouts; essential new buttons measured at least 48 px. Actual wallet and map-target screenshots are included.
- The real staking component was exercised in a development-only fixture with 20 px enlarged text and a 390×420 reduced-height viewport. Negative amount disables signing and explains the problem. A simulated wallet cancellation preserves the entered 0.002 amount. Keyboard focus moves from the amount to the position link. This is layout/focus evidence, **not a physical on-screen keyboard or wallet-provider test**.
- Labels were measured as rgb(228,219,245) on rgb(33,27,53); a long account remains in one clipped native select line without breaking the layout. The fixture contains explicit example values and no chain mutation.

## Before / After / Why

| Before (source/observed) | After (source/observed) | Why / evidence |
| --- | --- | --- |
| Wallet primarily exposed simulated stake and read-only native pool discovery | Separate native expeditions and real position actions above the retained demo panel | `src/NativeExpeditions.tsx`, `src/NativeStaking.tsx`, wallet screenshots; native funds are not inferred from demo GOLD |
| No native funded city manifests or accepted-rights queue | Six contextual three-stop walks, shared micro-coins, consent, immutable commitments and signed durable receipts | `server/native/reward-manifest.mjs`, `rewards.mjs`, `reward-worker.mjs`; tests and live proof |
| A successful pool call could be confused with received cash | Vault waits for epoch/release, zero remaining pool unstaked balance and the exact expected balance increase | `contracts/vault/src/lib.rs`; cash gating and loss tests; full epoch cycle still open |
| Initial compact map hid the new native objective and retained the unrelated demo recommendation (observed during this change) | A visible native objective opens its task and can be cleared; the demo recommendation yields while selected | `src/App.tsx`, `src/style.css`, `src/styles.css`, `native-objective-360.png` |
| Native amount failure was only explained above the long form | Inline validation disables the deposit action; the valid entered amount survives cancellation | `src/NativeStaking.tsx`, fixture interaction evidence |
| Large text wrapped long selected account names; inherited labels were too muted (observed in fixture) | Single-line select with bounded width and explicit high-contrast labels | `src/styles.css`, `staking-large-text.png` |

## Remaining gates

Real validator release and beneficiary withdrawal after the required epochs, a measured realized-yield cycle, independent contract/governance/catastrophic-callback review, reviewed mainnet economics, contribution changes and partial exits, mature retained-profit tier accounting, stronger GPS evidence, field review of every location, physical iOS/Safari and Android/Chrome with actual wallets, and full host-replacement disaster recovery. The bounded native snapshot rehearsal passed: one confirmed receipt recovered from chain after losing its local acknowledgement, zero transmissions, valid restored service credentials, and no live state changes (`restore-rehearsal.txt`). The pilot's 3.52 test NEAR setup, 32-position limit, 256 native receipts/day and 0.4 test NEAR worker allowance are deliberate testnet constraints, not final onboarding economics. No mainnet operation or personal signing key is involved.
