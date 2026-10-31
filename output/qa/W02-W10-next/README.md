# Parallel object craft, calm pickups and creator safety

31 October 2026. Three subagents plus the coordinator extended the existing local
working tree on `8604df2`. No commit, push, deployment, native transaction or normal
project database mutation belongs to this batch.

## Player problem and composition

World objects used several unrelated symbols, routine coin toasts could replace an
action error, and creator discovery lacked a player-facing report/block path.
This batch connects shared authored object states, quiet confirmed pickup totals,
private reports, bilateral blocking and an independently operated publication stop.

For pickup hierarchy, a separate floating ticker would occupy the walking map and
compete with action errors. Reusing the global toast would retain the original
priority problem. The implemented alternative places a small session summary in
the compact adventure toggle and desktop character HUD, with one separate coalesced
polite announcement. Error/result toasts keep their own purpose. Creator safety
uses secondary native disclosures and a focused dialog; discovery/start remains the
primary quest action. See the [UI composition rationale](../W08-W10-safety/ui/README.md).

## Before / After / Why

| Before (source) | After (implemented) | Why / source |
| --- | --- | --- |
| Coin SVG, canvas coin, Unicode diamond, generic zone ghosts and utility backpacks represented equivalent game objects differently. | A shared authored 32px rectangle family supplies SVG, DOM markers and MapLibre coin raster; list/map use common quest/zone state helpers. | [`art/provenance report`](../W02-object-art/README.md), `src/game-object-art*`, `src/GameMap.tsx`, `src/App.tsx`, `src/NativeCollectionControl.tsx`. No verified character art or world geometry changed. |
| A first linked quest could supply an unrelated or completed XP summary; missing quest data fell back to 50 XP. | The same eligible representative quest drives art and reward captions. Missing data says See activities/Activity details; unavailable chest items are not advertised. | `representativeZoneQuest`, `questObjectPresentation`, `src/App.tsx`. Selection, personal completion, shared prize claim and tier/time restriction remain distinct. |
| Each demo coin called the global toast with a hardcoded XP label. | Exact returned value/XP enter a scoped, bounded duplicate-resistant session accumulator; routine pickup never calls notify. Five-second batches announce once, with no delayed burst after hide/offline/error. | `src/pickup-feedback.ts`, `src/usePickupFeedback.ts`, `src/PickupSummary.tsx`. Session totals are presentation only and reset across player/world/realm/mode/reload. Wallet/history remain authoritative. |
| Overlapping collector intervals could return older player snapshots and start a second old-realm claim after navigation. | One abortable claim stream,15-second client timeout, owner/world/realm checks before each send, and foreground/online checks. A stale cleanup cannot release a newer stream. | `src/App.tsx`, optional AbortSignal in `src/api.ts`. Aborting a client request does not undo a server commit; history and idempotent server retries retain authority. |
| Essential action toast text inherited tiny/pale legacy styles. | Scoped16px text and semantic high-contrast surfaces; errors use alert semantics and suppress routine pickup announcements. | `src/pickup-feedback.css`, `src/App.tsx`. No financial error is replaced by a coin celebration. |
| Creator content had no player report/block controls or unsafe-publication operator action. | Private exact-revision reports, shared bilateral blocks and owned block list; trusted independent report review and audited suspension. | [`server report`](../W08-W10-safety/README.md), [`UI report`](../W08-W10-safety/ui/README.md). No public privilege route, invented award or automatic report-based punishment. |
| Stopping public discovery could otherwise obscure existing accepted instructions or prematurely return publication XP. | Suspension stops new starts, retains accepted revisions and unresolved obligations, keeps XP locked, and prevents author re-publication bypass. | `server/creators/lifecycle.mjs`, `safety.mjs`, `community.mjs`. Closure still needs independently resolved obligations and deliberate finalization. |

## Verification

- [Full application suite](tests.txt): **438/438 passed**, zero failures/skips.
- [Production TypeScript/Vite build](build.txt): passed at joined source checkpoints;
  the final capture/check records remain alongside this report.
- [Pickup/collection model cases](pickup-tests.txt): seven passed, covering exact totals,
  duplicate/foreign/malformed replies, suppression, bounded memory and overflow.
- [Creator safety/service/API/recovery cases](../W08-W10-safety/creator-tests.txt):
 72 passed, including14 new safety cases and real lost-response/HTTP/SQLite/WAL/CLI
  checks. Old-schema additive opening and default-disabled behavior are tested.
- [Object model checks](../W02-object-art/README.md): six passed; pure shared
  selection, state and raster bounds. New dev fixtures need their explicit
  typechecks because the normal app build excludes `dev/`.

Source/test findings, fixture rendering and actual-host behavior are separate
evidence scopes. Fixture transactions, reports, GPS and awards are simulated.

## Isolated actual host

[Host fixture metadata](host-fixture.json) records `localhost:8798`, a new private
SQLite database, disabled background workers/native attestations and an unreachable
native RPC. The author's1000XP and `qa-safety-v1`/200 commitment are explicit test
fixtures, not a production amount or award policy. Independent HTTP/CLI preparation
published **Riverbank Stories — Three quiet details beside the river**. Cookies are
private temporary test credentials and are excluded from public evidence.

The fresh walker accepted revision1 and reported it privately. Actual block/unblock
hid/restored public discovery without removing the accepted instructions. Trusted
report review alone left the quest Published; the separately authorized suspension
then produced Closing/version4 with one open obligation and 200 XP still locked.
Author XP/GOLD/inventory/history/native awards remained unchanged and both CLI
operation retries returned exact historical receipts. See [moderation metadata](moderation-host.json).
No physical hazard or completion was established.

After those safety checks, explicit arena movement collected two existing funded
demo coins. [Database verification](pickup-host.json) matches the displayed
0.02 demo GOLD/4XP; this is separate from unconfigured creator activity rewards.

The player/CLI safety journey and responsive evidence are recorded in
[`ui/browser-notes.md`](../W08-W10-safety/ui/browser-notes.md). Object fixture and
Welcome captures are in the [art report](../W02-object-art/README.md); authenticated
Explore captures are recorded separately by that actual-host journey. Pickup
browser evidence is in `pickup-browser-notes.md`.

## Boundaries and remaining work

Creator features remain disabled by default. Reports stay in the app's private
database; this is no SocialDB/IPFS publication, external alert service or staffed
moderation operation. Report review and suspension are separate deliberate operator
actions. There is no reopen capability, production appeal/support/retention policy
or physical safety finding in this slice. No creator activity reward, native XP
lock, creator fund, donation or paid-access settlement was activated. The50/50 demo
ledger and accepted balances/ownership are unchanged.

Real Safari/iOS, Chrome/Android, actual virtual keyboards/OS text settings, GPS,
wallet return, screen readers, field play and newcomer acceptance remain open.
Browser viewport and enlarged-text approximations cannot close those gates.
No milestone is declared complete. Continue from [development status](../../../docs/DEVELOPMENT-STATUS.md)
and [ROADMAP.md](../../../ROADMAP.md).

Cleanup: [the temporary host stopped and private setup credentials were removed](host-cleanup.json).
QA tabs were closed and viewport overrides reset. The isolated database/evidence
retain the intentionally unresolved obligation; cleanup did not finalize it.
