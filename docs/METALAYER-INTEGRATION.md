# MetaLayer integration contract and owner handoff

13 November 2026. Task branch `weekend/m1-metalayer-first-expedition`, source base
`ebefd852e6b511db4b6416a79aaa08bbf683b995`. This document describes the running
local slice and the remaining owner integration. It does not activate a contract,
financial obligation, XP credit or NFT ownership. The current source patch includes
the first expedition and this continuation; do not apply the older patch as well.

## Player loop and design choice

The opening needs a reason to keep mining after one counter fills. **The Quiet
Beacon** gives the collected material a purpose, different physical actions and
one public result. The sequence is deliberately solo-completable; another player
can help with the shared construction without taking away personal story progress.

| Chapter | Player action | Confirmed result |
| --- | --- | --- |
| A light below | Accept, discover Crystal Hollow, extract ten natural diamonds | Personal expedition completion and retained diamonds |
| Echoes in basalt | Visit the quarry and hold six extracted basalt blocks | The signal chapter becomes available |
| Three forgotten signals | Visit Garden → Arch → Observatory, read clues and choose signs | Three durable personal journal checks |
| A light for everyone | Build or inspect the three-block shared marker | Public structure and one personal inspection receipt |
| Wake the quiet beacon | Approach the central altar with the diamonds and tune it | Shared lit beam and permanent personal finale |

There is no token or XP award in this slice. Materials remain in the backpack;
construction preserves the existing free-material sandbox. This avoids introducing
an unreviewed price list or an exploitable conversion into the city economy.

The owner's UI direction is to preserve the latest QuestLayer interface and
minimize the phone world view. The previous independent MetaLayer cards and
navigation appearance were removed. The implementation uses the current shared
`WorldSwitcher`, `Character`, HUD bubble/navigation classes, map settings pattern,
`DemoControls`, `MapActions`, `ScreenTabs`, buttons and native map-dialog chrome.
The only `App.tsx` edit passes world configuration and its existing Profile callback
into the Layer mount; no city interaction or financial logic is changed.

The joystick stays on the left. Actions stay on the right; the held tool appears there only when building or
aiming at a mineable block.
The atlas is folded until requested; block materials appear only while choosing
one. The default world view has one short objective/status line. Community opens
the quests, journal and onchain tabs, and detailed prose stays behind disclosures.
The current UI baseline is the fetched integration commit `ebefd852`; the public
health observation earlier in the run reported `07ddcf1b`. These are source
checkpoints, not a deployment of this MetaLayer task.

## Capabilities now and next

| Capability | Implemented now | Owner integration / acceptance |
| --- | --- | --- |
| Identity | Same authenticated platform explorer and online presence | Bind the same native account to the separate MetaLayer domain |
| World and story | Shared blocks, ore, atlas, five chapters, durable isolated receipts | Onchain event storage and a clean indexer reconstruction |
| Transaction evidence | Domain-separated hashes and a strict read-only NEAR verifier | Reviewed receiver/code/recorder configuration and actual submitted transactions |
| Proof UI | Shared ChainLink and separately labelled platform account feed | Automatic polling/outbox refs when real submissions exist |
| MetaXP | No city XP writes, no fake balance | Dedicated MetaXP contract/namespace and reviewed award rules |
| Badges | Field journal records only | Authoritative one-time eligibility and separate badge NFT collection |
| Parcels | Land explanation only, no purchase promise | 16×16 NFTs, ownership bounds, transfers carrying structures, signed settlement |
| MetaGold | Explicitly inactive | Dedicated treasury, funded emissions, balances, escrow and sinks |
| QGOLD conversion | No deposit, quote or conversion | One-way QGOLD → MetaGold with reviewed quote and exact settlement |
| Trading and player tasks | Not exposed as functional | Existing platform patterns adapted to separate assets and actor-scoped receipts |

## Why the city ledger is not called

`recordChainAction()` in `server/chain-ledger/service.mjs` only queues actions with
city XP or QGOLD and writes both through the existing city contracts. It has no
MetaLayer namespace or general block-state record. Calling it with invented XP
would alter the accepted economy and contaminate the city profile. No protected
ledger, signer, reward, identity, deployment or contract file was edited.

Reuse the reviewed platform account, signing, confirmation, outbox/retry and
explorer-link patterns. Adapt their asset IDs, contract identities and domains;
do not duplicate key storage or let the browser choose the acting account.

## Action evidence and read-only verification

`ml_actions` stores exact UTF-8 JSON envelopes with version, domain
`questlayer:metalayer`, deterministic action ID, internal layer `space`, a hashed
actor reference, action kind/time and payload. The evidence hash is SHA-256 of the
stored bytes. Mining and edits include their block effect; mining includes the
confirmed inventory and expedition. Story events have stable one-time references.
No city wallet, address, balance or location trail is exposed in the MetaLayer feed.

The local event is **not submitted**. The existing SQLite action list is an owner
integration input, not a claim that an onchain world can already be reconstructed.
A normal lost-response retry recovers the same game receipt and evidence event.

The optional verifier reads only these owner-configured values (never key files):

- `METALAYER_NEAR_CONTRACT`: reviewed `.testnet` contract account.
- `METALAYER_NEAR_CODE_HASH`: its reviewed base58 NEAR code hash.
- `METALAYER_NEAR_RECORDER`: reviewed recorder, defaulting to that contract.
- The platform `NEAR_RPC_URL`, or its existing testnet RPC default.

No value is installed or activated by this task. Missing/malformed configuration
keeps verification unavailable. The UI cannot choose another RPC, recorder or
receiver. There is no function that signs, submits, transfers or issues an asset.

The proposed `record_batch` method, with zero deposit and the reviewed recorder,
must emit this NEP-297 receipt for each accepted action:

```json
{"standard":"questlayer_metalayer","version":"1.0.0","event":"action_recorded","data":[{"action_id":"mla_...","layer_id":"space","actor":"sha256 actor reference","evidence_hash":"sha256 exact stored envelope"}]}
```

The verifier requires NEAR testnet, a recent finalized head and `FINAL` execution.
Every receipt must succeed and be reachable from the transaction execution graph.
Exactly one event must match the actor’s own action, layer and evidence, emitted
by the reviewed receiver. Inclusion/execution blocks must be finalized and the
contract code must match at execution and the current finalized head. A valid hash
or an unrelated successful city transaction proves nothing about this action.
Verification is based on the configured RPC's authenticated chain observations;
this is not a light-client proof implementation.

References: [NEAR transaction status and finality](https://docs.near.org/api/rpc/transactions),
[historical account/code queries](https://docs.near.org/api/rpc/contracts),
[NEP-297 event format](https://github.com/near/NEPs/blob/master/neps/nep-0297.md).
The protocol above is a proposed contract interface, not a claim that such a
MetaLayer contract is deployed or already supported by the city ledger.

## Economic integration sequence

1. Keep MetaXP, MetaGold and parcel/badge collections in separate domains, using
   the platform account. Review the layer IDs and every contract/code identity.
2. Implement and test the minimal ledger/event contract and immutable evidence
   storage first. Prove an actual testnet story completion transaction and recover
   it after service restart. A fresh indexer must rebuild the same accepted state.
3. Add MetaXP and one story badge with configured, one-time eligibility. A shared
   beacon completion may not award the same actor twice; city XP must stay unchanged.
4. Add the MetaGold treasury and funded quest/terrain allocations. Every emission
   must fit an available allocation and have an idempotent receipt. Regenerating
   ore, replaying a build template or making more accounts cannot create new funding.
5. Add one-way QGOLD conversion with expiring reviewed quotes, integer amounts,
   matching final receipts and safe recovery. No MetaGold → city QGOLD redemption.
6. Add land purchase/extension, NFT transfer, material/cosmetic/blueprint sinks and
   player-task escrow with independent evidence, acceptance and disputes. Avoid
   mandatory fees on ordinary movement, reading or basic solo exploration.
7. Replace monotonic resource-counter merging in the client with revisioned
   authoritative snapshots before introducing spendable balances or materials.
   A spent balance must be allowed to decrease; Math.max is only valid for today’s
   retained, nonfinancial resource counters.
8. Adapt the existing P2P/Intents and platform transaction review flows to the new
   assets. Preserve network/asset disclosures, pending states and durable failures.

Premium QGOLD can fund MetaLayer demand, while MetaGold earned in the world buys
local space and player creations. Treasury-backed terrain coins and quests need a
finite budget. Do not pay MetaGold per free placed block: rebuilding/removing it
would farm the treasury. Reward eligibility must identify a distinct server-verified
outcome. Proposed amounts, prices, fees, caps and emission rates still need owner
review; this task sets none of those production numbers.

Transferable parcel NFTs permit an indirect external sale even without a reverse
currency bridge. Account for that economic exit explicitly when reviewing the
one-way policy; do not describe MetaGold as guaranteeing a closed economic system.

## Remaining release gates

Actual MetaLayer chain submission, native MetaXP/badges/NFT issuance, treasury and
conversion invariants, chain-only reconstruction, original wardrobe coverage,
physical Safari/iOS and Chrome/Android playtests and owner release review remain.
Current browser screenshots use software rendering. The short portrait camera
projection keeps the character above the controls. Landscape inherits the shared
QuestLayer rail, left joystick and compact objective placement. Verification failures stay beside the form and
scroll into view while preserving the selected action and transaction reference. UI fixture prerequisite skips
and a dormant verifier-form fixture are named separately from actual gameplay.
No production access, keys, contract build, commit, PR publication or VPS deployment
is included. The intended review target remains `claude/upbeat-gauss-5czir7`.
