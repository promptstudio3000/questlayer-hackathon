# Native sponsored-task player flow

31 October 2026. W08/W10 implementation slice; neither milestone is complete.

## Player problem and chosen composition

The previous Community Tasks screen was a demo ledger. A player could not fund a
native sponsored task, inspect its review policy or recover its award/refund from
an independent escrow. This slice adds that explicit NEAR testnet path, separate
from the existing demo, native street/zone funds, XP and paid access.

Two compositions were considered: an all-in-one table with inline evidence and
funding controls, or compact task cards leading to one selected task and one
primary action. The second is implemented. It keeps lengthy rules and receipts in
native `details` elements and makes creation a form followed by an exact-cost
review. It does not add another map layer or change game rewards.

| Before (source finding)                                                           | After (implemented source)                                                                                                               | Why                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Community demo sponsorship could be mistaken for the complete native lifecycle.   | `src/NativeTasks.tsx` labels native testnet, own escrow, wallet and exact denominations; root integrates an explicit Native/Demo choice. | Funds and ownership must stay distinguishable.            |
| No player-native sponsored-task workflow existed.                                 | Cards open one selected task with requirements, reward, own evidence and applicable next action.                                         | A noticeboard remains readable on a phone.                |
| Contract support alone would expose large argument lists without a player review. | Creation previews the locked prize, fixed 0.05 test NEAR non-refundable storage, total attached and separate network fee.                | Approval is informed by the exact transfer.               |
| Public evidence could leak private facts or suggest later deletion.               | Adjacent public-permanence disclosure and acknowledgment; no file upload, coordinates or automatic IPFS retrieval.                       | This pilot supports intentionally public text only.       |
| An RPC error or wallet cancellation could resemble a paid result.                 | Explicit unavailable/stale/pending/cancel/error states; stale actions are disabled; failed signing preserves form values.                | Only confirmed task records establish outcomes.           |
| Cosmetic reward representation could use a generic utility icon.                  | A small authored pixel coin is drawn in the component; Phosphor supplies action/status utilities.                                        | Game objects and navigation retain distinct visual roles. |

These are source comparisons, not a claim of measured usability improvement.
Rendered evidence is maintained by the integrating parent in the release QA record.

## Funding and evidence

- The immutable pilot contract pins a fixed arbiter. A task accepts at most one
  test NEAR prize, with a separate 0.05 test NEAR task storage payment. Publishing
  needs a native linked wallet, exact review and a public-record acknowledgment.
- The UI offers rewards of 0.001–1 test NEAR. GOLD is an integer-exact display
  denomination: 1 NEAR = 1,000 GOLD. It never converts demo balance into native
  credit. Costs and all contract values remain integer yoctoNEAR strings.
- Text evidence costs 0.05 test NEAR non-refundable storage plus network fee.
  Appeal, decision, closure and settlement attach no NEAR; withdrawal attaches
  one yoctoNEAR. The wallet shows the separate network fee.
- Input remains in place after cancellation/error. Creation uses a stable local
  operation ID so an ambiguous retry cannot publish the same request twice.
- Hashes are SHA-256 of the explicitly entered public fields. An optional reference
  is only a bare IPFS content address, never an arbitrary URL or local path. There
  is no upload, background fetch, geolocation capture or photo support in this slice.

## Rights and deadlines

The selected task shows its evidence deadline and keeps the full policy available
in a disclosure. Sponsor review follows receipt order. A later approval cannot
bypass an earlier live appeal right. A rejected claim can appeal within 24 hours,
capped by the published final appeal deadline. Pending claims can appeal once the
sponsor review deadline passes. The fixed arbiter has a bounded resolution period.
Arbiter decisions cannot be appealed again. No UI claims a guaranteed payout.

Closing a task prevents new evidence while keeping existing rights. The
permissionless `Check settlement` action can leave escrow unchanged while rights
remain live; a successful wallet transaction is not described as a successful
payout. Final award/refund credit appears separately, with a retryable withdrawal.

## Adapter and wallet boundary

`server/native/tasks.mjs` exposes `NativeTasks(db, provider, manifest, options)`,
`snapshot(playerId, accountId, fresh, taskId)` and `prepare(playerId, request)`.
Root routes are `GET /api/native/tasks?accountId=…&refresh=1&taskId=…` and
`POST /api/native/tasks/prepare`. Root also reauthenticates the player session after
awaited work. No server player signer is introduced.

The deployment manifest must have schema 1, testnet network, exact reviewed
contract ID, code hash, policy, arbiter and `keyless: true`. Each fresh observation
rechecks node network, finalized anchor, unchanged code, no access keys, exact
policy, bounded ordered task pages and conserved totals. Selected evidence and
the actor's credit use the same finalized block. At most 128 tasks and 32 selected
submissions are read, with an overall RPC deadline. A bounded TTL cache and
singleflight serve reads; expired data can only return an explicit stale state.
Quotes bypass that cache, recheck linked wallet authorization after RPC work and
bind exact method, arguments, actor, receiver, deposit, gas, code and policy.
Client `assertTaskQuote` verifies those bindings and quote expiry before root asks
the player's wallet to sign.

A wallet's optimistic execution response is not itself final confirmation. After
the wallet returns a transaction hash, `POST /api/native/tasks/confirm` accepts
`{ accountId, quote, transactionHash }`. The read-only adapter pins the current
network, code, keyless ownership and policy, then calls the installed provider's
`viewTransactionStatus({ txHash, accountId, waitUntil: "FINAL" })`. It matches the
transaction hash, signer, receiver and exactly one FunctionCall against the
original reviewed method, decoded arguments, gas and attached deposit. Only a
final successful outcome is accepted. A withdrawal additionally requires the
callback's decoded result to be `true`; a restored credit is not a paid withdrawal.
Ownership is rechecked after RPC work. Confirmation clears stale read caches and
does not create another transaction or repeat `prepare`. An expired original
quote is accepted solely as receipt comparison context, never as new authority.

## Verification and remaining gates

The focused suites are `tests/native-tasks.test.mjs` and
`tests/native-task-quote.test.mjs`: integer precision, transaction mutation,
authorization races, code/network/key/policy pins, bounded reads, stale failure,
ordered reviews, exclusive appeal deadlines, no repeat appeal after arbitration,
exact storage funding, duplicate publication and guarded withdrawal.
Confirmation cases additionally cover optimistic/failing outcomes, substituted
transactions and arguments, expired review context, restored withdrawal credit,
revoked wallet linkage and bounded final receipt lookup.

`dev/native-tasks.html` uses the real component with a clearly labelled in-memory
fixture. Query options: `role=guest|explorer|sponsor|arbiter`,
`state=ready|appeal|credit|unavailable|stale`, `outcome=cancel|fail|success`.
Default actions cancel without signing or spending. The fixture is excluded from
production build output. Integrating QA must capture 360/390 px, short landscape,
desktop, enlarged text and focused forms; inspect pending/cancel/error and wallet
account-switch behavior. Physical Safari/iOS and Chrome/Android remain required
before claiming mobile verification.

Creator XP commitments, creator profiles/follows, protected/private evidence,
photo moderation, paid access and creator fund rounds remain roadmap work. The
pilot is not a claim of production dispute governance or mainnet readiness.
