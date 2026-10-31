# W02 adventure continuity: local delivery evidence

31 October 2026. Baseline `8604df2`; local source changes only. W02 remains building.

## Player problem and composition decision

Observed in the running local application before implementation: select **Find the
park chest** at Chvojkovy lomy, reload, and the selected activity disappears. Source
also retained an entire selected zone object while world reads refreshed separately.
Generic Close controls did not name the adventure being resumed.

| Composition considered | Decision |
| --- | --- |
| Only retain the generic X and silently restore selection | Smallest surface, but the return destination remains unclear. |
| Add an always-visible floating objective over every panel | Keeps the destination visible, but competes with forms and the map on a phone. |
| One labelled return row inside an open panel; compact objective on Explore | Implemented. Names the retained zone/target, uses the panel's scroll space and returns focus to visible Explore controls. |

| Before / evidence | After | Why / source |
| --- | --- | --- |
| Reload lost the selected adventure (observed). | Player/realm-scoped browser bookmark stores only world, zone and optional activity IDs. | Reconstruct navigation from fresh data; `src/adventure-selection.ts`, `src/useAdventureSelection.ts`. |
| `selected` was a retained Zone object (source). | Selected zone/activity resolve against the current World on each render. | Updated checkpoints, completion, tier/access and shared-claim data remain authoritative; `src/App.tsx`. |
| Generic panel close (source). | Back to adventure names the destination and restores keyboard focus. Home preserves selection. All zones/overview/globe still deliberately clear it. | Explicit navigation without adding an overlay; `src/App.tsx`, `src/play-ui.css`. |
| No returning-selection expiry explanation (source). | Unavailable/expired saved content is cleared with an actionable Choose another discovery surface. | No old target is presented as current; `src/useAdventureSelection.ts`, `src/style.css`. |
| Switching to NEAR cleared the demo selection (source). | Hide the demo bookmark while native mode/target owns Explore; switching back restores it. | One visible objective and separate domains; `src/App.tsx`. |

## Verification

- `tests-local-http.txt`: **350/350 application tests passed**, no failures/skips.
  `tests.txt` retains the first restricted run: 345 passed and five local-listen
  cases failed with EPERM. Rerunning with local-server access passed all 350.
- `build.txt`: final production TypeScript/Vite build passed.
- `tests/adventure-selection.test.mjs`: seven cases cover untrusted/corrupt
  bookmarks, player/realm boundaries, missing/failed world reads, day rollover,
  expired/removed/misassociated content and actual refreshed completion/checkpoints.
- Actual local browser: select chest → reload → same activity; Inventory/Market/
  Map notes → Back to adventure; keyboard Enter returns focus to the Explore sheet
  control; switching Demo → NEAR → Demo restores the demo activity.
- Actual solo demo: Move here → Open the chest confirmed Northern Lights #3 and
  80 XP → Back to quest → reload retained COMPLETED with disabled action and no
  repeated reward dialog → Inventory retained the Aura → Equip saved Above → Escape
  returned focus to its inventory item. The map's accessible appearance included
  Northern Lights above. No wallet, native payout or physical visit was used.
- `dev/adventure-continuity.html?state=offline-world` renders the actual App while
  deliberately failing only world reads. Returning to the ordinary app retained
  the same completed objective. `?state=expired` deliberately expires only fetched
  zone/activity projections; it cleared the bookmark and rendered the actionable
  notice. These are labelled fixture cases, not live outages/day rollover or changes
  to server records. The notice action opened the discovery list.

| Captured state | Screenshot |
| --- | --- |
| 360×640 Inventory with return row | `360-inventory-return.png` |
| 360×640 compact restored objective | `360-restored-objective.png` |
| 390×844 Market with return row | `390-market-return.png` |
| 844×390 Map notes with return row | `844x390-notes-return.png` |
| 1280×720 selected adventure | `1280-explore-objective.png` |
| 390×460 focused note input | `390x460-note-input.png` |
| 390×844 return text at 32/28px (fixture) | `390-enlarged-return-fixture.png` |
| 390×844 expired objective (fixture) | `390-expired-fixture.png` |
| 390×844 expired objective at 32/28px (fixture) | `390-enlarged-expiry-fixture.png` |
| Server-confirmed demo chest | `confirmed-demo-chest.png` |
| Completed chest after reload | `completed-after-reload.png` |
| Failed world read (fixture) | `offline-world-fixture.png` |

The inspected ordinary portrait layouts had no document horizontal overflow. The
return target measured 326×60.3 CSS px at 390px; the compact objective measured
310×100 at 360px. The 390×460 focused-input case is a reduced viewport approximation,
not a hardware keyboard test. The return row scrolls with the form and can be
reached by normal scrolling or keyboard navigation. Enlarged text reflows; the
expired compact sheet can grow/scroll within half the viewport.

`enlarged-render-metrics.json` records the inspected opaque white return surface:
primary purple text has 6.63:1 contrast and secondary text has 6.71:1 contrast.
These measurements apply to this rendered control, not every existing app surface.

## Remaining limitations

This does not persist native target coordinates/receipts, create a native activity
policy, synchronize devices, preserve every form draft or implement browser-history
Back. GPS bookmarks restore only after a matching GPS-world response; reload still
starts in the labelled arena and does not request GPS or replay saved coordinates.
The bookmark never grants XP/items, validates location or replays a celebration.
Storage failure leaves ordinary in-memory navigation usable. Existing contracts,
creator services, financial policies and production deployment were unchanged.

Real Safari/iOS and Chrome/Android, native keyboard/200% browser zoom, screen readers,
reduced-motion device settings, physical GPS, multi-account browser journeys and
five-newcomer observation remain open. Source tests cover account isolation; the
browser walkthrough used one disposable local demo explorer. No usability score,
performance claim or whole-milestone acceptance follows from these checks.
