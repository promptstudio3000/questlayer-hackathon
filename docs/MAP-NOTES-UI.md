# Map notes: readable publishing and social controls

Implemented 31 October 2026, W10. This is server-hosted public content, independent of native task escrow, rewards, wallets and on-chain publication.

## Player problem and composition choice

The previous map-note panel opened directly into a large editor with an unlabeled textarea and icon-only upload. It had no removal, reporting, block management or durable publication-receipt recovery. Text, image and optional author GPS could be posted, but the controls did not explain how the public map pin differs from an optional GPS attachment.

Two compositions were considered: keep a permanent composer above every note, or make nearby notes the default and open a deliberate compose surface. The second was selected: a passing explorer first sees local discoveries, while publication/privacy controls appear only when writing a note. Blocking and reporting stay in each note's native disclosure menu; the list does not become a row of destructive buttons.

| Before | After | Why |
| --- | --- | --- |
| `App.tsx` inline `Messages` mixed the editor and all notes. | `src/MapNotes.tsx` offers nearby notes, a focused composer and a blocked-player view. | Reading nearby discoveries stays the default task. |
| Only a placeholder named the textarea; upload was a small icon. | Visible labels, a 48px photo control, replace/remove preview and 16px fields. | Forms are readable with touch and keyboard. |
| Optional author GPS could imply that the pin was private when unchecked. | Explicit consent names the public map pin, note/photo and time; real author GPS/accuracy/time has its own opt-in. | The location disclosure matches the information actually published. |
| A lost POST response had no durable operation identity. | Only an operation ID is kept in session storage. In-memory retries freeze the original payload; receipt lookup and permanent abandonment resolve uncertainty. | Refresh/retry does not silently submit a changed or duplicate note. |
| There were no social removal or safety controls. | Own-note removal, reasoned reporting, bilateral block/unblock and root presence refresh. | A player has useful control without report-count censorship. |
| No named modal confirmation existed for removal/blocking. | Existing native `Dialog` provides cancel/Escape/focus return, with explicit destructive action labels. | The player can understand and reverse the navigation safely. |

## Integration

`MapNotes` takes `playerId`, `position`, `fix`, `arena`, optional `notify` and optional `onBlockChange`. Key the component by player ID; internal response guards additionally bind player and mode. `onBlockChange` tells the root to clear/refresh map presence immediately. Drafts are in memory only. A player/mode change clears draft, photo, dialogs and pending interface state, while a saved operation ID is recovered only under its original player/mode key.

The component consumes authenticated `/api/messages`, `/api/messages/:id`, `/api/messages/:id/report`, `/api/messages/operation`, `/api/messages/operation/abandon` and `/api/social/blocks`. The backend owns authorization, validation, idempotency, moderation, media gating and block enforcement; client visibility is not a security boundary.

Only JPG/PNG/WebP files below 1 MB enter the upload flow. The server sanitizes actual image bytes and strips metadata. The extra author GPS requires real mode, finite coordinates, accuracy no worse than 35 m, capture age no more than 15 seconds and at most two seconds of future tolerance. Turning it off never makes the map anchor private. No draft text, image or precise location is stored in the browser journal.

A completed publication clears the draft only after an authoritative response or receipt read-back. A hidden/deleted receipt never republishes the note. An uncertain request freezes its exact in-memory payload and keeps the same ID. After a reload, raw content is unavailable; the user can check or permanently abandon the old operation before starting fresh. Abandoning an operation that already completed returns its existing result rather than deleting a published note.

Block/remove/report confirmation results are shown only for the current player/mode. Removal and blocking do not claim to erase copies already saved by other people. Reporting enters a project review queue; it does not automatically hide a note or establish that a human has already reviewed it.

## Interface fixture and checks

`/dev/map-notes.html` mounts the real component with an in-memory HTTP fixture. It never publishes to the real server, uses a wallet, requests location permission or creates on-chain content. Useful cases:

- `?state=empty`, `?state=error`: empty and failed list reads.
- `?arena=0`: real-world labels and the separately selectable synthetic GPS fixture.
- `?outcome=lost-after-save`: POST response fails after the fixture commits; receipt read-back recovers exactly one note.
- `?outcome=pending`: uncertain publication, disabled editing, status checks and explicit abandonment. The review control can make the attempt retryable.
- `?text=large`: enlarged form text. This is a layout fixture, not native OS text scaling.
- Review controls also toggle read failure and switch player while a request is pending.

Build/type checking passes. Root integration owns rendered 360px/390px, short landscape, desktop, focus/Escape, enlarged-text and actual API evidence; this document does not claim those checks before they are recorded. Physical Safari/iOS and Chrome/Android keyboard, photo picker, GPS and wallet/device acceptance remain separate release gates. The synthetic fixture does not simulate persistence of a real server across a full browser reload.
