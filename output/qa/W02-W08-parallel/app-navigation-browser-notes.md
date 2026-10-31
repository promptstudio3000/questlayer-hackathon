# App, dialog and inventory browser checks

31 October 2026. Actual compiled App at the isolated `localhost:8796` host, plus
explicit no-API development fixtures. All input is synthetic QA data. No real
GPS, wallet, payment, listing or production operation was performed.

## Observed actual App behavior

- Inventory → Market → browser Back restored Inventory; Forward restored Market;
  reload retained Market. No transaction, consent or wallet action was replayed.
- A synthetic `QA Violet Loop` Aura was inserted into the disposable author's
  inventory **after** creator lifecycle checks, solely to open actual item dialogs.
  It is not an earned quest result. Browser Back closed its native dialog while
  leaving Inventory active. Escape also closed it and returned focus to the card.
- The first Back check found focus going to the panel rather than its trigger.
  `src/useAppNavigation.ts` now leaves same-view modal focus return to Dialog,
  chooses a visible heading for actual screen changes, and falls back to the
  focusable main panel when the compact Explore heading is hidden. Rebuilt App
  recheck confirmed Back returned focus to the Aura card; compact Explore Back
  focused MAIN with zero open dialogs.
- Entered 17.25 in the price form, used Escape, reopened the Aura and price form:
  17.25 returned with the explicit saved-draft notice. No listing was submitted.
- Author logout returned Welcome. Creating a fresh wallet-free **QA navigation**
  explorer succeeded in StrictMode. Its Inventory showed Demo0 and its own name,
  with no previous author's synthetic Aura or item dialog. Back across prior
  entries stayed in the new explorer's safe Explore state; it did not adopt the
  old identity or its actions. Author session was deliberately revoked by logout.

The source also gates the rendered world by its owner and realm during the first
identity-change render, fences asynchronous read order and invalidates live GPS
before arena return. Delayed-request permutations have pure model coverage in
`tests/read-epoch.test.mjs`; browser checks do not pretend to emulate delayed GPS
hardware or wallet providers.

## StrictMode dialog/navigation fixture

`/dev/navigation-history.html` renders the actual `useAppNavigation` and `Dialog`
in StrictMode, with a clearly labeled synthetic presentation and no APIs. The
same-event **Close and open inventory** retained Inventory; Back returned Explore;
Forward returned Inventory without reopening a dialog. Plain **Close** returned
focus to Open modal; subsequent Back/Forward still moved Explore/Inventory.
Captured: `navigation-probe-after-close-back-forward.png`.

## Responsive forms and contrast

The actual price dialog was captured at 360×780, 390×844, 844×390, 1280×800. In
`app-computed-measurements.json`, document width equaled viewport width throughout;
buttons measured 48px and the price input 50px, with 16px text. Captures are
`inventory-price-WIDTHxHEIGHT.png`. Focused input at 390×480 is in
`inventory-price-focused-height-390x480.png`; this approximates keyboard occlusion.

The actual Inventory component also runs in `/dev/inventory-draft.html?text=large`
with a synthetic separate player/Aura and mocked unlinked originals. No API or
listing is sent. At360/390, 32px text had no document or dialog overflow. Entering
24.50, closing and fully reloading, then reopening the price form restored 24.50.
See `inventory-price-restored-large-390x844.png` and
`inventory-large-measurements.json`.

| Before / observed | After / implemented | Why |
| --- | --- | --- |
| Price label inherited global #8e7c99, also observed in the enlarged fixture. | `src/inventory.css` scopes the label to its existing `--inventory-secondary`#665577 token; rendered fixture confirmed rgb(102,85,119). | Contrast against#fcfaff rises from 3.69:1 to 6.47:1; no global palette change. |

Actual-host price captures precede that final scoped label correction. Its after
rendering is verified with the actual component fixture and final production build.
These checks cover browser viewports, native focus and explicit text approximations.
Real iOS/Android, virtual keyboards, OS text/zoom, screen readers, GPS, wallet return
and newcomer acceptance remain unverified. Full milestones remain partial.
