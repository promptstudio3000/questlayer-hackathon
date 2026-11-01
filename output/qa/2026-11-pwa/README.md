# Slice 7: PWA polish (2026-11-01)

## Player problem and scope

Players have no way to tell that QuestLayer can live on their home screen. A new
service worker activated silently in the middle of play. Without a connection the
app showed only a 9–11px strip, and a cold offline open gave the browser's error page.
Scope: install offer, update notice, offline state, and manifest/icon metadata. No
change to the game loop, rewards or `src/App.tsx`.

## Before / After / Why

| Area | Before (source) | After | Why |
| --- | --- | --- | --- |
| Install | No `beforeinstallprompt` handling (`src/main.tsx`) | `src/pwa-boot.ts` captures the event before the first render. `src/pwa-prompts.tsx` offers "Add QuestLayer to your home screen" once, after 45 s of visible play, only when no dialog, expanded sheet, toast or text field is active. On iOS it gives two Share → Add to Home Screen steps. "Not now", "Got it", Escape or the browser's own answer is stored in `localStorage["questlayer.install-offer"]`, with try/catch, and the offer never returns. | Make the offer once, at a calm moment after the player has started playing, and never nag. iOS has no install prompt. |
| Update | `main.tsx` posted `SKIP_WAITING` as soon as a worker installed | A waiting worker shows "New version ready" with **Reload** and **Later**. Reload posts `SKIP_WAITING`, then reloads on `controllerchange`; a 4 s fallback reload covers a worker that never takes control. A published shell that references other hashed assets shows the same notice; this is checked on `visibilitychange` and every 30 min. A first install (`clients.claim`) does not show it. | Swapping versions mid-adventure is surprising, and a tab left open never learned of a release. |
| Offline | `.offline-bar` in App (9–11px). `sw.js` returned `undefined` when nothing was cached, and cloned the response asynchronously after the body could already be read. | A readable top-layer notice (manual popover): "You're offline. QuestLayer still opens, but new map areas and rewards need a connection. Nothing is collected until you're back online." It hides App's strip with `:has()`. "You're back online" appears for 4 s. `sw.js` v2 precaches `/` and its entry JS/CSS at install, so the next visit opens offline. It shows an inline offline page when there is no cached shell, and never caches `/api/`. | Be honest about what works offline and never imply a reward was collected. |
| Manifest/icons | Maskable PNG had 5,784 transparent pixels inside the launcher circle. `apple-touch-icon.png` had transparent corners, which iOS fills with black. | New opaque `public/icons/maskable-512.png` (glyph radius 172px < 204.8px safe zone) and `public/icons/apple-touch-180.png`. They were made from `icon.svg` geometry at integer scales by `make_icons.py`. The manifest adds `id`, `dir` and `categories`. `index.html` adds `sizes="180x180"`, `mobile-web-app-capable`, `application-name` and `color-scheme`. `theme_color #1a0335` (`--ink`/`--shell`) and `background_color #fcfaff` (`--surface`) match `src/tokens.css`. | Icons should render correctly on launchers, and the colours should come from the tokens. |

Copy uses no chain words. Icons are Phosphor (`ArrowsClockwise`, `Export`, `PlusSquare`, `WifiSlash`, `WifiHigh`) plus the authored ghost `icon.svg`. Measured contrast: action #672eeb on white 6.63:1, secondary #665577 on white 6.71:1, success #176553 on #e3f6ee 6.18:1.

## Evidence (observed in headless Chromium, `results-*.txt`)

- `install-prompt-{360,390,844x390,1280}.png`, `install-ios-{360,390,844x390}.png`. The offer was hidden before 45 s and shown after. Targets: "Add to home screen" 182×48, "Not now" 96×48, "Got it" 76×48. Tab reaches "Not now"; Escape stores `dismissed` and returns focus to `.main-panel`. After a reload and 50 s more play the offer does not return. The primary button calls `prompt()` once.
- `update-{360,390,844x390,1280}.png` show a **real waiting worker**: `qa-proxy.mjs` serves a frozen build and appends a comment to `sw.js` on request, giving `registration.waiting=true`. Reload removed the waiting worker, the page reloaded and the notice was gone. The live region read "New version ready. Reload to get the latest QuestLayer." The newer-published-shell path was driven by rewriting the fetched `/`.
- `offline-playing-*.png`, `offline-reload-*.png`, `back-online-390.png`, `offline-first-open-390.png`. Offline reload served the cached shell, with the notice in the top layer above the welcome dialog. The uncached open shows the offline page.
- `offline-200-text-*.png`: at 200% text the notice fits 360px; in 844×390 it scrolls inside its box. Under reduced motion the computed animation is `none` (App's global rule), so nothing moves.
- `results-install.txt` supersedes the install lines in `results-all.txt`, which were recorded before the download icon was removed from the primary button.
- `npx tsc --noEmit -p tsconfig.json`: pass. `DISABLE_BACKGROUND_WORKERS=1 npm run check`: 579/579 tests pass (`check.txt`), including the new `tests/pwa-state.test.mjs`.

## Limitations and remaining checks

- `beforeinstallprompt` was dispatched synthetically with a stubbed `prompt()`; headless Chromium does not fire the real one. The iOS guidance used an iPhone user agent in Chromium, not WebKit.
- **Unverified on hardware:** a real install on iPhone Safari (Share sheet wording, apple-touch icon, status bar with `black-translucent`, standalone launch) and on Android Chrome (install sheet, maskable icon in the launcher, splash colours). Desktop Chrome install has not been checked either.
- Found but not fixed (App owner): an offline reload shows the welcome card ("Start exploring"), because `/api/me` fails. App should say the explorer can't load offline instead. The App's `.offline-bar` should be removed in favour of this notice.
- The update notice for a release appears only after `visibilitychange` or the 30-minute check, not instantly.
- The old `public/icon-maskable-512.png` and `public/apple-touch-icon.png` are no longer referenced but were left in place.
