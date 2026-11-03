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
| API p95 inside the server (`Server-Timing: app`) | ≤ 100 ms | `npm run perf:probe` |
| Lighthouse mobile, welcome screen | performance ≥ 0.85, LCP ≤ 3 s | manual, see below |

`npm run perf:probe -- https://questlayer.promptstudio3000.com 20` signs up
one guest called "PerfProbe" on testnet, loads the Plzeň arena and a Brno
street world, and times each read 20 times. Env overrides: `PERF_P95_MS`,
`PERF_WORLD_KB`, `PERF_ACTORS_KB`. Never point it at mainnet.

## Server timing

Every `/api/` answer carries `Server-Timing: app;dur=…, loop;dur=…`: `app` is
the time from request start to headers inside Node, `loop` is the worst
event-loop stall in the last ~5 s (a background job or a sync call blocking
every request). Answers slower than `SLOW_API_MS` (default 250) are logged as
`Slow API <method> <route> <ms> (loop stall <ms>)`, route only, no query or
player. `perf:probe` prints both and lists each slow answer with its split:
total minus `app` is network and nginx.

### What the timing found (3 Nov 2026, after #123)

Probing testnet from the cloud (≈120 ms round trip) showed two causes of the
occasional 400–750 ms answers:

1. **Cold actor plans (code, fixed).** Building the Plzeň actor day plan is
   0.4–0.6 s of synchronous work. The plan cache was cleared outright once
   it held 33 worlds, which street cells reach quickly, so a random
   `/api/actors` call rebuilt the arena plan (`server 625 ms`) and every
   request waiting behind it saw the stall (`server 1.6 ms, loop stall
   611 ms`). The cache now evicts least recently used plans
   (`PLAN_CACHE_SIZE` 128). `warm()` builds today's city plans one second
   after boot, and the first `POST /api/world` for a city world builds them
   right after its response.
2. **Background stalls of 90–150 ms (left as is).** Roughly every 30 s the
   loop stalls for about 0.1 s while background workers run. This adds up
   to ~0.15 s to the requests that land in it. It stays under the budget
   and is not on any player's path.

3. **Boot (left as is).** In the first seconds after a restart the loop
   stalls for 1–3.7 s while startup work, the actor warm-up and the first
   world builds run. Only requests that arrive during a deploy feel it.

After #137 (3 Nov, 03:15 UTC, two runs of 30 samples each): every read was
inside the budget. Server p95 was 4–46 ms (`wcoins` ≤ 19 ms is the largest
`/api/world` phase), and total p95 was 126–207 ms. The rare answers around
410 ms spent 1–3 ms in the server, so the extra time was network.

Everything else is network: `/api/me`, `/api/presence` and the near world
spend 1–20 ms in the server, and the rest is the round trip.

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
