# Creator Community browser verification

Date: 2026-10-31. Actual isolated host: `http://localhost:8796/`; QA database `/private/tmp/questlayer-parallel-qa/game.sqlite`. No normal `.data` mutation, wallet signing, real/testnet payment, actual GPS request, commit or deployment was performed.

## Actual author journey

The browser was signed in as the seeded QA creator, with an explicitly published **Plzeň Path Stories** profile and 1,000 earned demo XP. All following lifecycle observations used the actual authenticated API through player controls; independent review and participant resolution were performed separately by trusted CLI operators.

1. Opened Community → My creations → New quest. Entered **Three quiet details in Šafaříkovy sady**, a free solo observation break on public park paths, with no timed route, upload, purchase, GPS requirement or configured reward.
2. Left the editor, used browser Back, and reloaded. Both title and full instructions remained. The interface said the local text draft was restored. No server creation occurred until explicit **Save private draft**.
3. Saving created `creator-5ed881ca-35de-4b0d-8520-2750fd941889`, revision1. The publication quote showed policy `qa-w08-browser-v1`, 200 additional demo XP and 1,000 currently available XP. Acceptance initially unchecked; Submit disabled.
4. Explicitly checked acceptance, then left/Back/reloaded before submitting. The quote was absent after reload. Requesting a fresh quote produced an unchecked acceptance control and disabled Submit. Explicitly accepted again and submitted; UI confirmed In review with 0 XP committed and said submission does not reserve XP.
5. **Operator mistake recorded:** while intending to inspect focus, I activated Withdraw review. UI correctly confirmed withdrawal and required a new revision before resubmission. Parent's independent approval using the earlier expectedVersion2 was refused with stale-version409; no approval or XP lock occurred. I then saved revision2 and explicitly accepted/submitted its new quote. Read-only QA metadata established pending_review, expectedVersion5. No further lifecycle control was activated while approval was pending.
6. Independent CLI approval of exact version5 produced published version6/revision2. UI Refresh showed Published, 200 XP committed, available800 and Level3. Expanded My creations XP showed **earned1,000 / committed200 / available800**. GOLD remained120,000.
7. A separate HTTP participant journey followed/discovered/started revision2. Runtime evidence establishes exactly1open obligation and no participant award. Author UI reloaded that state. Explicit **Stop new starts** confirmed Closing while retaining the200XP commitment. **Finalize closure and return XP** was disabled, with the visible reason that1participant obligation must be independently resolved.
8. After the trusted operator resolved that exact obligation, UI Refresh showed Closing,0open and200XPstillcommitted. Only then did I explicitly select **Finalize closure and return XP**. UI confirmed Closed,0XPcommitted and retained stable identity/instructions.
9. Expanded My creations totals then showed **earned1,000 / committed0 / available1,000 / Level4**. GOLD remained120,000. This directly verifies XP return without new earning. I did not infer an author inventory delta from the XP display: no actual-host before/after author inventory snapshot was retained. Automated creator runtime/restore tests separately compare exact inventory, history, treasury and native-award rows across lock/release and historical retries (`tests/creator-restore.test.mjs` and runtime coverage); those are automated evidence, not browser observations.

The mistaken withdrawal is an observed test-operator action, not a spontaneous UI behavior. The source version check prevented stale approval. Subsequent inspection used read-only DOM measurements, native text-field focus, and explicit intended lifecycle actions.

## Responsive and keyboard observations

Actual-host captures and computed DOM measurements are in `creator-computed-measurements.json`. Every recorded actual viewport had `documentElement.scrollWidth === clientWidth`; all creator buttons measured at least48CSSpx high, and profile checkbox labels measured at least48CSSpx. Checkboxes themselves are native24px controls inside those larger labels. These are rendered measurements, not a device-usability score.

| Viewport | Captured state |
| --- | --- |
| 360×780 | `creator-mine-xp-360x780.jpg`, `creator-profile-focused-360x780.jpg`, `creator-quest-editor-focused-360x780.jpg` |
| 390×844 | `creator-profile-focused-390x844.jpg`, `creator-quest-editor-focused-390x844.jpg`, `creator-closing-one-open-390x844.jpg`, `creator-finalized-closed-390x844.jpg`, `creator-finalized-xp-restored-390x844.jpg` |
| 844×390 | `creator-profile-landscape-844x390.jpg`, `creator-profile-landscape-focused-844x390.jpg` |
| 1280×800 | `creator-profile-focused-1280x800.jpg`, `creator-finalized-xp-restored-1280x800.jpg` |
| 390×480 | `creator-profile-keyboard-approx-390x480.jpg`: focused display-name input remains visible with reduced viewport height; this approximates occlusion and does not open a real virtual keyboard. |

Native Tab moved focus from Public display name to About your quests. Focus outlines were visible. Short landscape requires vertical panel scrolling; refocusing a field brings it into the visible region. The persistent section header/navigation consumes space above focused editor content; screenshots deliberately include both initial hierarchy and scrolled working states.

Earlier actual-host captures also include `creator-draft-restored-desktop.jpg`, `creator-quote-accepted-desktop.jpg`, `creator-submitted-review-desktop.jpg`, and `creator-approved-xp-desktop.jpg`. Review-submission screenshot was replaced with the final revision2 submission, matching the approved journey.

## Observed label contrast correction

| Before / observed | After / implemented | Why |
| --- | --- | --- |
| Global label styling inherited `rgb(142,124,153)` / `#8e7c99` into profile text labels and consent captions. Actual main-panel computed background was `rgb(252,250,255)` / `#fcfaff`. Calculated contrast **3.688:1**. | Scoped `.creator-form > label` and `.creator-community .creator-check` explicitly use `var(--ink-secondary,#665577)`. Computed Vite color becomes `rgb(102,85,119)`, contrast **6.470:1** against the same surface. | Essential16px labels need4.5:1. Reuses an adopted semantic token; no global palette change. Source: `src/creator-community.css`. |

After verification used the actual component in the explicitly labeled **simulated API fixture**, `http://127.0.0.1:5173/dev/creator-community.html`. The static8796host does not serve `/dev` fixtures (returned404); parent explicitly supplied the Vite origin. The fixture makes no real publication, XP lock or reward writes. The post-fix normal390px screenshot is `creator-labels-after-normal-390x844.jpg`. Enlarged32px approximation is captured at360/390 in `creator-labels-after-large-360x780.jpg` and `creator-labels-after-large-390x844.jpg`.

`creator-label-measurements.json` records post-fix computed colors, normal16px/enlarged32px labels, control heights and document widths. Enlarged-text captures have no document overflow; buttons and checkbox-label targets expand with wrapped text. Actual-host responsive screenshots above precede this scoped CSS correction; the parent performs the final static build. The fixture is an approximation of text enlargement, not browser zoom or an OS accessibility setting.

## Verification limits and handoff

- Source/client tests8passed and buildpassed are recorded in `../W08-community-ui/`. Parent reported full combined suite408/408passed before the final scoped label correction. Parent owns the final build/check of combined sources.
- Physical Safari/iOS, Chrome/Android, real virtual keyboards, zoom and enlarged OS text remain unverified. No hardware behavior is claimed.
- Actual protected participant reads, once-only start/retry, no participant awards, trusted completion and post-close instructions have separate runtime evidence in this folder.
- Temporary fixture tabs were closed and viewport override reset. Actual8796author tab was retained for handoff. No further browser use after handing control to parent/draft agent.
