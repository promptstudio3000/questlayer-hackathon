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
| 500 walkers at once, polled reads p95 | ≤ 400 ms round trip, ≤ 100 ms in the server, no 5xx | `npm run load:test` (local only) |
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

## Load: 500 walkers (`npm run load:test`)

```sh
npm run build
npm run load:test -- --walkers=500 --duration=150 --ramp=90 \
  --poi=/path/to/current.sqlite --cities=/path/to/city-packs
```

`scripts/load-test.mjs` starts its own server on a throwaway database
(`TRUST_PROXY=loopback`, so each walker has its own address for the guest
limit; actors on; clock moved into play hours like `e2e:world`) and runs N
walkers spread over 19 Czech spots (Praha 30 %, Brno 14 %, Plzeň arena and
street, Ostrava, regional towns, Telč, Holašovice, a Šumava forest cell).
Each walker does what a phone in play does: guest sign-up, `POST /world`,
one SSE stream, `GET /me` + `GET /world` (ETag) every 15 s, `GET /presence`
every 8 s, presence share every 10 s (a third of them), `GET /actors` every
60 s, the daily board and a badge check every 30 s, and it jogs at 4 m/s to
the nearest coin or POI quest and claims it with a fresh fix. Each walker
ticks at its own point in the second, as phones do. It writes
`output/qa/load-test/latest/report.json` (p50/p95/p99 per route, server time,
loop stall, server CPU and RSS, the walkers' own CPU) and fails over budget.
`LOAD_PROFILE=dir` writes a V8 CPU profile of the server. `--url` accepts
localhost only: never load-test the VPS.

The POI file used on 3 Nov was a full local build of Czechia from the
OpenStreetMap extract (290,562 places, 196,432 ok, 17,310 path cells, 85 auto
cities; no Overture or Wikidata, which only change names and notability).

### What it found (3 Nov 2026, 4-core cloud container, Node 24)

Before: the server topped out at ~150 requests/s on one core and 500
walkers need ~210/s, so queues grew without end: p95 10–70 s on every read,
0.5 % errors. CPU profile:

1. **`coins` had no index on `world_id` or `claimant`** (only the partial
   open-coins index). Street finds counted a world's coins on every pick-up
   and every world read, and the profile counted a player's coins on every
   `/api/me` and pick-up: both scanned every coin of every world of every
   day (~50 % of server CPU).
2. **Player rows without an index.** `history`, `inventory`, `positions`,
   `withdrawals`, `wallet_links` and `quest_claims` were read by
   `player_id` with a full scan on every `/api/me` and pick-up.
3. **Every coin and quest event went to every SSE stream in the country.**
   With 500 streams that was ~30,000 socket writes a second (~18 % of CPU).
   Events now go only to streams of explorers whose last loaded world is the
   coin's or quest's world (streams of explorers with no world yet still get
   all; market and note events stay global).
4. **Street-find cache cleared itself at 64 worlds**; 500 walkers hold a few
   hundred. It is now least-recently-used with 1024 entries.
5. **SQL compiled again on every call** (`db.prepare` inline, ~10 µs each,
   dozens per request). The main connection now reuses one statement per
   SQL text (`cachePreparedStatements` in `server/database.mjs`).

The indexes ship as the `hot-path-indexes` schema module
(`server/hot-path-indexes.mjs`), like `map-read-indexes`; `coins_near` makes
the nearby-coins read of `/api/world` index-only.

| 500 walkers, 150 s | Before | After |
| --- | --- | --- |
| Requests/s served | 151 (queues growing) | 210 (all) |
| `GET /world` p50 / p95 / server p95 | 263 ms / 52.8 s / 26 ms | 16 / 48 / 18 ms |
| `GET /me` p95 / server p95 | 1.2 s / 8.6 ms | 36 / 0.6 ms |
| `GET /presence` p95 | 10.5 s | 38 ms |
| `GET /actors` p95 | 66.5 s | 58 ms |
| `POST /coins/claim` p95 / server p95 | 836 ms / 18.7 ms | 39 / 3.3 ms |
| `POST /world` p95 / server p95 | 30.5 s / 37 ms | 59 / 30 ms |
| Errors | 0.54 % | 0 |
| Worst loop stall | 767 ms | 370 ms |
| Server CPU | 1.06 cores (saturated) | 0.76 cores |

Ceiling: at 1000 walkers (~350 requests/s) the one Node process is
saturated again (p95 0.5–9 s on some reads), so this machine holds about
700–800 active phones. Raw reports: `output/qa/load-test/`.

Left as is: building a new street world or auto-city day plan is synchronous
(the first `POST /world` in a new cell, 150–270 ms) and is the worst loop
stall under load. Beyond ~800 players the next steps are moving world
building to a worker thread and running more than one Node process.

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
