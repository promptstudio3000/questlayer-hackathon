# First session (guided first five minutes)

A newcomer is walked through six steps by a coach card at the top of the Explore sheet:

| Step | Done when (server-confirmed where possible) | Coach action |
| --- | --- | --- |
| Name your ghost | An explorer exists | Welcome screen |
| Reach the nearest find | History has a `Street find` coin | Walk to the nearest unclaimed street find |
| Pick up a coin | History has a `Street coin` | Walk to the nearest coin |
| Open your first chest | Inventory holds an Aura | Open the nearest open, tier-eligible chest's detail |
| Wear your Aura | An Aura is equipped (or the secured outfit is worn) | Equip the newest practice Aura |
| Secure or share it | An Aura is secured, or the player shared/secured from the reward dialog (local mark) | Open the latest Aura reward with Secure / Share |

Logic: `src/first-session.ts` (pure, tested in `tests/first-session.test.mjs`), UI: `src/FirstSession.tsx`.
Proven steps are mirrored into a per-player local mark so the 80-entry history window cannot un-tick them.
The coach can be hidden (×) and brought back with the helper switch in Settings (the gear): "First-time tips", or "Pip, your guide" where the tour runs.

## Grounded hints

`POST /api/guide/hint {step, worldId, location}` returns one sentence for the current step from the same live
world the guide (`server/ai/guide.mjs`, PR #31) reads: nearest street find / coin distance, nearest open chest
with its park, distance and whether an Aura edition remains, operator pause, or "nothing open". No model is
called, so hints cost nothing and every number comes from game data. Aura and secure steps use fixed copy.

## Feedback settings

Settings → Game: Sound, Vibration and Reduce motion (`src/feedback.ts`, stored per browser):

- Vibration (default on): short patterns for coin, finished step, chest reward and error.
- Sound (default off): synthesized Web Audio tones, no audio files.
- Motion: follow the device, or reduce. Reduce sets `<html data-motion="reduce">`, which disables CSS animation
  and transitions, makes the city-demo walk jump instead of animate, and gives every MapLibre camera move zero
  duration (`prefersReducedMotion()` replaces the raw media query in `App.tsx` and `GameMap.tsx`).

## Copy pass

Following `docs/COPY-AUDIT-2026-11.md`: pickup announcement says practice GOLD; route progress counts stops;
the guide credit no longer names NEAR AI; server errors in the core loop (GPS fix, stops, equip, reward dialog
item state) are one sentence with a next step and no chain words. Empty states were added for "nothing open
right here yet" and "everything open for you today is done".

## Journey test

`npm run build && npm run e2e:first-session -- --device=<name>` starts a throwaway server (creator community
on) and plays the whole loop with reduced motion: name, nearest find, first coin, first chest, Aura,
secure/share, the feedback settings, then equip/unequip from the collection, a practice market order that a
second explorer buys, and the creator feed. It asserts each step, haptic cues, no chain words in the sheet and
the saved settings.

Devices: `phone-390` (Chromium 390 × 844, the default), `iphone` (WebKit, Playwright's iPhone 15 profile),
`pixel` (Chromium, Pixel 7 profile), or `all`. WebKit needs `npx playwright install --with-deps webkit`.

Every key screen (welcome, map coach, chest reward, secure/share, settings, inventory, listing form, market,
creator feed) gets an axe-core scan against WCAG 2.0/2.1/2.2 A and AA; serious or critical violations fail the
run. The first load is held to a budget: welcome-screen JS (220 KB gzip, 700 KB raw; baseline
174/577 KB after the start screen was split off the map), 30 requests, first contentful paint 4 s, name field ready 6 s, CLS 0.1. Override with
`E2E_PERF_SCRIPT_GZIP_KB`, `E2E_PERF_SCRIPT_RAW_KB`, `E2E_PERF_REQUESTS`, `E2E_PERF_FCP_MS`,
`E2E_PERF_READY_MS`, `E2E_PERF_CLS`.

The home-screen card: whenever it shows during the journey, it must not overlap the top bar, the
open explorer profile menu, the tab bar or the Profile screen's Market entry (bounding boxes); the journey then
dismisses it. A last step plays a fresh explorer on a fake clock so the Add to Home Screen card always shows on
`iphone` and its placement is checked on the map, with the profile menu open and on the Profile screen. On phones
the cards dock just above the tab bar; on wider screens they sit under the top bar; any card hides while the
profile menu is open.

Screenshots and `report.json` (axe findings including moderate/minor, performance numbers) land in
`output/qa/2026-11-first-session/<device>/`. CI runs one `first-session` job per device and uploads each
folder as an artifact. Real-device checks (iOS Safari, Android Chrome vibration/sound) are still open.
