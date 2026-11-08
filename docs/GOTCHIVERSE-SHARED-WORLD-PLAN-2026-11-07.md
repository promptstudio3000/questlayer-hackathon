# Next implementation: a shared Gotchiverse and outdoor claims

7 November 2026. **Planning handoff only. No shared-world or claim implementation
was made in this update.** The owner redirected the continuation to documentation
for Claude and an evening refresh of the whole review pack. The implemented R1
workshops remain the current runtime candidate.

Read this alongside the [whole return handoff](CLAUDE-RETURN-HANDOFF-2026-11-07.md),
[accepted product plan](QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md) and
[implemented workshop mechanism](GOTCHIVERSE.md). This document specifies the next
slice; it does not activate financial policy, authorize deployment or supersede
repository ownership rules.

## 1. The player loop and its scope

The next complete experience is:

1. Play an eligible adventure outdoors in QuestLayer.
2. Receive an authoritative completion and, under the adopted policy, a building permit.
3. Enter Gotchiverse through the existing logo picker with the same character.
4. Visit the common landscape, choose an available grid cell and see its exact terms.
5. Claim temporary editing rights using the permit and reviewed QGOLD settlement.
6. Shape terrain, place eligible objects and invite friends to help.
7. Return outdoors when another permit is useful for an extension or another claim.

These are temporary rights to build in a common landscape. There is no permanent
land sale, forced town, territorial voting, parcel council or new currency. The
ordinary outdoor adventure and visiting the virtual world remain useful without
a wallet, deposit or claim. The existing free workshop remains a clearly labelled
practice space; it cannot be converted into a public claim or a real permit.

An active prepaid claim needs no daily or monthly activation. Returning outdoors
creates optional opportunities to build or extend, rather than an upkeep chore
that destroys an already paid right.

## 2. Current source and what can be reused

R1 already implements the lazy game screen, shared authenticated character,
16 × 16 terrain editor, owner-and-friends access, virtual visitor markers,
revision checks, atomic file snapshots and recovery of an uncertain save.

| Current source finding | Reuse or next change |
| --- | --- |
| `src/App.tsx`, `WorldSwitcher.tsx`, `lazy-panels.tsx` mount the actual game screen | Keep one world picker and the ordinary Inventory/Back flow; do not introduce a separate app or iframe |
| `src/Gotchiverse.tsx` edits one private workshop | Add shared-world navigation with explicit visitor, editor and claimant states |
| `src/gotchiverse-canvas.ts` and `server/gotchiverse/model.mjs` render/generate one local grid | Extend the model to world/chunk coordinates; keep the existing editor and authored visual language |
| `server/gotchiverse/store.mjs` authorizes private snapshots | Preserve the workshop API and state; design public chunk reads and lease-aware writes separately |
| Exact edit requests, revisions and session retry journal already exist | Bind them to a chunk and claim generation so an old request cannot edit a new claimant's terrain |
| R1 JSON storage is separate from financial tables | Do not debit QGOLD in an unrelated JSON file and call it atomic; use reviewed accounting and recovery boundaries |
| Workshop visitors use names and starter markers | Full peer wardrobe remains future work; existing owner appearance continuity is already reused |

The R1 API/store modules have not yet been reconciled with the independent security
candidate. Review overlapping App, server entry, lazy panels and wiki edits first.
R1's private file locks, backup coverage and multi-worker resource ceilings also
have open release gates; copying that code does not close them for a public world.

## 3. A shared landscape that stays simple

Use a versioned deterministic seed and **16 × 16 blocks per claimable chunk**.
Global virtual coordinates identify the chunk and local block independently of
physical GPS or the historical financial world IDs. Neighboring natural terrain
must derive from global coordinates so boundaries remain coherent.

Load a bounded nearby chunk window and store actual accepted edits, rather than
creating an infinite database or sending the entire world to a phone. A first
bounded pilot is acceptable if its bounds are visible and extensibility is not
described as already delivered. Choose storage and admission limits from measured
resource needs; they are not new economy constants.

Players can walk across chunk boundaries and inspect a nearby grid overview.
Everyone can visit public builds. Editing requires a current claim and ownership
or a current invitation. Visiting, temporary editing rights and ownership of a
displayed NFT are three separate permissions. Keep only owner and invited editor
roles; friends cannot renew, invite others, spend funds or move another player's NFT.

Continue with static water, height/material tools and a small approved object
library. Defer fluids, circuits, arbitrary scripts, destructive physics and a
building-management economy. Provide block selection and named buttons as an
alternative to precise tapping. Preserve original Aavegotchi appearances.

## 4. Outdoor permits: establish the evidence boundary first

A permit must refer to an eligible durable completion for the authenticated
player. Its source, actor, proof domain, completion identity and adopted policy
version must be established server-side. Client coordinates, a local counter,
the current screen, a request body saying `gps`, or a screenshot are insufficient.

**Concrete source finding:** `server/adventure-results.mjs` currently defines
`adventure_results.domain` as `demo`, while `realm` can be `arena` or `gps`.
Consequently, selecting a result with `realm = 'gps'` alone must not mint a
production outdoor permit. Claude must trace the actual validated completion path
and its trusted proof classification, including the security candidate, before
deciding whether an existing receipt can authorize the new right. A monetary payout
is not required for an eligible free adventure, but credible completion evidence is.

If the current source cannot establish that classification durably, implement that
prerequisite and its tests before enabling issuance. Keep a visibly labelled demo
path separate; demo/arena receipts must never become real permits or paid claims.

Required issuance properties:

- One completion cannot issue the same entitlement twice, across retries or workers.
- The receipt and policy select the player and entitlement; the client does not.
- Refunds, reversed/invalidated evidence and retries have explicit durable states.
- An unclaimed shared cash prize does not erase a player's separately valid completion.
- Permit consumption is recoverable and tied to one claim operation, never a UI click.
- Public land metadata reveals no raw GPS, private quest trail or private proof.

One permit for the first eligible quest per day and a four-active-claim cap are
**existing tuning proposals, not adopted runtime rules**. Confirm eligibility,
day boundary, issuance and cap together in a versioned policy. Server time governs
any adopted day/expiry boundary; do not silently adopt the browser timezone.

## 5. Terms and the decision left unchanged

The preceding product plan records these future terms:

| Term | Permit requirement | QGOLD requirement |
| --- | --- | --- |
| 30 days | 1 permit | 0.025 QGOLD |
| 365 days | 12 permits | 0.25 QGOLD |

These remain **inactive planned terms**, subject to reviewed token precision,
accounting and policy adoption. Payments are intended for the existing global
treasury; they do not burn QGOLD or convey treasury backing assets.

During this continuation the owner was asked whether claims should instead be
free with only outdoor evidence. The owner deferred implementation and requested
this handoff; **no replacement of the permit-plus-QGOLD plan was selected**.
Claude must not infer a fee waiver or a newly approved payment implementation.

Do not turn these quantities into live constants during a visual or terrain-only
change. Financial integration belongs to the owner Claude scope under
`HANDOFF-WEEKEND.md`. Ordinary building must not gain wallet confirmations;
any deliberate claim payment must have understandable exact terms.

## 6. Claim lifecycle and failure recovery

| Visible state | Player rights and required outcome |
| --- | --- |
| Unclaimed | Everyone visits; a valid permit and settled operation can start a claim |
| Active | Owner and current friends edit; everyone else visits |
| Expired | Build stays visible and becomes read-only immediately at server expiry |
| Renewed by previous owner | Preserve the terrain if nobody else has taken over; record new exact terms |
| Taken over | Archive the previous blueprint durably, reset terrain to the natural seed, then expose the new claim |

Pending and unknown payment states belong to a durable **operation**, not a fake
successful lease. Bind actor, realm, chunk, current claim generation, quote,
term, exact integer price, permit receipt and operation ID together. Reserve the
necessary resources under the reviewed transaction boundary, perform settlement,
and reconcile the final claim or known refund. The precise storage/protocol choice
must match the actual QGOLD service after security reconciliation.

Two contenders must not both obtain rights to the same generation of a chunk.
Uncertain payment must not consume a second permit, produce a second debit, reset
the old build or unlock a conflicting successful claim. An expired quote, browser
close or timed-out callback is not proof that money did not move. Retry the same
operation and expose its real status. Resolve blocked reservations through known
settlement/recovery rules, rather than leaving an indefinite hidden lock.

At takeover, old ownership and friend invitations must not carry to the new claim.
Reject stale edits, queued retries and invite links from an earlier generation.
An expiry can be enforced on each read/write; a background worker must not be the
only authority preventing an edit after expiry. Define renewal's exact time rule
before implementation and show the resulting expiry before payment.

The archived blueprint remains attributable to its author and can be exported or
rebuilt under another valid claim. Archive-before-reset must survive interruption.
Define archive retention, export limits, backup/restore and quota behavior before
enabling destructive takeover. Keeping a picture in browser memory is insufficient.
NFT references in a blueprint never transfer custody or create replacement items.

## 7. The mobile composition and meaningful states

Retain the compact shared header, character, map/editor, 48px controls and reachable
Inventory/return navigation. Put the next useful action above the phone fold.
Show the selected chunk and a short explanation of the player's rights, followed
by the appropriate action: explore, inspect terms, claim, build, invite or renew.

The claim sheet should show the actual server quote, available permits, exact
price, term and resulting expiry. If there is no permit, offer a truthful return
to an eligible outdoor adventure. If eligibility or payment cannot be established,
explain that state without implying a successful claim. Avoid extra token meters,
territory dashboards and permanent parcel ownership language.

Cover loading, visitor, own claim, friend editor, expired, no permit, insufficient
funds, quote expired, pending, unknown outcome, conflict, offline and failed.
Preserve the current exact-save retry behavior, accessible dialogs, Escape/focus
return, enlarged text, reduced motion and readable original character artwork.
Do not imply a straight line on the physical map is a verified walking route.

## 8. Implementation chapters and acceptance evidence

| Chapter | Deliverable | Required evidence before promotion |
| --- | --- | --- |
| C0 — Reconcile | Current UI + R1 + independently reviewed security candidate | Exact base/order and source hashes; preserve newer overlapping work |
| C1 — Common world | Public chunk reads, seamless virtual navigation, bounded loading, same character | Two explorers see the same terrain and cross a boundary; no physical collection or GPS mutation |
| C2 — Outdoor evidence | Authoritative classification, policy and durable permit issuance | Real-path receipt provenance; replay/cross-actor/demo rejection; approved free adventure eligibility |
| C3 — Temporary rights | Exact quotes, settlement, claim, renewal, expiry and takeover/archive | Accounting conservation, concurrency and interrupted-operation recovery |
| C4 — Shared building | Lease-generation-aware edits, invitations and visible visitors | Immediate expiry/revocation enforcement and rejection of stale saves/invites |
| C5 — Delivery | Wiki, public copy, phone behavior and recovery/operations | Named build, screenshots, restore rehearsal and explicit remaining device/release gates |

C1 can be implemented independently of paid activation. Test claim-gated building
with explicitly synthetic fixtures while C2/C3 are unfinished; do not present that
as a working real-world entitlement loop. Each chapter needs a separate scoped
change and updated Claude ledger. Existing free workshops must survive the work.

The combined scenario must additionally exercise simultaneous claims, one permit
targeting two chunks, repeated success callbacks, unknown payment, expiry at the
exact boundary, renewal versus takeover, crash around archive/reset, stale browser
edits, revoked editor, negative chunk coordinates, neighboring-cell isolation,
storage unavailability and actor/logout changes during writes. Reconnect must
recover the true operation and terrain state without duplicate effects.

Capture the actual game at 360/390px, short landscape and desktop, including form
focus and enlarged text. Browser profiles are useful evidence, not physical
iOS/Android, wallet-return or field-GPS verification. Run the relevant existing
financial invariants and owner-controlled checks for C2/C3; do not reuse R1's green
logs as proof of new money paths. No milestone or production readiness follows
from a prototype or one successful transaction.

## 9. Position in the complete handoff

Finish a coherent shared-world/outdoor-claim slice before adding every secondary
idea. The [master integration plan](QUESTLAYER-INTEGRATION-PLAN-2026-11-07.md)
continues to hold the detailed R4–R9 specifications:

- **Auras:** the requested finite 10% share of received game-directed yield and
  Explorer reach; proposed rarity/reach values remain proposals. No extra Aura
  powers are approved by this document. Public-chunk editing still requires rights.
- **DAO and AI:** QGOLD-holder allocation choices and weekly strategy research,
  with references, reviewed adapters, liquidity limits and deliberate execution.
  Research output is not a safe-yield guarantee or an unrestricted signing mandate.
- **NPC/private AI:** bounded personalized quest dialogue or sealed-choice activity
  after the core loop; private claims require evidence across ingress, inference,
  logging and output. Public transfers do not become private through an NPC.
- **Profile NFT and Intents agent:** deferred, with separate custody, account-bound
  XP, transferable-rights and supported settlement decisions. Do not silently make
  existing account progression transferable with an avatar.
- **Other layers:** geocaching is the next prototype. Snake/racing and a broader
  multi-asset framework remain backlog; they must not fragment this first loop.

## 10. Evening refresh instructions

At the evening update, recapture the exact source/branch state and check what
actually changed in security, physical-world preparation and art. The last compact
external checkpoint is R1's `external-status.json`, explicitly a dated chat report,
not current production evidence. Keep old archives and logs immutable and label
any newly supplied candidate by exact base, ordered patches and digest.

Update the whole handoff, change ledger and package manifest together. Distinguish
implemented, independently verified, reported by another stream, planned and
blocked-by-a-specific-prerequisite. Record changed source under new evidence rather
than attaching an old green test count. The owner requested an evening refresh,
not an automatic deployment or a scheduled background task.
