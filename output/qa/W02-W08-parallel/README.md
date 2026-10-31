# Parallel W02 / W08 / W00–W13 integration

31 October 2026. Local working-tree delivery on the combined `8604df2` baseline.
Three subagents and the coordinator worked concurrently on distinct source areas;
the coordinator joined the app and navigation while agents delivered text drafts,
the real optional creator runtime/operator/recovery, and the creator interface.
No commit, push, deployment or chain transaction belongs to this batch.

## Player problem and scope

A player could lose an unfinished form or their place when leaving a panel. The
creator foundation was unreachable through the app. This batch joins continuity
with a free demo creator journey and independently reviewed publication. Existing
notes and sponsored tasks remain available under their own disclosures. The creator
feature is disabled by default and requires an explicit versioned host policy.

## Source findings / change / reason

| Before (source finding) | After (implemented) | Why / source |
| --- | --- | --- |
| Panel state lived separately and lacked a common browser history boundary. | Owner-scoped, strictly parsed presentation/target references support Back/Forward. | [`App.tsx`](../../../src/App.tsx), [`app-navigation.ts`](../../../src/app-navigation.ts), [`useAppNavigation.ts`](../../../src/useAppNavigation.ts). History contains no executable action, consent, GPS or financial authority. |
| Native dialogs could close independently from browser navigation. | A cancellable modal history entry coordinates Back, explicit Close and Escape without StrictMode's cancelled mount moving history. | [`Dialog.tsx`](../../../src/Dialog.tsx), [`dialog-history.ts`](../../../src/dialog-history.ts). Ordinary close preserves a simultaneous navigation choice. |
| Note, sponsored-task and inventory price text was ephemeral. | Explicitly allowlisted, bounded local text drafts are scoped to the player/form/realm; confirmed completion clears only the submitted revision. | [`draft report`](../W02-drafts/README.md), [`useFormDraft.ts`](../../../src/useFormDraft.ts). GPS, media, consent and wallet review are excluded. |
| A lost publication response could leave a second write looking like a fresh intent. | Durable opaque operation IDs and exact native-task client IDs recover deliberate retries against real receipts. | [`MapNotes.tsx`](../../../src/MapNotes.tsx), [`NativeTasks.tsx`](../../../src/NativeTasks.tsx), [`creator-community-client.ts`](../../../src/creator-community-client.ts). Navigation never sends a saved write. |
| Creator services were not mounted into normal app/server startup. | Authenticated optional runtime and Community/Following/Creators/My creations interface, private accepted revisions, trusted operator review/resolve/audit. | [`runtime report`](../W08-runtime/README.md), [`UI report`](../W08-community-ui/README.md). No invented activity rewards or native creator funds. |
| A published XP commitment was not reflected in the ordinary HUD. | Earned, locked and available demo XP remain distinct; current level uses available XP. | [`database.mjs`](../../../server/database.mjs), [`App.tsx`](../../../src/App.tsx). No earned XP is minted/burned and previously awarded items are not repeated on release. |
| Late world/profile/original-inventory reads could outlive their owner or realm. | Request epochs fence owner/realm/world/order; identity replacement clears world/GPS/presence state. Inventory remounts per owner and mutation snapshots update only their current owner. | [`read-epoch.ts`](../../../src/read-epoch.ts), [`App.tsx`](../../../src/App.tsx), [`Inventory.tsx`](../../../src/Inventory.tsx). Returning to arena invalidates the real GPS watcher before moving to HOME. |
| Creator rights had no whole-database restoration rehearsal. | Real WAL snapshots reopen with exact schema/rows, private revisions, follows, locks and historical receipts; retries create no duplicate rights. | [`restore report`](../W08-runtime/restore/README.md). Full-host/offsite/native-chain restoration remains separate. |

The creator composition was compared with adding all actions beside existing forms
and with a dense counters/editor dashboard. The implemented focused sections and
accepted-revision detail keep one primary purpose per view; see the [composition
comparison](../W08-community-ui/README.md).

## Verification

- [Final application suite](tests-final.txt): **408/408 passed**, zero failures or skips.
  The restricted first attempt could not listen on localhost; the complete rerun
  with local-server permission passed. No failing application assertion was hidden.
- [Production build](build-final.txt): TypeScript and Vite passed.
- `git diff --check`: passed.
- [Pure history checks](navigation-tests-final.txt): 12 passed; request epoch cases
  include order, actor/realm/world, A→B→A, logout/unmount and cross-stream tokens.
- [Creator backup/recovery checks](../W08-runtime/restore/tests.txt): 6 passed.

## Actual isolated-host journey

The host at `localhost:8796` uses a disposable SQLite database, no background
workers, no native attestor or signing key, and an unreachable native RPC. The
author's 1,000 XP is an explicit local test seed. The policy
`qa-w08-browser-v1` / 200 XP is a QA fixture, not adopted production tuning.

The author explicitly published a profile and entered a realistic free solo park
quest. Text survived leaving, Back and reload; visibility/publication consent did
not. Saving and versioned quote acceptance required deliberate actions. An actual
withdrawal made the earlier CLI review fail stale-version409, with no XP lock;
the author then saved revision2, obtained a fresh quote, accepted and submitted.
Independent CLI review approved the exact new version. The UI showed earned1,000,
locked200, available800, Level3 rather than another reward.

A separate fresh guest followed the author, found the quest in Following and
accepted revision2 through actual HTTP routes. Retrying returned the same receipt,
exactly one open participation, and no XP/GOLD/item/history/native award. See
[participant HTTP metadata](participant-http.json). Its cookie was stored only in
the private disposable QA directory, omitted from evidence, and removed during cleanup.

The author explicitly stopped new starts. The browser displayed Closing/one open
obligation and disabled finalization with its reason. [Trusted synthetic QA
resolution](participant-resolution.json) resolved that exact participation while
retaining its private revision and the 200-XP lock. After a fresh read, explicit
author finalization showed Closed, earned1,000/locked0/available1,000 and Level4;
GOLD stayed120,000. This is no physical completion or activity award. Exact
inventory/history/treasury retry invariants are automated service/restore evidence,
not inferred from the browser's XP display.

After those lifecycle observations, a single synthetic `QA Violet Loop` Aura was
inserted into only this disposable author's inventory for actual modal/price-draft
checks. It is an explicit UI fixture, not an earned quest reward. XP/GOLD were not
changed by that setup. No normal project database was modified by the setup.

Author browser and responsive details are recorded in
[creator browser observations](creator-browser-notes.md). UI checks use browser
viewports and focus/large-text approximations. They do not establish real mobile
Safari/Chrome, virtual keyboards, GPS, wallet-return, screen-reader or newcomer
acceptance.

## App navigation and form evidence

[Actual App navigation and native-dialog checks](app-navigation-browser-notes.md)
verify browser Back/Forward/reload, modal Back/Escape and focus, price retention,
new-player isolation and StrictMode close-plus-navigation.
[Notes/native-task fixture checks](fixture-browser-notes.md) verify retained text,
fresh consent/review, isolation and once-only simulated lost-outcome recovery.
Their synthetic data/transaction boundaries are explicit. Every affected form has
360/390, short-landscape, desktop and focused-height/large-text captures; these
remain browser approximations. Label inheritance was corrected within each
component, increasing contrast from 3.69:1 to 6.47:1.

## Remaining boundaries

Creator activity validation/rewards, native XP commitments, paid access, donations,
creator-pool allocation and production moderation/closure governance remain open.
The ordinary demo ledger retains its accepted 50/50 allocation. Real native and
Base-owned appearances remain separate from demo balances and local QA fixtures.
No full milestone is marked complete. Continue using [development status](../../../docs/DEVELOPMENT-STATUS.md)
and the [roadmap](../../../ROADMAP.md).

The temporary isolated host was stopped after checks. Temporary fixture tabs were
closed, viewport overrides reset, and the normal development preview retained.
