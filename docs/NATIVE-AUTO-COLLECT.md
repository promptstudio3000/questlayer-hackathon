# Native street-coin collection

Implemented 31 October 2026 as a W06 client scheduler. This is an optional native
testnet walking control, independent of manual collection and the demo coin loop.
It does not change coin value, XP, treasury allocation, shared ownership, enrollment
consent, wallet signing or settlement rules.

## Integration

`src/useNativeAutoCollect.ts` accepts the current player/account, whether that account
is linked, the shared native snapshot and its refresh function, real GPS evidence,
native/arena mode and an `active` flag. The parent sets `active` only while the walking
map owns interaction; another tab, dialog or text control pauses collection. The
hook supplies foreground/online state itself. It never requests GPS or signs a
wallet operation.

`setEnabled(true)` must come from the explicit **Collect as you walk** action. Linking
a wallet does not enable it. The preference starts off on reload and resets when the
player, account, contract or known published day changes. An unavailable observation
temporarily pauses the same opted-in session. Returning to a valid foreground map
can resume it. A new account/day requires a GPS fix newer than that selection.

The returned `status`, `message`, `pending` and `retryAt` explain the current gate.
`confirmed` contains only this controller session's confirmed automatic pickups:
`{count, amount, xp}`. `amount` is an exact yoctoNEAR decimal string, not a JavaScript
floating-point balance and not demo GOLD. Label it as a session result rather than
the player's wallet balance. `onConfirmed` delivers a coalesced delta with account,
day and receipt IDs; no toast, vibration or repeated announcement is built in.
Manual coin collection remains an independent supported action.

## Conditions and limits

All conditions must hold at submission time:

- Explicit opt-in, linked/enrolled current account, native testnet mode and active,
  visible, online application.
- Matching account, contract and live published day; a snapshot no older than 30
  seconds; verified available collection metadata. Missing observations pause,
  rather than becoming an available balance or unused budget.
- Real GPS with finite coordinates, accuracy between 0 and 35 metres, fix age no
  more than 15 seconds and no more than 2 seconds of future clock tolerance.
- At most 35 metres to the actual coin coordinates. The displayed distance hint is
  not used to authorize submission. This is proximity, not a verified walking route.
- At most one submission in flight, at least 3 seconds between attempts, and fewer
  than three known pending coin receipts for the account/day. The server's 100 coin
  account/day and 256 receipt daily pilot caps remain authoritative.

The native server supplies `collection.available`, `paused`, `coinLimit`,
`coinsAcceptedToday`, `pendingCoinsToday` and `minimumIntervalMs`. Client pacing
cannot weaken the server's rate, evidence, capacity or first-claim checks. The client
counts locally accepted receipts while waiting for its next snapshot. Other tabs
and manual requests can still cause the server to reject an otherwise eligible
client attempt.

## Receipt and failure handling

An attempt is journaled before sending; its durable accepted receipt is then stored
under player, network, contract, account, day and coin identity. The bounded session
storage journal contains receipt IDs and indices, never GPS coordinates or keys.
Unavailable/corrupt browser storage disables automatic collection; manual visits
and the server receipt history remain available.

Queued/submitted receipts never increment confirmed money or XP. Only a matching
server receipt with `state: confirmed`, an exact amount string and integer XP can
produce feedback. The seen marker is persisted before delivery. Multiple receipts
within two seconds produce one delta. Ledger baselines and restored history are
silent; an interrupted session does not celebrate old receipts again.

Known shared-coin rejection creates a silent skip marker, preventing repeated claims
against a stale map. Account/day caps and server pause stop attempts. GPS rejection
requires a newer fix. Pacing rejection waits five seconds; other rate limits wait a
minute. Unknown network/server failure retains the same uncertain coin identity:
the next authoritative snapshot can recover its accepted receipt, or the client
retries that same index after 15 and 30 seconds. Three consecutive uncertain failures
stop for receipt review. Each browser request has a 20-second timeout; aborting a
request does not imply the server rejected it. A delayed response from an old account
can update only that old journal, never the new account's counter or refresh flow.

## Verification and remaining acceptance

`node --test tests/native-autocollect.test.mjs` exercises explicit consent, serial
pacing, pending backpressure, unknown observations, accuracy/freshness/distance,
foreground/offline gates, capacity, rate limits, evidence rejection, receipt replay,
exact monetary arithmetic, coalescing, storage failure, account/day switches and
late responses. These are controller tests, not proof of physical GPS reliability.

Parent integration owns rendered control/contrast/keyboard checks at 360px, 390px,
short landscape and desktop. Physical Safari/iOS and Chrome/Android walking,
background/resume, GPS loss and weak-network verification remain required before
calling mobile walking behavior verified. Public gameplay receipts may still link
a NEAR account to a known coin location; existing native enrollment disclosure must
remain visible before activation. No mainnet readiness or anonymity is claimed.
