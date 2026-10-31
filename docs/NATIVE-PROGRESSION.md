# Confirmed native progression and level Auras

31 October 2026. Implemented server slice for W02, W04 and W06; this document does
not close any milestone or establish a physical walking test.

## Player problem and boundary

A native GPS reward could already credit XP to the rewards contract, but the main
arena level used a separate demo ledger. Adding those numbers together would make
unconfirmed or simulated play look like native progress. A native account now has
its own confirmed XP, level and supported cosmetic milestones. The arena keeps its
existing progression. Native GOLD, reward withdrawals, weighted staking tiers and
Base appearances are unchanged.

The projection reads `get_account(account_id).xp` on the pinned rewards contract at
a finalized NEAR testnet block. It never reads `players.xp`, demo inventory, accepted
GPS evidence or local reward-worker receipt status. Consequently, the server cannot
grant native XP by changing a guest's demo level or relabeling a pending receipt.

## Supported progression

The level threshold is `100 × (level − 1)²`. Thresholds and XP arithmetic use exact
integers; API quantities are decimal strings. Current levels continue above four,
but this version supports exactly three native collectible milestones:

| Level | Required confirmed XP | Native edition | Reward          |
| ----- | --------------------: | -------------- | --------------- |
| 2     |                   100 | `polar`        | Northern Lights |
| 3     |                   400 | `moon`         | Moonwake Aura   |
| 4     |                   900 | `gold`         | Sunlit Aura     |

A milestone is eligibility to claim a cosmetic while its native edition has supply.
It is not a reserved NFT, monetary reward, guaranteed resale price or tier upgrade.
Each edition's existing 256-token cap is shared with other supported award routes.
A full edition leaves the player's level intact and reports `sold_out`. Supply can
change between quotation and wallet execution; the contract enforces the final cap.
Levels above four have no promised item in this release.

The current native rewards V1 contract has no creator XP lock. `lockedXp: "0"`
describes that contract's present capabilities. Before enabling native creator
publication, add authoritative earned/locked/available XP and base the current level
on available XP, preserving these immutable grant identities. Never substitute demo
creator locks into this projection. XP return/republication must not replay a grant.

## Service and API integration

`server/native/progression.mjs` exports:

- `NativeProgression(nativeRewards, nativeCollectibles, awardSigner, options)`.
- `nativeLevelProgress(xp)` for exact curve arithmetic.
- `nativeLevelClaimId(sourceContractId, collectiblesContractId, accountId, level)`.
- `NATIVE_LEVEL_POLICY` (`native-xp-level-v1`) and the three immutable milestones.

Options support a reviewed `collectiblesCodeHash`, or `collectiblesWasmSha256`
converted from hexadecimal SHA256 to the NEAR base58 code fingerprint. The latest
V3 deployment record is `public/native-claims-testnet.json`; the older
`native-wardrobe-testnet.json` describes V2 and cannot authorize V3 mint claims.
The native rewards source uses `nativeRewards.config.codeHash`. Missing or changed
collectible code disables claims while allowing independently verified XP to remain
readable. Missing or changed reward-source code makes the XP observation unavailable
or explicitly stale.

Every public method requires the exact account to be linked to the requesting player.
No account argument means a validation error, not an automatic fallback to another
wallet. Linking is checked again after asynchronous observations and before issuance.

### `snapshot(playerId, accountId)`

Returns `status: available | stale | unavailable`, network/account/source contract,
collectibles contract, policy, `xp`, `level`, `levelStartXp`, `nextLevelXp`,
`xpToNextLevel`, `lockedXp`, `observedAt`, `blockHash`, `blockHeight`, and milestones.
An unavailable first read has null XP/level. A stale read preserves the prior exact
XP and its original observation time; it cannot authorize claims. Each milestone
contains level/name/edition/required XP, deterministic `claimId`, `state`,
`claimable`, token ID where established, and remaining supply when observed.

Milestone states are `locked`, `available`, `issued`, `minted`, `sold_out` or
`unavailable`. An expired issued voucher remains the same entitlement; issuing
again renews its expiry without generating a new claim ID. `confirmedPreviously`
and an old token ID may accompany an unavailable observation; they describe durable
history, not current availability or current ownership.

### `issue(playerId, accountId, level)`

Performs fresh chain reads. Supported, earned, unminted and nonexhausted milestones
return the existing `NativeAuraClaim` shape: `state`, `claim_id`, `receiver_id`,
`edition`, `expires_at`, `signature`, `contractId`, optional `token_id`, plus
`network`, `sourceContractId`, `policy`, `level`, exact XP and observation metadata.
The canonical Ed25519 message is the existing `awardMessage`. `block_hash` is the
durable grant observation field. A previously minted claim returns `minted` with
an empty signature; it does not ask the wallet to mint again.

The client must validate the selected account, network, contract, source, supported
level/edition, policy, expiry and claim identity before requesting `redeem_aura`.
Only the player's wallet can sign that transaction. The service's attestation key
is not a player wallet access key. No demo item ID is required or created.

### `confirm(playerId, accountId, level)`

Reconciles the immutable finalized native claim receipt. A returned `issued` state
is not a successful mint. Confirmation never assumes that a successful wallet UI
or a locally stored transaction hash establishes finality. A minted receipt remains
consumed after the NFT is transferred: current ownership determines equipment and
market rights, while the original receipt determines once-only progression.

## Durability and failure handling

`native_level_observations` stores one authoritative latest observation per rewards
contract/account. `native_level_awards` stores a unique network/source/collectibles
contract/account/level right. Neither table keys a grant by guest profile or cookie.
The claim ID hashes policy, testnet, both contracts, receiver and level. Relinking,
a new guest cookie, concurrent retries, service restarts, expiry and restoring a
missing local mint acknowledgement all resolve to that same on-chain claim.

Keep this identity stable across future policy upgrades. Contract/source migrations
need an explicit reconciliation plan; pointing at a different rewards contract must
not silently reissue old level rewards.

All observations query the same finalized block and verify response hash/height.
The service checks testnet identity, synchronization, fresh block time, reviewed
code fingerprints and contract versions. It rejects decreasing XP, backward
finality, conflicting hashes at one height and changed XP at the same block. It
also rejects rounded unsafe numeric XP. It does not use an RPC response as a
cryptographic light-client proof; the configured RPC remains a trust dependency.

Collectible signing requires the deployed V3 `get_award_signer` to match the
application's existing public attestation key. Mismatched recipients/editions/token
IDs, an immutable mint disappearing or a changed token ID disable claiming until
reconciliation. RPC failures preserve clearly stale progress and never authorize
an award. A previously signed voucher remains valid until its bounded 15-minute
expiry; it is not retrospectively revoked by a later observation failure.

## Validation and remaining work

`tests/native-progression.test.mjs` covers thirteen grouped scenarios: exact curve
boundaries/u64 limits; demo/pending isolation; canonical signatures and identity;
relink/multiple wallets; expiry/retry/restart; minted receipt recovery and transfers;
RPC outage/timeouts; network/code/anchor/time/precision failures; finalized-state
regressions; edition caps and attestor authorization; tampered/disappearing receipts;
unlink during RPC; and the deployment fingerprint encoding.

The focused native progression, existing Aura voucher and collectible tests pass
25/25. No contract code or deployed state was changed by this server implementation.
It creates no on-chain profile field and merges no demo progression. Actual UI
integration, an ordinary player end-to-end testnet mint, physical GPS evidence,
real-device UX and the later native creator XP-lock model remain separate acceptance
work. Any synthetic GPS pilot must be labelled as such and cannot establish a real
walk or anti-spoofing effectiveness.

## Prepared live testnet rehearsal

`scripts/prove-native-progression.mjs` is prepared, syntax-checked, and has not been
executed as part of this module's validation. It requires an explicit
`--synthetic-gps` flag, localhost QA API, the fixed project-owned
`questlayer-pilot-20261031.testnet` account and the existing private project key.
It will not create an account, acquire faucet funds, open a vault or sign for a
personal wallet. `PROGRESSION_API_URL` and `PROGRESSION_ORIGIN` must match the local
QA service and its allowed browser origin. Configure that service with the existing
award and reward attestors; a public-key mismatch aborts before synthetic visits.

The rehearsal requires at least 82 already-confirmed native XP. It can submit at
most nine additional native-backed street coins using explicitly synthetic fixes,
waits for receipt confirmation, and requests the level-2 entitlement. It checks
network, reviewed code, deployed attestor, deterministic identity, recipient and
Ed25519 signature before signing one mint with a maximum attached storage deposit
of 0.05 test NEAR. Gas is separate; unused storage deposit is refunded by the
contract. A finalized duplicate replay attaches zero deposit and must preserve the
claim token and collection supply.

The private resumable journal records a pending visit before submission and a mint
attempt before signing. After an ambiguous mint attempt, it reconciles the chain
and refuses to attach another 0.05 test NEAR automatically. Public proof output
contains receipt/transaction identifiers and confirmed XP, with explicit synthetic
GPS provenance; it omits raw coordinates, sessions, signed vouchers and private keys.
The script can recover an already-minted entitlement, but only claims a verified
on-chain replay if a signed voucher is available and the replay actually succeeds.
