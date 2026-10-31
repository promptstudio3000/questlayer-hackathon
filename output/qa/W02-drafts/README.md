# W02 local draft continuity and safe return

Implemented on 2026-10-31. This change keeps editable work when a player leaves a panel, reloads or receives a failed/unknown publication result. Public consent, GPS sharing, media and financial review must be supplied again in the current context. This report records source changes and focused automated checks; [completed synthetic fixture browser evidence](../W02-W08-parallel/fixture-browser-notes.md) records interactions and viewport captures separately. Physical-device behavior remains unverified.

## Before / After / Why

| Source finding before | Implemented after | Why and pointers |
| --- | --- | --- |
| Map note text lived in the mounted component; operation recovery was tab-only session storage. | Allowlisted text drafts use durable player + arena/physical scope. Each unknown publication has a separate durable ID/revision record, including legacy tab-intent recovery. | Leaving or reloading must not erase text or turn an unknown publication into a new attempt. [MapNotes](../../../src/MapNotes.tsx), [journal](../../../src/note-publication-journal.ts). |
| Parent navigation could observe the note view but could not command it. | Optional controlled `view` accepts browse/compose/blocked; `onViewChange` requests navigation. Leaving or returning to compose revokes transient consent and GPS-sharing choices. | Browser Back can return to nearby notes while text stays available. [MapNotes](../../../src/MapNotes.tsx). |
| Native task create/evidence fields were component-local; creation minted a random client ID on each mount. | Raw strings are scoped by player, configured testnet contract, account, task and submission/appeal stage. Creation ID is a SHA-256 fingerprint of the exact reviewed actor, account, contract, code, policy, public content, reward and deadline. | Identical terms cannot gain another identity after a lost wallet confirmation or in another tab. The contract rejects duplicate sponsor/client IDs. [NativeTasks](../../../src/NativeTasks.tsx), [fingerprint](../../../src/native-task-draft.ts), [contract invariant](../../../contracts/tasks/src/lib.rs). |
| Funding review and acknowledgement state depended mainly on the mounted form. | Review binds to current actor/account/network/configured contract/code/policy, and acknowledgement also binds to the current form stage. Context changes require a fresh review. Exact existing task matches open the published record before a new wallet request. | Saved text cannot authorize a transaction. The existing application pending-transaction journal remains authoritative for unchecked wallet outcomes. [NativeTasks](../../../src/NativeTasks.tsx). |
| The global label colour (`#8e7c99`) was inherited by note compose, checkbox, photo and dialog labels; its approximately 3.7:1 contrast on the cream surface falls below normal-text contrast. | Those note labels now use `var(--ink-secondary, #665577)` within the existing scoped 16px label baseline. | Improve operational form text contrast without altering global colours or control layout. [Note CSS](../../../src/map-notes.css). This is a source finding; rendered fixture observations are recorded separately. |

## Reusable API

`useFormDraft({ playerId, form, realm, fields, initial })` returns `values`, `revision`, `setField`, `replace`, `discard`, `restored`, `storageAvailable` and `hasDraft`. `fields` explicitly allowlists string field names and maximum lengths; extra properties are not saved. Writes occur synchronously during edits, before a navigation handler can unmount the form. `initial` is the fallback at scope hydration, not an automatic overwrite on later asynchronous server data changes.

Explicit `discard()` clears the current local form. Confirmed operations call `discard(submittedRevision)` so an older outcome cannot erase a newer saved revision. `discard(null)` clears unsaved local values without deleting a separately saved revision. Consent, quotes, review flags, GPS, photos, pins, private keys and wallet approvals never enter this store. The publication journal saves only operation ID, draft revision and timestamp; it is never accepted as a success receipt.

Map notes clear their submitted text only after the server confirms a published/hidden/deleted result; abandoned or unknown outcomes retain text. Native task/evidence fields clear only when `onTransaction` confirms success, or when fresh returned task data exactly matches the already published creation. Ordinary failure/cancellation keeps editable fields. Existing journal and server/contract authorization rules remain in force.

## Verification

- [Focused tests](focused-tests.txt): 19 passed, covering schema corruption, bounds, private-field exclusion, unavailable storage, actor/form/realm isolation, revision-safe deletion, reload and concurrent publication identity recovery, legacy journal migration, stable exact-term task IDs, invalid review scope and existing-record matching. Four of these test the reusable read epoch's ordering, context changes, invalidation and token identity boundaries.
- [TypeScript and production build](build.txt): passed.
- `git diff --check`: passed at this checkpoint.
- No dependency, server, contract, economy policy or deployment changes in this workstream.

The navigation source review identified unguarded asynchronous world/player refreshes, an Inventory instance reused across players, and a GPS watcher that could update arena coordinates after returning from GPS play. The parent owns the App fixes. [read-epoch.ts](../../../src/read-epoch.ts) now supplies `begin(context)`, `isCurrent(token, currentContext)` and `invalidate()` through `createReadEpoch()` for tested request fencing. A token is an immutable in-memory identity; exact context and newest request must both match. It cannot re-enable an old A→B→A read or be reused across separate read streams.

Within this workstream, [Inventory](../../../src/Inventory.tsx) now fences manual and automatic original-appearance reads before updating its local state or the parent appearance. Listing completion can only clear its submitted draft/error/dialog when the component remains mounted with the same owner and selected item. If the player leaves the selected item before its listing confirms, its saved draft is conservatively retained; the pending flag is still released so the remaining collection does not stay locked. NativeTasks uses a separate operation epoch to fence overlapping content hashing and late wallet completion across account/task changes, including A→B→A, without changing the application's durable wallet journal.

## Interaction review fixtures

- `/dev/map-notes.html`: edit a note, Leave/Return the panel, switch arena/GPS scope and player, navigate back to nearby notes, then inspect pending/lost-response cases. Reload retains only text/operation identity; reselect media and obtain fresh GPS/consent. The fake operation service lives in the fixture instance and does not survive a full reload.
- `/dev/native-tasks.html?role=sponsor&outcome=lost-after-save`: create and review a realistic task, acknowledge and lock its prize; the fixture accepts it but returns an unknown confirmation. Use Refresh, then lock/review again: the matching task opens and the fixture request count must remain one. Leave/Return and reload preserve raw text with no acknowledgement or review; the fixture's fake chain state survives panel remount only. `outcome=success`, `cancel` and `fail` exercise confirmed, cancelled and failed paths. Change fixture code then Refresh must revoke funding review.
- Parent browser review should cover 360/390 px, short landscape and desktop, keyboard focus/Back, enlarged text and keyboard-open form behavior. Physical Safari/iOS and Chrome/Android are still required before calling mobile hardware behavior verified.

## Remaining limits

Browser storage is local to the current origin/device and is not encrypted or synchronized. Unavailable/quota-blocked storage is disclosed; in-memory text remains usable. Drafts are last-writer-wins across tabs; conditional deletion prevents a known newer revision from being erased, but this is not transactional concurrent editing. Separate unknown note operations remain individually recoverable.

Existing-task recognition uses the fresh bounded task list returned by the API; if an older matching task is outside that page, the application pending-transaction guard and contract duplicate-ID check still prevent a second creation with the same exact terms. No wallet transaction, real chain settlement or real-device validation was performed by this workstream. Changing task terms intentionally creates a different fingerprint and requires a new review; a local fingerprint never authorizes spending by itself.
