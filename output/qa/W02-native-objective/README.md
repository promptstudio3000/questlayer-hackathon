# W02 native objective continuity

31 October 2026. Local continuation of the demo continuity slice on `8604df2`.
W02 and W06 remain building. No deployment, contract change, chain transaction,
wallet signature or physical GPS evidence was produced by this slice.

## Player problem and scope

Source findings before implementation: `App.tsx` retained native coordinates in
component state, cleared them on an account/day/read-error transition and selected
the first linked wallet after reload. `NativeExpeditions.tsx` separately retained
its chosen quest/coin. A player could return to another walk or lose their selected
checkpoint even though their authoritative progress and receipt still existed.

Reuse the compact objective and full detail composition from the preceding slice.
Keeping a cached target visible during errors would imply current availability;
silently deleting the selection would lose navigation context. The selected
composition retains identity, hides an unverified map marker and opens a recovery
card with Refresh, reward receipts and Browse actions. No new overlay or dialog is
introduced.

| Before / source finding | Implemented after | Why / source |
| --- | --- | --- |
| Coordinates and chosen index lived in separate local states. | One player/account-scoped bookmark binds testnet, reward contract, day, manifest hash, kind and index. | `src/native-objective.ts`, `src/useNativeObjective.ts`, `src/NativeExpeditions.tsx`. No coordinate, checkpoint count or reward amount is restored from storage. |
| Reload selected the first wallet. | Restore the last deliberately selected account only while it remains linked; guest browsing has a distinct bookmark. | `useNativePlayAccount`, `src/App.tsx`. A preference cannot link or authenticate an account. |
| A failed read deleted the map target. | Preserve the bookmark while hiding the marker; fresh data restores the same current checkpoint. | `resolveNativeObjective`, `useNativeObjective`. A 30-second stale-read bound matches the existing collection controller. |
| A missing nearby coin could be mistaken for a claimed coin. | Explain that it may be farther away or collected. Only an exact own receipt establishes pending/confirmed state. | `resolveNativeObjective`; the server nearby read is bounded to 1 km / 128 unclaimed coins. No new unbounded lookup was added. |
| Completed progress and pending settlement were easy to conflate. | Recorded without a receipt, queued/retrying, and confirmed have distinct recovery text. Own receipts remain accessible after day rollover. | `src/native-objective.ts`, `NativeExpeditions`. Another account's shared prize does not consume personal XP eligibility. |
| Receipt navigation opened a general Wallet view. | View reward receipts opens the actual disclosure, scrolls to it and focuses its native summary. | `src/App.tsx`, `data-native-receipts` in `NativeExpeditions`. No celebration occurs on restore. |
| Manual controls could remain enabled between day expiry and the next poll. | Fresh account/network/day/publication checks disable manual visits with a reason, including at the exact end boundary. | `nativeVisitReadReason`, `NativeExpeditions`. Server settlement remains authoritative and unchanged. |
| A long recovery message could outgrow the fixed compact sheet. | Native summaries can grow/scroll within the bounded phone sheet; text wraps and focus remains visible. | `src/play-ui.css`. Memoized target coordinates/text prevent unchanged clock ticks from recreating the marker. |
| Native focus used fixed phone/desktop offsets (source). | Current panel bounds place the selected marker in the visible map after layout changes; manual pan does not itself restart focus. | `src/GameMap.tsx`. The existing reduced-motion camera check is retained. |

## Verification

- `tests.txt`: **363/363 application tests passed**, no failures or skips. This
  includes the 44 creator cases and existing native receipt/economy checks.
- `objective-tests.txt`: **13/13** new targeted cases. They cover current checkpoint
  reconstruction, corrupt/foreign bookmarks, linked-account preference, guest
  isolation, wrong account/network/contract/manifest/day, read failure/preparation/
  stale time, exact own receipt identity, queued/retrying/confirmed settlement,
  post-rollover receipts, missing coins, expiry/completion/invalid coordinates,
  shared-prize versus personal rights and manual-action read guards.
- `build.txt`: final TypeScript/Vite production build passed.
- No contract source changed; the previous Rust results were not rerun.

Browser interaction uses the **actual App and hooks** in
`dev/native-objective.html`, with deliberately synthetic read responses. The
fixture identifies its explorer/accounts as fixtures, denies all unspecified API
operations, supplies no real GPS and never signs or submits a visit. These checks
establish client behavior against controlled data, not a new live testnet proof.

Observed scenarios:

1. Choose Riverbank expedition rather than the default Park trail, show it on the
   map and reload: the selection restores Stop 2 of 3. A fresh progress response
   changes it to Stop 3 of 3.
2. Switch Alice to Bob and reload: Bob remains selected and Alice's objective is
   absent. Switch back to Alice: her own selected expedition returns.
3. Fail the read: saved selection and a retry action remain, the native target
   marker count is zero, and retry does not discard the bookmark. A later fresh
   response restores the objective. Stale reads similarly hide the marker.
   Choosing another target from stale data is disabled; Refresh remains available.
4. Pending/retrying and confirmed response projections produce different cards.
   Enter on View reward receipts opens/focuses the actual Wallet disclosure;
   no toast/reward celebration is created.
5. An expired native day shows its ended state and receipt link. A selected coin
   survives reload; omission from the nearby view shows uncertainty instead of a
   false claim. An exact own coin receipt displays retrying or 0.001 GOLD / 2 XP
   confirmed as supplied by the fixture. No duplicate Collect action is offered.
6. Enter on Browse current walks returns focus to Park trail's heading. The native
   Receiving wallet control is keyboard-focusable; Escape closes its native menu
   and retains focus. The short input-viewport check measured a 326×48 CSS px control
   at 16px with no document horizontal overflow.
7. Rotate the compact objective into 844×390: the panel occupies the right side,
   leaving a useful map area. Explicit Show next stop places the marker to its
   left. A deliberate map drag stays where the user moved it across later clock/
   refresh updates; Show next stop deliberately resumes target focus. DOM positions
   are retained in `manual-pan.json`.

| Viewport/state captured | Screenshot |
| --- | --- |
| 390×844 restored checkpoint | `390-restored-stop2.png` |
| 360×640 selected walk and account reload | `360-selected-walk.png`, `360-bob-after-reload.png` |
| 360×640 refreshed checkpoint | `360-restored-stop3.png` |
| 390×844 error recovery | `390-error-recovery.png` |
| 390×844 pending receipt | `390-pending-receipt.png` |
| 844×390 detail after scrolling to the action | `844x390-pending-scrolled.png` |
| 844×390 compact objective beside the map | `844x390-compact-target.png` |
| 1280×720 confirmed receipt | `1280-confirmed-receipt.png` |
| 390×844 open/focused Wallet receipt | `390-wallet-receipt-focus.png` |
| 390×844 enlarged 32/28px summary text | `390-enlarged-pending.png` |
| 390×460 focused native account control | `390x460-account-focus.png` |
| 390×844 expired day | `390-expired-day.png` |
| 390×844 final current stop | `390-final-current-stop.png` |
| 390×844 restored / missing / confirmed coin | `390-restored-coin.png`, `390-coin-not-nearby.png`, `390-confirmed-coin.png` |

Short landscape deliberately uses the existing scrollable detail surface. Its
initial top view is retained in `844x390-pending.png`; scrolling/focusing reaches
the recovery message and both actions. Enlarged text and short height are browser
approximations, not physical keyboard, browser-zoom or hardware acceptance.

`render-metrics.json` records the rendered compact control at 390px: its open
target was 290×98 CSS px and its clear target 48×98, with no document horizontal
overflow. On the actual opaque `#302441` surface, primary/secondary text contrast
measured 14.44:1 / 10.73:1. These figures describe this control, not the whole app.

## Remaining boundaries

This is a navigation bookmark, not a receipt backup, account-recovery method,
location proof or permission to replay a visit. Public account/day/manifest IDs are
stored locally; private keys and GPS fixes are not. Reward totals, available funds,
progress and exact receipts always come from fresh service responses. Receipt
history is currently bounded; a completed walk without a visible receipt says
recorded and links to Wallet rather than inventing a confirmed amount.

Actual Safari/iOS and Chrome/Android, hardware keyboard/zoom, screen readers,
physical GPS, live account/wallet return and service restart journeys remain open.
Model identity/timestamp cases are tested; not every rejection was exercised through
a live provider. Form-draft continuity, browser-history Back, newcomer observations,
field access review and the full W02/W06 acceptance gates remain outstanding.
Creator APIs, rewards, tiers, ownership, XP policy, financial settlement and the
deployed application were unchanged.
