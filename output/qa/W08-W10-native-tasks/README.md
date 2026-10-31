# QuestLayer — native walking collection and sponsored-task escrow

31 October 2026. English product implementation; testnet only. This slice does not pass the complete W06/W08/W10 release gates.

## Before / after / why

- Before: native street coins required individual collection actions. After: an explicit **Collect as you walk** control submits one nearby real-GPS visit at a time, pauses off-map/offline/hidden/during manual actions, and reports only confirmed session rewards. Why: the walking loop can continue without repeated coin dialogs while retaining the same authoritative receipt and funding rules.
- Before: Community tasks used demo GOLD. After: a separate **NEAR testnet** tab supports a funded task, exact funding review, public text evidence, ordered sponsor decisions, appeal, named arbitration, closure and pull withdrawal. Why: a sponsor's prize is actually reserved on NEAR and cannot be withdrawn while a timely participant still has rights.
- Before: no native task deadline or refund lifecycle existed. After: permissionless finalization preserves earlier pending/appealed evidence and eventually assigns a winner or refunds the sponsor. Why: a stopped application server cannot permanently strand the task escrow.
- The funding review names the exact prize, the separate non-refundable storage contribution and network costs. A wallet cancellation preserves entries. Heading focus and Escape support return from review to the same filled form; input controls retain keyboard ownership.

## Verification

- `npm test`: **212/212 application tests passed**, recorded in `tests.txt`. This includes 22 collection tests, 20 task adapter/quote tests and two new reward-publication tests.
- `bash scripts/build-contracts.sh --test`: **100 Rust tests passed**, including 31 new task-contract cases. Independently repeated task review passed all 31 contract and 13 adapter/quote tests. Existing contract sources were not changed.
- `npm run build`: passed, recorded in `build.txt`.
- New WASM SHA-256: `f5eef080158fa4b7e7ccd950365421fffe5d4d911fe4827906c9bf056ccdc2c1` (236,938 bytes). Contract account: `questlayer-tasks-20261031.testnet`; code hash: `HZ2CuM9zpNP23ZbNdpwNKy5fjhAs3hxy3nxo4trXqBTv`. Deployment key removed before funded tasks; live account has no access keys.
- Storage unit fixtures measured 1,441 bytes/task and 2,599 bytes for the maximum submission/review/appeal/credit/withdraw lifecycle. Each explicit 0.05 test NEAR storage contribution covers 5,000 bytes at the contract's tested storage price. Account code storage is separately subsidized.

### Actual testnet evidence

See [deployment.json](deployment.json), [native-tasks-proof.json](native-tasks-proof.json) and the public copies in `public/`.

Three project-wallet flows ran against the deployed contract through the verified server quote adapter:

1. Fund → submit → sponsor approve → repeat finalization → claimant withdrawal; no duplicate award.
2. Fund → cancel before evidence → exact sponsor refund → withdrawal.
3. Fund → submit → reject → cancel → participant appeal → arbiter approve → claimant withdrawal. Cancellation retained the timely appeal right.

Total reward deposits 0.003 test NEAR: 0.002 awarded and 0.001 refunded; all 0.003 withdrawn, with zero remaining escrow, credit or pending transfer. Separate storage funding 0.25 test NEAR and 3 yoctoNEAR withdrawal authorization deposits are not reward income. Conservation passed. The live proof uses synthetic public text and project-owned accounts; it does not establish physical presence, trustworthy real-world evidence or wallet UI behavior.

### Rendered interface checks

Using `/dev/native-tasks.html`, inspect 390×844 and 360×640 mobile layouts, 844×390 short landscape and enlarged 32px form text. `landscape-layout.json` records all measured buttons/fields at least 48px tall; `enlarged-layout.json` records 390px document width and no overflowing descendants. Screenshots include evidence entry, exact funding and enlarged text. Cancellation preserved the submitted text; Escape returned from Review funding to the filled form and focused Sponsor a task.

The deployed page was also inspected at 390×844 and 1280×720: the three real closed testnet records loaded, winner identity matched the chain, automatic walking collection stayed off for the guest, and no browser console errors were reported. Completed awards are historical outcomes; any remaining credit/pending withdrawal is read separately in the recipient's task wallet.

These are desktop-browser viewport checks, not physical iOS/Android acceptance or an assistive-technology audit. The enlarged-text fixture is not native operating-system text scaling. GPS/anti-spoofing and real mobile wallet return remain open.

## Policy boundaries

- GOLD remains a NEAR display denomination, not a new token. Game-yield allocation remains 50/50; sponsored-task escrow never draws on player stake or either game reward bucket.
- Pilot bounds: 128 lifetime tasks, 32 submissions/task, 1 test NEAR maximum prize, 1 hour–14 day submission deadline, 0.05 test NEAR task storage and 0.05 submission storage. Storage contributions are separate and non-refundable; gas is extra.
- Sponsor review: until due+48h. Rejection appeal: 24h, capped at due+72h. An unreviewed participant may appeal between due+48h and due+72h. Arbitration closes at due+120h. The chain's execution order defines receipt order.
- The arbiter is a fixed trusted project account. No automatic system claims to establish the truth of evidence. If an appeal is unresolved at the final deadline it expires under the disclosed policy; an earlier still-live right blocks later payout.
- Public text/reference/hash is an immutable public summary. Private photos, precise GPS, moderated evidence access, creator XP commitments, follows, donations, paid entitlements and creator-fund allocation remain separate unfinished milestones.

## VPS release

Released to `https://questlayer.promptstudio3000.com/` as `20261031T151616Z`, with the previous runtime and private database/service-key backup retained on the same VPS. Service active/running; worker error null and queue empty at the release check. Public health and both task proof/manifests return 200; unauthenticated task API returns 401. See `deployment-final.txt`, `server-state.txt` and `public-verification.json`.

No mainnet transaction or user wallet credential was used.

The final UI follow-up resets the panel scroll position when switching sections, while keeping the selected adventure. Live navigation from a task panel scrolled to 613px back to Explore produced scrollTop 0 and a fully visible heading (145px inside a panel beginning 112px); see `panel-navigation.json`.

The existing economy was re-observed at 15:11 UTC: epoch 5399, position unlock 5402, no owner cash ready and realized game yield paid 0. The new sponsored escrow did not change the game treasury allocation.

### Wallet receipt confirmation follow-up

The installed wallet SDK defaults to optimistic execution. The task client now passes the original reviewed quote and returned transaction hash to a read-only confirmation endpoint. It checks finalized testnet execution, exact signer/receiver/method/arguments/gas/deposit and the withdrawal callback result before clearing form entries. A failed withdrawal is not shown as paid. The original quote may have expired because this confirms an already executed action; it never authorizes another transaction.

Seven additional adapter tests cover substituted receipts/quotes, optimistic or failed results, restored withdrawal credit, revoked wallet linkage and bounded RPC reads. `receipt-confirmation.json` records a real read-back of the completed appeal withdrawal, acceptance of its expired display context and rejection of an altered deposit; no new transaction or key was used. This is programmatic confirmation evidence, not mobile wallet acceptance.
