# Confirmed pickup browser checks

31 October 2026. Chrome desktop with explicit viewport overrides. The actual
compiled App used the disposable `localhost:8798` host. The separate Vite feedback
fixture used simulated receipts and made no API requests or balance changes.

## Actual funded demo pickup

After all creator safety assertions were complete, the existing QA safety walker
used **Move here in demo** for the selected Chvojkovy lomy activity. No quest claim,
GPS request or wallet action was made. This explicit arena move reached two existing
funded demo coins. Actual claim replies produced **2 coins / 0.02 demo GOLD / 4 XP**;
the header became120,000.02 GOLD and the HUD4XP. No per-coin toast was shown. The
single coalesced live status included the exact two-coin amounts and session total.

[Read-only database verification](pickup-host.json) independently confirms exactly
two matching claims/history entries totaling20,000 micro-GOLD, XP4 and no native
awards. The author still has1000earned/200locked/800available XP, unchanged GOLD,
inventory/history and zero native awards; the moderated creator quest remains
Closing/version4 with one open accepted revision1. These later demo coin awards
are not creator completion rewards or physical-location evidence.

Actual App captures: `actual-pickups-360x780.png`, `390x844`, `844x390` and
`1280x800`. [Computed measurements](actual-pickup-measurements.json) record no
document overflow; summaries are14px/#665577; the compact sheet measures182px in
all three small/landscape viewports. Desktop puts the same session summary in the
character HUD. The widget does not create another floating map overlay.

Reload retained the authoritative120,000.02 balance and4XP while resetting the
presentation-only session count/live status. There was no replayed pickup result.
The real balance/history, not this temporary counter, is the durable record.

## Synthetic adverse presentation fixture

`/dev/pickup-feedback.html` uses actual `usePickupFeedback`, `PickupSummary` and
`PickupAnnouncement`. The page explicitly says its receipts are simulated.

- Five confirmations produced5coins/0.05; replaying the last receipt kept5.
- Showing an action error, then another five-coin burst, retained the original
  alert and updated the quiet total to10/0.1. After more than the five-second
  batching window, the live status stayed empty. Removing the error did not replay
  that suppressed burst.
- A new single confirmation then produced11/0.11 and one new status containing
  only1coin/0.01/2XP, plus11this session. Replaying it kept those totals.
- Switching the synthetic player cleared the summary/live status immediately.
  A final replay explicitly retains its original actor scope and is rejected in
  the new player session; Replay is disabled before any simulated receipt exists.
- Normal fixture captures cover360/390, short landscape844×390 and1280×800.
  `pickup-fixture-measurements.json` records document widths and control targets.
- `?text=large` approximates32px text at 360/390 without document overflow; see
  `pickup-large-measurements.json` and `pickup-large-WIDTHx844.png`.

The tests inspect the live-region DOM, not speech from an actual assistive device.
This widget has no text-entry form; the separate creator report checks include
focused-textarea/reduced-height cases. Real devices, OS text/zoom, virtual keyboards,
screen readers and interrupted physical walks remain unverified.

## Source correction and limits

Routine confirmed pickups previously wrote into the same toast as action errors,
with a hardcoded2XP caption. They now consume exact API value/XP without calling
notify. The scoped summary and separate five-second announcement preserve error
priority. Client memory is bounded at 2048 identities and fails to an explicitly
paused counter rather than evicting an identity and counting a replay again.

The new pure request fence covers owner/world/realm, matching world mode, loading,
foreground/online status and expiry. One abortable request stream prevents overlapping
collector intervals; timeout/abort does not claim to roll back a server award.
See `tests/demo-collection.test.mjs`, `tests/pickup-feedback.test.mjs` and
`pickup-tests.txt`. No reward amounts, treasury split, eligibility, native provider
or world geometry were changed.
