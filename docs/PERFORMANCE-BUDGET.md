# Performance budget (phones)

QuestLayer is played on a phone, outdoors, often on mobile data. These are
the limits the game must stay under. Each one has a check that fails when it
is crossed; raise a number only on purpose, in the same change that needs it.

## Budget

| What | Budget | Check |
| --- | --- | --- |
| Welcome screen first load, JS | ≤ 220 KB gzip | `npm run budget` (CI, `npm run check`) |
| Welcome screen first load, CSS | ≤ 36 KB gzip | `npm run budget` |
| Map, MapLibre, near-api-js, three.js | never in the first load | `npm run budget` |
| `/api/world` with `near` | ≤ 1200 coins, ≤ 220 KB raw | `tests/perf-budget.test.mjs`, `npm run perf:probe` |
| `/api/actors` | ≤ 40 KB raw, 20 min of segments | `tests/perf-budget.test.mjs`, `npm run perf:probe` |
| API p95 (world, actors, me, presence) | ≤ 400 ms from outside the VPS | `npm run perf:probe` |
| Lighthouse mobile, welcome screen | performance ≥ 0.85, LCP ≤ 3 s | manual, see below |

`npm run perf:probe -- https://questlayer.promptstudio3000.com 20` signs up
one guest called "PerfProbe" on testnet, loads the Plzeň arena and a Brno
street world, and times each read 20 times. Env overrides: `PERF_P95_MS`,
`PERF_WORLD_KB`, `PERF_ACTORS_KB`. Never point it at mainnet.

## Map rules

- **Coins near the player.** The client always asks for `near` (POST body
  `near: {lat,lng}`, GET `&near=lat,lng`). The server then sends only the
  coins within 1.5 km (`NEAR_RADIUS_M`), the closest 1200 at most, and adds
  `coinsNear: {lat,lng,radiusM}`. Zones and quests are never cut. The client
  refetches once the player is a third of the radius away from that point.
  Without `near` the old full list is still served, for older clients.
- **304 on refresh.** `GET /api/world` sends an ETag with
  `Cache-Control: private, no-cache`; the 15 s refresh costs a 304 when
  nothing changed.
- **Indexes.** `coins_world_open` and `quests_world`
  (`server/map-read-indexes.mjs`, a schema module) keep the per-world reads
  independent of how many past days the database holds.
- **Coins are a symbol layer** (WebGL, one draw call), not DOM markers, and
  only show from zoom 14. Do not turn them into `maplibregl.Marker`s.
- **Actors** (DOM markers) leave the map below zoom 13 and when they are
  more than a quarter screen outside the viewport. The list carries 20
  minutes of walk; the layer refetches every minute.
- Zone markers stay DOM (≤ ~10 per city); quest pins only for the focused
  zone. A new layer with more than ~30 points belongs in a GeoJSON symbol
  layer (with `cluster: true` if points overlap at city zoom).

## Measured (3 Nov 2026, before → after this budget)

| | Before | After (local build) |
| --- | --- | --- |
| Arena `/api/world` | 6000 coins, 796 KB raw (~80 KB gzip), every 15 s | 869 coins, 158 KB raw; 304 when unchanged |
| Arena `POST /api/world` | 780 ms live (152 ms local) | 14 ms local |
| `/api/actors` (17 actors) | 82 KB a minute | 20 min of segments |
| Fonts | Google Fonts `@import` in CSS (2 extra origins, ~770 ms blocking) | self-hosted woff2 in `/assets`, immutable |
| LCP image | discovered after JS | preloaded, `fetchpriority=high` |

Lighthouse mobile on questlayer.promptstudio3000.com before: performance
0.78, FCP 2.6 s, LCP 4.1 s, TBT 220 ms, CLS 0.003; accessibility, SEO 1.0.
Open findings after this change: the entry CSS (32 KB gzip, ~90 % unused on
the welcome screen) and the entry JS (187 KB gzip, ~40 % unused) still block
the first paint; splitting App.tsx screens further is the next step.

To rerun Lighthouse from a cloud session:

```sh
npm i --prefix /tmp/lh lighthouse@13.6.0
CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome \
  /tmp/lh/node_modules/.bin/lighthouse https://questlayer.promptstudio3000.com/ \
  --chrome-flags="--headless=new --no-sandbox --proxy-server=$HTTPS_PROXY" \
  --only-categories=performance --output=json --output-path=/tmp/lh/report.json
```
