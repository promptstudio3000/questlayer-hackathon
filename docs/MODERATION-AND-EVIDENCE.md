# Operator moderation queue and private photo evidence (W10.3, W10.4)

Testnet only. Nothing here moves funds or changes a contract.

## One moderation queue

`server/moderation.mjs` gives operators one queue for four kinds of player content.

| Kind | Where reports come from | Actions |
| --- | --- | --- |
| `note` | `POST /api/messages/:id/report` (existing, `social_reports`) | hide, restore, dismiss, tombstone |
| `record` | `POST /api/moderation/reports` `{kind:"record", targetId:<noteId>, reason, detail?}` | hide, restore, dismiss, tombstone |
| `quest` | creator Community report (existing, `creator_reports`) | hide (suspend), dismiss |
| `evidence` | `POST /api/native/tasks/evidence/:id/report` (sponsor or arbiter only) | hide (withhold), restore, dismiss, tombstone (erase) |

The flow is report → review → decision.

- **Report.** Each reporter files one report per item, at most 20 a day across records and evidence. A reporter can't report their own record. Blocked players can't see or report each other's content. The number of reports never hides anything on its own.
- **Review.** `queue` groups open reports per item and shows the content preview, report reasons and details (operators only), the current state and the allowed actions.
- **Decision.** Every decision resolves the item's open reports and appends one row to `moderation_audit`. Each row holds the operator, kind, target, action, reason, the state before and after, and the resolved report IDs. Rows are hash-chained (`prev_hash`, `hash`), so `verify` detects any later edit or deletion.
- **Hide vs. tombstone.**
  - *Hide* can be undone. The content stays stored, and `restore` brings it back.
  - *Tombstone* can't be undone. For a note, it clears the text, position and photo reference and retires the image file through the existing grace-period cleanup. For a record, it does the same to the underlying note and permanently blocks republishing. For evidence, it deletes the file at once.
- **Records on NEAR Social.** Hiding or tombstoning a record stops the app from showing it, republishing it (`prepare` refuses) or pinning its photo. The copy already written under the author's own SocialDB account can't be erased by an operator; the record view says so.
- **Quests.** Hiding a quest uses the creator lifecycle `suspend`, which keeps admitted participants' rights and open obligations. Each open report is then marked `confirmed`. Dismissing marks the reports `dismissed`. Quest decisions also need the operator to be listed in `CREATOR_MODERATORS`.

### Operator CLI

The HTTP service never grants operator rights. Authority comes from OS access to the database:

```sh
node server/cli/moderate.mjs queue  --database /abs/state.sqlite --operator alice [--state open|resolved] [--kind note,record,quest,evidence]
node server/cli/moderate.mjs decide --database /abs/state.sqlite --operator alice \
  --kind record --target message_… --action hide --reason "Shows a house number" --apply
node server/cli/moderate.mjs audit  --database /abs/state.sqlite --operator alice [--kind note] [--target ID]
node server/cli/moderate.mjs verify --database /abs/state.sqlite --operator alice
```

For an evidence item, `queue` prints the private file path so the operator can inspect it locally. The older `server/cli/moderate-notes.mjs` still works for notes, but it doesn't write to the hash-chained audit log.

## Private photo evidence for sponsored tasks

`server/task-evidence.mjs` and the photo picker in Community tasks.

1. A claimant who can submit or appeal on a task uploads one JPG, PNG or WebP photo of at most 1 MB. The server re-encodes it to a JPEG of at most 1024 px with no EXIF or GPS data. It stores the file under `.data/evidence/` (directory mode 0700, file mode 0600), outside every public path, and returns its SHA-256.
2. The client commits the photo inside the normal on-chain evidence hash: `content_hash = sha256(JSON.stringify({text, reference, photo}))`, with exactly that key order. Without a photo the hash is the same as before, `{text, reference}`. The chain only ever holds the hash.
3. While the photo is unbound (`staged`), only the uploader can see it. Once an on-chain submission from the same wallet commits this exact photo hash, it becomes `committed`, and the task sponsor and the disclosed arbiter can open it. Each reviewer view is logged in `task_evidence_views` (kept for 90 days). Nobody else can read it: there is no listing, public URL or pinning, and the response is `private,no-store`.

| Rule | Value |
| --- | --- |
| Unbound photo retention | erased 24 h after upload |
| Bound photo retention | erased 30 days after the task settles, never later than 60 days after upload |
| Uploads per player | 6 per hour, 20 per day |
| Live photos per player and task | 3 |
| Live photos on the host | 5000 |
| Concurrent decodes | 2 |

The uploader can erase their photo at any time. Moderation can withhold a photo (reversible) or erase it. Erasing deletes the file immediately and keeps only a content-free row plus the hash. The hourly maintenance pass expires photos that are due and removes orphan files older than an hour. The state backups (`deploy/backup-state.py`) deliberately don't copy `.data/evidence`, so private photos don't outlive their retention period inside backups.

### UI states

- **Claimant picker:** idle (*Add private photo*), working (*Removing location data…*, *Uploading privately…*, *Erasing photo…*), ready (thumbnail, retention countdown, *Erase photo*), error (a 429 rate-limit message says text evidence can still be submitted). A staged photo comes back after a reload.
- **Reviewer, arbiter and claimant receipt:** checking, loading, photo shown, withheld while moderation reviews it, erased by retention, by the uploader or by moderation, and *Report this photo*.

### HTTP

| Method and path | Who |
| --- | --- |
| `POST /api/native/tasks/evidence` `{accountId, taskId, image}` | claimant on a task that is open to them |
| `GET /api/native/tasks/evidence?accountId&taskId` | own photos; plus committed photos for the sponsor or arbiter |
| `GET /api/native/tasks/evidence/:id?accountId&taskId` | image bytes for the uploader, sponsor or arbiter |
| `DELETE /api/native/tasks/evidence/:id` | uploader |
| `POST /api/native/tasks/evidence/:id/report` | sponsor or arbiter |

Every route needs a session and a wallet linked to that session. Each player can make 60 evidence requests per minute.

## Still open

- Staffed moderation service, published appeal policy for moderator decisions, and moderation SLAs.
- An operator web console. The CLI is the only operator surface by design for now.
- A device pass of the photo picker on real phones, scheduled with the whole-game device verification.
