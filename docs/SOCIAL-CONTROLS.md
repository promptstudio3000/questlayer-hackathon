# Public map notes, reports and player blocks

Implemented 31 October 2026 for W10. This is the application-hosted public-note
boundary, not an on-chain note, private evidence store, IPFS pinning service or
automated moderation system. It does not alter staking, native rewards, XP,
sponsored-task rights or the 50/50 game allocation.

## Player problem and scope

| Before | After | Why |
| --- | --- | --- |
| A note could be published again after a lost response. | A stable per-player operation ID and exact normalized request hash return one durable receipt. | A retry must not duplicate the note or its photo. |
| A slow photo preparation had no durable state. | A 60-second processing lease is stored before image work; replacement or abandonment invalidates the old lease. | A late result cannot resurrect an abandoned publication. |
| Notes had no owner removal or report path. | Authors remove their note; other players submit a private, deduplicated report for operator review. | Public content needs an explicit lifecycle without report-count censorship. |
| Any known photo path could remain readable. | A current visible-note reference and bilateral block check are required before image serving. | Hidden, removed, orphaned or blocked media cannot bypass the app's content controls. |
| Presence ignored player blocks. | Notes, media and nearby presence apply the same bilateral block relationship. | A block must apply consistently to the affected surfaces. |

The integration must serve note images with private/no-store cache headers and
apply the same block check to the presence-skin endpoint. Existing public caches
and copies cannot be recalled. Blocking is an application filter, not a secrecy
guarantee: these are intentionally public notes, and a different account could
view them.

## Publication and consent

New notes require `publicConsent: true` and explicit boolean `arena` and
`shareGps` fields. Text is 1–500 characters. The public map anchor and server
publication time are always part of a note. The author may separately opt in to
publish a GPS fix in physical mode. The selected fix must be finite, no older than
15 seconds, no more than two seconds in the future and accurate to 35 metres or
better. Only latitude, longitude, accuracy and timestamp are retained. Unselected
GPS and extra fields such as altitude or trails are discarded.

The public anchor describes the chosen place. It is not proof that the author
stood there. Publishing the optional author GPS also does not establish resistance
to spoofed browser coordinates. Arena movement cannot be published as actual GPS.

The media callback is the integration's sanitized image processor. It must reject
unsupported/oversized images, strip metadata and return an application media path.
The note module does not fetch remote images. Raw image data is never written to
the operation journal. It stores only a request digest, client ID, lease identity,
state and timestamps.

The note commit and its completed operation receipt are one SQLite transaction.
Two concurrent calls with the same operation ID cannot start independent image
jobs while the lease is active. A failed preparation can be retried with the exact
same request; changing content requires a new ID. Exact completed retries return
the current note state, including `hidden` or `deleted`, without republishing.
The original GPS fix may now be stale on a completed retry; it is not treated as a
new location publication.

At most 10 new note operations per hour and 50 per day are accepted per player.
Failed and abandoned operations count toward the daily storage bound. HTTP rate
limits, body-size limits and image-worker concurrency are additional integration
controls. A player ID is not proof of a unique person.

## Recovering an unknown result

The client stores only its operation ID, scoped to the current player and mode.
The receipt endpoint returns absent, processing, retryable, published, hidden,
deleted or abandoned. An immediately absent receipt after a network failure does
not prove that a delayed request cannot arrive.

`abandonOperation` permanently records the ID even when it was absent. A delayed
request with that ID is refused; an in-progress image job loses its commit right.
If the note already committed, abandoning returns its real completed state and
does not delete it. This allows a client that lost its in-memory draft to recover
without saving raw text, image data or GPS in browser storage.

Every post-image commit rechecks the browser session through the caller's
`assertSession` callback. Failed, expired, replaced or abandoned preparations
request removal of any unreferenced image they created. An interrupted process
can still leave an orphan; the host's bounded orphan cleanup handles that case.

## Removal, reports and moderation

Owner removal clears text, image reference and author GPS, zeros the map anchor,
resolves report details and records a content-free tombstone. The operation ID
remains occupied forever. The caller receives `removedImage` for physical-file
cleanup; this internal field must be stripped from the public API response.
Repeated removal has no additional effect. A removed note cannot be restored.
This is application removal, not a promise to erase previously downloaded copies,
SQLite backups or every historical storage representation.

Reports accept `spam`, `harassment`, `unsafe-place`, `privacy` or `other`, plus an
optional 500-character explanation. One reporter/note pair produces one durable
report. Up to 20 new reports per player/day are accepted. Report count never
automatically hides a note. Reports are absent from player note reads and require
explicit operator authorization to inspect. Authors use Remove for their own note.

The constructor denies all operator access by default. A protected local operator
tool supplies a narrowly scoped authorization callback. The normal application
instance cannot elevate a user through a body-supplied role. Operators may hide,
restore or dismiss a report, with an audited reason. Hiding retains content for
review/restoration but excludes text and images from ordinary application reads.
An unsafe-place report is a review signal; this slice does not automatically close
a system zone or alter a published native reward manifest.

Block/unblock affects both directions of note/media/presence visibility. Only the
blocker's own list is returned. Each list has a 200-entry bound and changes have a
100-per-hour bound. Removing one side's block does not cancel the other side's
independent block. A blocked author is excluded before the nearby-presence limit
is applied.

## Backend integration contract

`new SocialContent(db, {clock?, authorizeOperator?})` runs idempotent additive
migrations. It keeps the existing eight-column `messages` table compatible with
legacy data. Historical notes have no reliable mode, so their metadata is
classified as arena; no historical simulated anchor becomes physical evidence.

| Method | Input / result |
| --- | --- |
| `list(player, {lat,lng,arena})` | Up to 50 visible nearby messages, newest first; parsed `author_fix`, `own`, `arena` and state. |
| `create(player, input, callbacks)` | Input: `clientId,text,lat,lng,arena,publicConsent,shareGps,image?,fix?`. Callbacks: `storeImage`, `removeImage`, `assertSession`. Result: `{id,state,replayed}`. |
| `operation(player, clientId)` | `{found:false}` or `{found:true,id?,state,retryAfterMs?}`; no other player's receipt is returned. |
| `abandonOperation(player, clientId)` | `{found:true,state:'abandoned'}` or an already completed note receipt. |
| `remove(player, noteId)` | Owner only; `{id,state:'deleted',removedImage}`. |
| `report(player, noteId, {reason,detail?})` | `{id,state,replayed}`; report details stay operator-only. |
| `blocks(player)` | `{blocks:[{playerId,name,createdAt}]}`. |
| `setBlock(player,targetPlayerId,blocked)` | `{playerId,blocked}`. |
| `mediaAllowed(player,path)` | Boolean after authenticated-player, visible-reference and bilateral block checks. |
| `reports(operator,{state?,limit?})` | Bounded operator queue, `open`/`resolved`, maximum 100. |
| `moderate(operator,{noteId,action,reason})` | Explicit operator-only hide/restore/dismiss, audit and report resolution. |

`isSocialBlocked(db,a,b)` and `initSocialBlocks(db)` are exported for other read
surfaces. `nearbyPresence` initializes the compatible block table and filters
relationships inside its SQL query. Financial settlement is deliberately not
filtered: a player block cannot erase money, an obligation or a chain receipt.

## Evidence and remaining gates

The focused social/presence tests cover public consent, GPS minimization and
freshness, mode separation, exact retries, image-work concurrency, expired leases,
session revocation, abandonment before arrival and during preparation, owner
tombstones, default-denied moderation, report privacy, bilateral block enforcement,
media denial, legacy migration and rate bounds.

This source implementation alone does not establish deployed behavior, rendered
form accessibility, real-device GPS, a staffed moderation service, a public support
contact, private paid/photo evidence, IPFS availability or SocialDB publication.
Those acceptance gates remain separately tracked in the roadmap. Operational
report/backup retention and appeals for moderator decisions still need a published
production policy; hiding content is not deletion.

## Integrated operator and media path

The deployed service uses `NoteMedia` for metadata-free, bounded JPEG output and current-visibility media reads. Owner deletion removes the image; hourly bounded cleanup retries unreferenced files after a 24-hour grace period. A referenced hidden image is retained for restoration. This does not erase previously downloaded copies.

An operator with OS access to the protected database can run `node server/cli/moderate-notes.mjs list --database /absolute/existing.sqlite --operator NAME`. A decision uses `hide`, `restore` or `dismiss` with `--note ID --reason TEXT --apply`; decisions are audited. The HTTP service does not grant operator capabilities.
