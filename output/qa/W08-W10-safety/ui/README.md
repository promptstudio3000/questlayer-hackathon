# Creator safety interface

## Player problem and composition

Explorers could start a free creator quest but could not report an unsafe instruction or manage a shared player block from that surface. Hiding public content must not erase the saved instructions or silently resolve an admitted obligation.

Two compositions were considered: putting report/block beside Start as equally prominent actions, or using a secondary safety disclosure with a deliberate native dialog. The latter keeps the next free adventure clear while making safety reachable and its consequences explicit. My creations links to an owned, paginated blocked list; accepted quest detail also links there.

## Before / after / why

| Source finding before | Implemented after | Why / file |
| --- | --- | --- |
| Quest detail had only public attribution and Start or accepted instructions. | Native Quest safety disclosure opens a reason/context/private-review dialog for the exact accepted revision, preferentially over any newer public version. | Protect earlier rights and avoid reporting a silently substituted version. `src/CreatorCommunity.tsx`, `src/creator-community-types.ts`. |
| Public creator pages offered follow only. | Explicit block confirmation explains bilateral notes, profiles, follows, presence and discovery effects; existing accepted instructions and obligations remain. | Uses the shared player-block relation instead of inventing a second social permission system. `src/CreatorCommunity.tsx`. |
| A hidden public profile had no recovery management path. | My creations → Blocked creators is actor-owned, bounded/paginated, with private attribution fallback and explicit unblock confirmation. | Unblock remains usable after hide or reverse block; it cannot remove someone else's block. |
| A generic unknown-outcome toggle could retain an obsolete receipt through a later opposite intent. | An explicit opposite block/follow intent supersedes the previous unconfirmed toggle; a later new intent gets a new operation ID. Identical deliberate retries still recover the original receipt. | Prevent true/lost/false/true from replaying an obsolete confirmed receipt. `src/creator-community-client.ts`. |
| Report text had no continuity policy. | Only optional context is retained under current player/quest/revision. Reason and confirmation start fresh on each dialog opening; neither is stored or serialized into navigation. | Recovery without restored consent. Uses shared `useFormDraft`. |
| Safety requests had no focused pending/error/result state. | Native controls freeze while pending; service failures stay in the dialog; confirmation comes only from a matching server operation receipt. Cancel/Escape/Back close the dialog without implying cancellation of an in-flight request. | Reuses `src/Dialog.tsx` and its existing focus/history behavior; no new primitive or dependency. |

## API and privacy

- `PUT /creators/:id/block`: desired `blocked` boolean and durable operation ID. It removes only the current player's block direction on unblock.
- `GET /me/blocks?limit=20&cursor=...`: owned records only, private fallback when no public attribution is available.
- `POST /quests/:id/reports`: positive revision, one of `unsafe-place`, `abuse`, `misleading`, `other`, optional context up to 1,000 characters, durable operation ID.
- Reports prefer accepted instructions, including after public hide/block/closure. Private participation projections include an opaque creator reference with public name only when permitted.
- No raw GPS, media or contact field is attached. Optional report context is private review data; public creator/operator findings are not invented. Report/block does not quit, complete or resolve a quest, create rewards or change XP policy. There is no player moderation control.
- Strict history adds only `{page:"blocked"}`. Dialog, reason, consent, operation, actor and amount state are rejected from navigation.

## Source verification

`node --test tests/creator-community-client.test.mjs`: **11 passed**, recorded in `client-tests.txt`. New cases cover accepted revision targeting after hide/block, forbidden action fields in navigation, opposite unknown-outcome toggle supersession, and a real SQLite/services/API report committed after block with its response lost: remounted retry recovers the same receipt, exactly one report remains, private detail stays out of receipt/retry storage, and accepted instructions remain.

`npm run build` passed (`build.txt`); `git diff --check` passed. No dependency, server, App, economy or shared-doc change was made by this UI agent. Combined browser and device claims belong to the separate browser notes and parent report.

## Fixture matrix

Use the running Vite origin with `/dev/creator-community.html` (explicit simulated API banner, no real publication/locking/rewards):

- `?state=safety`: public quest; start, report and block/unblock.
- `?state=safety-blocked`: owned blocked list.
- `?state=safety-blocked-accepted`: public content hidden; accepted instructions and report target retained.
- Add `&fault=report-error` or `block-error` for service failures.
- Add `&fault=report-lost` or `block-lost` for a committed action with its first reply lost. Deliberate identical retry recovers the fixture receipt.
- Add `&fault=hidden-name` to blocked list for private attribution fallback.
- Add `&delay=1` for explicitly labeled 1.5s simulated writes, to inspect pending controls.
- Add `&text=large` for 32px text approximation. This is not real browser zoom or a virtual keyboard.

Actual authenticated safety behavior, simulated recovery checks and responsive evidence are recorded in [browser-notes.md](browser-notes.md). Physical iOS/Android checks remain outside this local source delivery. No commit or deployment was performed.
