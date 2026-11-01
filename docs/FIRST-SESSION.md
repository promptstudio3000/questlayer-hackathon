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
The coach can be hidden (×) and brought back from Settings → "Show first steps again".

## Grounded hints

`POST /api/guide/hint {step, worldId, location}` returns one sentence for the current step from the same live
world the guide (`server/ai/guide.mjs`, PR #31) reads: nearest street find / coin distance, nearest open chest
with its park, distance and whether an Aura edition remains, operator pause, or "nothing open". No model is
called, so hints cost nothing and every number comes from game data. Aura and secure steps use fixed copy.

## Feedback settings

Settings → "Sound, vibration and motion" (`src/feedback.ts`, stored per browser):

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

`npm run build && npm run e2e:first-session` starts a throwaway server and plays the whole first session at
390 × 844 with reduced motion, asserting each step, haptic cues, no chain words in the sheet and the saved
settings. Screenshots: `output/qa/2026-11-first-session/`. CI runs it in the `first-session` job and uploads the
screenshots as an artifact. Real-device checks (iOS Safari, Android Chrome vibration/sound) are still open.
