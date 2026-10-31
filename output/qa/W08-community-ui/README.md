# W08 Creator Community UI delivery

## Player problem and scope

The creator service foundation was not reachable through a player-facing flow. An author needs to keep a private draft, understand exactly which XP commitment is being quoted, request an independent review, and close a publication without removing instructions from explorers who already started it. Explorers need to distinguish approved discovery from their protected accepted revision, and distinguish this free demo from native quests and financial rewards.

This delivery adds the player interface and retry client. Host configuration, trusted review, independent completion resolution, and native/paid settlement belong to their existing service and operator boundaries. The feature remains disabled unless the host explicitly enables a versioned policy and trusted roles.

## Composition choice

| Composition considered | Player consequence | Decision |
| --- | --- | --- |
| Add every creator action beside existing notes and sponsored tasks | The next action would sit among several unrelated forms and financial contexts. | Rejected. |
| Make a dense creator dashboard with counters and simultaneous editors | It would privilege operational statistics over finding or writing a quest, especially on a phone. | Rejected. |
| Four compact sections with a separate private started list and focused detail/editor | Discovery, following, creators and private author work each have one primary purpose. Existing notes/tasks keep their own context. | Implemented. Disabled hosts get only a secondary native disclosure. |

## Source findings / implemented change / reason

These are code findings and implemented behaviors; they are not claims of observed playtest results.

| Before | After | Why / source |
| --- | --- | --- |
| Creator services had no mounted player journey. | Approved quest discovery, Following, Creators and My creations, with private accepted participations. | `src/CreatorCommunity.tsx`: focused sections and author/private-participant reads. |
| A local draft could be lost on navigation. | Allowlisted profile and quest text uses actor/form/realm-scoped retained drafts; asynchronous saves clear only their captured revision. | `src/useFormDraft.ts` shared hook; profile and quest editors mount after server initial data is loaded. Consent is never persisted. |
| A lost response could leave the caller unsure whether a write occurred. | Deliberate retry reuses a durable operation ID for identical terms; success requires a matching server receipt. A new confirmed intent gets a new ID. | `src/creator-community-client.ts`; no background replay and no optimistic XP/reward grants. Stable new-quest identity also supports explicit previous-save recovery. |
| A future creator plan could be mistaken for an available platform. | Verified status gates every enabled surface; demo/free and unconfigured rewards remain visible. Unsupported domains/policies fail closed. | `src/creator-community-types.ts` capability parser; disabled host makes no private creator requests. |
| A browser history entry could otherwise carry action state. | Strict navigation parser allows only section and safe quest/creator identity. | `src/creator-community-types.ts`; actor, amounts, consent and operation state are rejected. |
| Review/closure concepts were service-only. | Exact saved-version quote acceptance, submit/withdraw review, private rejection feedback, stop-new-starts and final closure are explicit. | `src/CreatorCommunity.tsx`; no player review/resolve endpoint or author-issued completion rewards. |
| A newer publication could obscure instructions accepted earlier. | Started quest detail displays the accepted immutable revision, including after public closure/hide. | Private `/me/participations` and per-quest participation projection. |

## Verification

- `node --test tests/creator-community-client.test.mjs`: **8 passed**, recorded in `client-tests.txt`. Includes a real SQLite/services/API commit with a deliberately lost response, remounted-client retry, no duplicate journal row, no profile/consent payload in retry storage, per-actor isolation, changed terms, follow true/false/true, unmatched receipts, new draft identity and unavailable storage.
- `npm run build`: passed; output recorded in `build.txt` (combined workspace, not an isolated release).
- `git diff --check`: passed at delivery preparation.
- Scoped semantic colors adopt the proposed error/error-surface pair in this component; existing runtime ink/action/surface/control-border tokens are reused. Parent browser QA verifies actual computed styles and contrast.

## Interaction and capture fixture

`dev/creator-community.html` renders the actual component against an explicitly labeled in-memory API simulation. It performs no real creator publication, XP locking or reward writes. State resets on page reload; retained browser text is intentionally independent. It is a visual/interaction fixture, not evidence that the live host API passed an end-to-end journey.

Use the running Vite origin with `/dev/creator-community.html?state=...`:

| State | Intended check |
| --- | --- |
| default, `following`, `empty`, `error`, `disabled` | Discovery, genuine empty/error/retry and secondary unavailable disclosure. |
| `profile` | Native public-visibility and fresh-consent controls; retained text, save, discard. |
| `editor`, `mine` | Private draft, save revision, versioned quote and submission. |
| `pending`, `rejected` | Withdraw/revise flow and author-only review feedback. |
| `closing` | Blocked finalization while participant obligations remain. |
| `accepted` | Protected earlier instructions while the public quest is unavailable. |

Append `&text=large` for the fixture's 200% text approximation. Parent owns browser coordination and integrated-host checks. Required capture matrix: 360px, 390px, short landscape and desktop; profile and quest forms with focus/keyboard-open approximation and enlarged text. Native controls, all essential targets >=48 CSS px, 16px body/input and 14px secondary text are implemented in scoped `src/creator-community.css`.

## Remaining boundaries

Real Safari/iOS and Chrome/Android hardware checks and physical-keyboard/virtual-keyboard behavior remain unverified by this agent. Browser screenshots and integrated journey evidence are produced by the parent delivery. Nearby ordering awaits real location metadata; no distance or walking route is invented. Native rewards, donations, paid access, production publication and creator-pool allocation remain outside this free demo interface. No commit, push or deployment was performed.
