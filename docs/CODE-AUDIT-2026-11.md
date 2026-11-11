# Code audit — gameplay correctness and playability (November 2026)

Audit date: 31 October 2026, commit `1264435` plus uncommitted working-tree edits.
Scope: the demo gameplay loop (server `game.mjs`, `domain.mjs`, `world.mjs`,
`world-planner.mjs`, `quest-templates.mjs`, `adventure-results.mjs`, `database.mjs`,
demo routes in `index.mjs`; client `useAdventureSelection.ts`, `useAdventureResults.ts`,
`demo-collection.ts`, `native-autocollect.ts`, `useNativeGame.ts`, `GameMap.tsx`, and the
loop code in `App.tsx`). Judged against `docs/GAME-RULES.md`, `docs/WORLD-GENERATION.md`
and `DESIGN.md` ("First session", "State and wording contract").

Method: source reading, `node --test` on the five gameplay suites (47/47 pass, 3.7 s), plus
in-memory probes with `openDatabase(":memory:")` → `ensureWorld` → `worldView` →
`claimQuest`, and `buildCityPlan(PLZEN, day)` for 2026-10-31, 11-02 and 11-03. No source
file was changed. `src/App.tsx` carries 307 uncommitted changed lines and was edited while
this audit ran; its line numbers below are approximate (±5) and taken at 21:48 UTC. Server
files are clean in `git status`, so their pointers are exact.

## 1. Core loop as implemented

Mode defaults: `arena = true`, `nativePlay = false` (`App.tsx:217,332`). Position starts at
`HOME = PLZEN.center` (Náměstí Republiky; `world.mjs:9`).

| Step | Client | API | Server authority | Pointer |
| --- | --- | --- | --- | --- |
| Enter | Name form → cookie session | `POST /api/session {name}` | New player per call, 120,000 GOLD demo credit, 30-day cookie, starter avatar | `game.mjs:28-45`, `database.mjs:245-271`, `index.mjs:391-398` |
| See world | On player load | `POST /api/world {location, arena}` | `expireWorlds`, then `ensureWorld`: worldId `demo:arena-city-plzen:<day>:v2` for arena (location ignored), `demo:city-plzen:…` for GPS inside the Plzeň bbox, `demo:<h3 res7>:…` elsewhere. Plan from `world_blueprints` (six zones, windows); 6,000 coins reserved from `coins` bucket; 3 quests per zone; T2 1,000 / T3 5,000 GOLD prizes reserved from `zones` bucket. Response = manifest + all unclaimed coins + quests with `completed`, `checkpoint`, `activity` | `index.mjs:1142-1148`, `world.mjs:73-252`, `world.mjs:253-287`, `world-planner.mjs:20-55` |
| Move | Arena: map click teleports (`onMove` sets position), WASD ≈ 7 m per press; GPS: `locate()` → `getCurrentPosition` + `watchPosition`, `arena=false`, world reloaded at the fix | none | None; arena position is client state | `GameMap.tsx:213-214`, `App.tsx:~955-975`, `App.tsx:~1108-1140` |
| Collect coin | 600 ms interval picks ≤2 coins within 17 m (`meters()`), arena fix is fabricated `{accuracy:0,timestamp:now}` | `POST /api/coins/claim {coinId, fix}` | Arena: distance ≤ 18 m only. GPS: accuracy ≤ 35 m, age ≤ 15 s, distance ≤ 35 m. First `UPDATE … WHERE claimant IS NULL` wins; +0.01 GOLD, +2 XP; treasury reserved→paid; SSE `coin` to all clients | `App.tsx:~805-881`, `game.mjs:69-111`, `domain.mjs:35-39`, `index.mjs:1154-1159` |
| Open zone | Zone pin → `selectZone`; tier gate panel if `zone.tier > player.tier`; bookmark in localStorage per player/realm | none | Tier is recomputed server-side at claim time from staking positions | `App.tsx:~1060-1075`, `App.tsx:~2484-2500`, `useAdventureSelection.ts:62-85`, `game.mjs:188-197` |
| Complete activity | Route with remaining stops → checkpoint; otherwise claim. Button disabled unless within 25 m, open and not busy | `POST /api/quests/checkpoint {questId, fix, checkpoint}` / `POST /api/quests/claim {questId, fix}` | Window, tier, 25 m proximity (GPS also accuracy/age), polygon containment, ordered checkpoint with `STALE_PROGRESS`, GPS replay guard for return trails. Personal XP once per player (`quest_claims` PK); shared GOLD once (`quests.claimant`); chest mints a bounded Aura (3 editions × 256) | `App.tsx:~1890-1950`, `game.mjs:112-282`, `game.mjs:283-327` |
| Receipt | `adventureResults.accept(r.result)`; later `GET /api/adventure-results…` and `…/{id}/viewed` | `GET /api/adventure-results?realm=…` | `adventure_results` row written in the same transaction as the award (UNIQUE player/quest, FK to `quest_claims`); replay returns the stored receipt with `replayed: true` | `adventure-results.mjs:8-39,267-303,433-447`, `useAdventureResults.ts:63-126,260-297` |
| Equip | `Try it on` → `/equip {itemId, desiredEquipped:true}`; client re-checks `inventory[].equipped` in the response | `POST /api/equip` | Ownership, no open listing, no native voucher; one item per slot; clears `native_outfit` | `App.tsx:~1822-1878`, `game.mjs:456-511` |

Server authority is real at every money/XP/item step. The arena is a pure client-side
simulation that the server trusts by design (`game.mjs:88-93,201-203`).

## 2. Correctness findings

Severity: H = breaks play or money for some users; M = wrong behaviour that users can hit;
L = debt, naming, dead code.

### High

**H1. Demo coin loop has no backoff on server rejection (GPS mode).**
`App.tsx:~805-881` runs every 600 ms, posts up to two claims for coins within 17 m, and on
any error other than `ALREADY_CLAIMED` only does `collecting.current.delete(coin.id)`, so the
same coin is retried 600 ms later. In GPS mode the fix is often stale/inaccurate
(`domain.mjs:36-37` rejects `GPS_STALE`/`GPS_ACCURACY` with 422), producing up to ~200 silent
failing requests per minute and no "GPS uncertain" explanation (D05). The native collector
already solves this (`native-autocollect.ts:570-592` sets `blockedFix`/`retryAt`).
Fix: reuse that gating for the demo loop — on 422 record `blockedFix = fix.timestamp` and a
5 s `retryAt`, and surface the message in the HUD.

**H2. Street-only world outside Plzeň seeds coins at the H3 cell centre, not near the player,
and fails hard when Overpass is slow.** `world.mjs:101-103` calls
`publicPaths(db, region, cellToLatLng(region))` with a ±0.009° (~1 km) box around the centre of
a res-7 cell (~5 km across). A player near the cell edge gets a world whose coins are all
2–3 km away. The Overpass fetch runs inside the request (`world.mjs:30-38`, 15 s timeout) and
any non-OK response throws "The map data service is busy." so `POST /api/world` returns an
error and the player has no world at all — the opposite of G12/GEO11. Fix: query around the
player's coarse position (rounded to ~500 m, G07-safe), cache per tile, and on failure return a
coin-less world with `coverage: "unavailable"` and a reason instead of throwing.

**H3. City plan aborts the whole day when fewer than six candidates pass.**
`buildCityZones` legitimately skips candidates (`city-pack.mjs:101-121`: invalid, <3,000 m²,
<250 m gap, <3 targets), but `buildCityPlan` asserts `zones.length === 6`
(`world-planner.mjs:42-45`). If a sector yields nothing, `getOrPrepareCityPlan` throws inside
`ensureWorld` and every `/api/world` for that day fails for every player. WORLD-GENERATION
says to publish fewer with a coverage reason. The 19-candidate pack passes for the sampled
dates, so this is latent, not observed. Fix: allow 3–6 zones, set `cityZoneCount` and a
`coverage` reason, and make the planner job record the shortfall.

### Medium

**M1. Arena and physical Plzeň worlds are two worlds funded from one treasury.**
`ensureWorld` creates `demo:arena-city-plzen:…` and `demo:city-plzen:…` separately
(`world.mjs:85`), each reserving 6,000 coins and 7,000 GOLD of prizes (probe: `zones`
reserved 14,000 GOLD after both exist). Arena players can teleport to a T2/T3 target and win
the 1,000/5,000 GOLD prize (probe: a chest claim with a fabricated fix succeeded, realm
`arena`). Paid prizes leave the bucket permanently; at that rate the 50,000 GOLD `zones`
budget empties in about eight days and the physical world's tiered quests silently become
0-GOLD (`world.mjs:184`). G14 says the arena "cannot settle physical-mode rewards"; here it
settles the same demo GOLD from the same pool. Fix: a separate `arena` bucket (or XP-only
arena prizes) and a `realm` column on `quests`/`coins`.

**M2. Visit and return-trail end at the same point in half the zones.**
`instantiateQuestTemplate` uses `targets.at(-1)` as the quest target
(`quest-templates.mjs:181-187`); for `return-trail` that is `distinct[0]`, which is also the
`path-visit` target (`zoneQuestTemplates` passes the same `zone.targets`). Probe for
2026-11-02: slots 1, 3 and 5 have `path-visit` and `return-trail` at identical coordinates.
One fix at the start marker therefore confirms the visit and, after the loop, the trail
finish. WORLD-GENERATION asks for ≥60 m between separate objective targets. Fix: give
`path-visit` `targets[2]` when the route is `return-trail`, or require a fourth target.

**M3. World payload is the whole city.** `worldView` returns all unclaimed coins
(`world.mjs:277-281`): 6,000 rows, 772,669 bytes JSON (probe). The client fetches it on
load, every 15 s (`App.tsx:~786-790`) and after every SSE `quest` event (`App.tsx:~780`).
On a phone that is ~3 MB/min idle. WORLD-GENERATION requires viewport/chunk queries with
`visibleZoneCount`/`openEligibleCount`. Fix: `GET /api/world?id&bbox` returning coins in the
viewport plus counts; keep zones/quests whole.

**M4. Client and server coin radii disagree.** Client filters coins at 17 m
(`App.tsx:~817`); server accepts 18 m in the arena (`game.mjs:91`) and 35 m under GPS
(`domain.mjs:35` default). With 35 m accuracy allowed, a GPS player standing on a coin can
sit 20–30 m away in the fix and never trigger the client while the server would accept it.
Fix: one exported constant per realm (`COIN_RADIUS_ARENA = 18`, `COIN_RADIUS_GPS = 35`)
served in the world manifest and used by the client.

**M5. Legacy (pre-2026-11-02) quest definitions are identical in all six zones.**
`QUEST_POLICY_START_DAY = "2026-11-02"` (`quest-templates.mjs:5`); until then
`world.mjs:194-222` writes "Discover the park / Three-point expedition / Find the park chest"
with the same descriptions everywhere (probe: today's plan has `acts` empty). This is the
state a judge sees on 31 Oct–1 Nov and is exactly the D13 anti-pattern. Fix: move the start
day back or drop the legacy branch for worlds created after the planner shipped.

**M6. `publicManifest` writes outside a transaction on read paths.** `world.mjs:56-71`
mutates the manifest and `UPDATE worlds` from `worldView` (a `GET`). Harmless for Plzeň
(centre equal), but it is a write in a read handler without `atomic`. Fix: do the centre
normalisation once at creation and delete the function.

**M7. No idempotency key on `/api/stake`, `/api/market/list`.** `game.mjs:328-355,512-541`
have no client token; a retried POST after a lost response double-stakes or double-lists
(second list fails via the partial unique index, stake does not). Coins, quests, checkpoints
and equip are idempotent. Fix: accept `clientRequestId` and store it in `history.meta`.

### Low

- **L1. Dead endpoint `/api/config`** (`index.mjs:373-390`): no `src/` reference (grep); it
  duplicates `coinValue`, splits and `NEAR_GAME_CONTRACT`. Remove or make the client read it.
- **L2. Dead `contracts/game` contract**: Rust `Game` with `CoinBatch`/`Quest`/`Profile`
  (`contracts/game/src/lib.rs`) is deployed by `scripts/deploy-testnet.mjs:34` and shown as
  `proof.gameContract`, but no server module calls it; the demo economy is the SQLite ledger
  (`gameEconomy:'separate-demo-ledger'`). Mark it experimental in docs or delete it.
  Resolved 10 November 2026: the contract is retired, the wallet proof link is removed and
  `scripts/deploy-testnet.mjs` refuses to run; source and WASM pin stay for history.
- **L3. `server/native/exit-scheduler.mjs` and `treasury-model.mjs`** are imported only by
  `tests/staking-foundation.test.mjs` and `scripts/simulate-native-funding.mjs`. They are
  "executable specifications", not runtime. Move to `server/spec/` or document.
- **L4. Realm naming is four vocabularies for two axes**: `DEMO realm` log
  (`index.mjs:1959`), `realm IN ('arena','gps')` (`adventure-results.mjs:18`), UI "Demo /
  NEAR testnet" (`App.tsx:~2956`), `nativePlay`, presence `arena` column, zone `kind`
  "cache"/"expedition" by tier (`world.mjs:113`). Pick `ledger: demo|near` and
  `evidence: arena|gps` and use them in code, API and UI.
- **L5. `harvestDemo` keys by UTC day** (`game.mjs:610`) while worlds use Europe/Prague.
- **L6. Boot-time catalog translation** (`database.mjs:112-147`) runs 15×3 `UPDATE`s and
  rewrites every world manifest on every start; make it a one-shot migration.
- **L7. `mintAura` rotation counts purchased Auras** (`game.mjs:289-294`), so a buyer's
  next chest skips an edition. Cosmetic.
- **L8. `dashboard` hard-codes `apr: 5` and `split 50/50`** (`game.mjs:604-606`) next to
  the computed figures.
- **L9. Overlapping world-expiry calls**: `expireWorlds` runs in `POST /api/world`
  (`index.mjs:1146`), inside `ensureWorld` (`world.mjs:97`) and every 30 s
  (`index.mjs:1932`); it scans and parses every manifest each time. Idempotent via
  `daily_jobs`, so only cost.

No race was found in the money paths: every mutation runs under `BEGIN IMMEDIATE`
(`database.mjs:160-170`), coin claims use a guarded `UPDATE`, and `ensureWorld` dedupes
concurrent creation per `db` (`world.mjs:90-95,146-150`). Test
"simultaneous activation shares a single world" covers it.

## 3. Playability findings

Judged against DESIGN.md "First session": identify the next action in 5 s, finish a first
arena adventure in 2 min, equip a received Aura in two actions.

**P1. The first recommended action is kilometres away and reached by teleport.** Probe
for 2026-10-31 from HOME: the only zone within 300 m is the Tier 2 timed slot
(12:00–15:00); the free zones are 2.2–3.9 km away; the recommended chest is 3.17 km away.
The `Walk there` button (`App.tsx:~2611`) calls `move(questPoint(q))`, which sets the position
directly — a teleport labelled as walking (D03). WASD at 0.000065° (≈7 m) per press
(`App.tsx:~964`) makes real arena walking 450 presses. The two-minute target is met only
because teleport exists, and it teaches nothing about GPS play.

**P2. Coins are economically invisible.** Welcome credit 120,000 GOLD
(`database.mjs:249`) vs 0.01 GOLD per coin: the balance pill shows `120,000.01`. The
welcome credit exists so a demo player can stake 50,000/100,000 and unlock Tier 2/3 after
a 30 s maturity (`game.mjs:348`), which also means tiers gate nothing. Either show coins as
a separate session counter with XP (D21 already coalesces in `pickup-feedback.ts`) or drop
the credit to something where 0.01 registers.

**P3. Opening windows hide a third of the content.** Tier 3 opens 18:00–19:00 and the
timed Tier 2 12:00–15:00 (`world-planner.mjs:26-30`). A judge at 20:00 sees "Opens in 22 h"
(`App.tsx:~2423`) on a zone they also cannot enter until they stake. There is no "what can
I do now" summary; `openEligibleCount` from the spec is not implemented.

**P4. Two independent mode switches produce a dead quadrant.** Demo/NEAR testnet
(`App.tsx:~2956,3134`) and arena/GPS (`locate`/`returnToArena`, `App.tsx:~1099-1140`) give
four states; arena+NEAR shows `gps_required` (`native-autocollect.ts:356`) and the
Expeditions tab forces `nativePlay = true` (`App.tsx:~537`). The header label changes with
`world?.cityName || "Your surroundings"` vs "Plzeň · city demo" (`App.tsx:~2113-2122`), so the
same map can read as three different places.

**P5. Distance labels are straight-line but only the native panel says so.**
`distanceLabel` → "2.3 km away" (`App.tsx:~171-175`) from `meters()`; the quest card shows
`distanceLowerBoundM` with `distanceBasis: "straight-line-between-stops"`
(`quest-templates.mjs:151-154`); `NativeExpeditions.tsx:410` adds "Distances are
straight-line", the demo panel does not. D03 asks for labels, validation and distance to
agree.

**P6. State contract coverage (DESIGN.md table).** Ready: action labels come from the
template (`Confirm visit`, `Record stop`, `Open the chest`) — good. Too far: arena shows
`Walk there`; GPS shows the action button disabled with no "Get closer" text
(`App.tsx:~2614-2642`). GPS uncertain: no client check; the player learns from a 422 toast
after tapping, and the coin loop fails silently (H1). Pending: `Verifying…` — good.
Success: toast plus durable receipt with `Try it on`/`Back to map`
(`AdventureResults.tsx:215,294,305`) — good. Shared claimed: "GOLD already claimed" plus
fine print — good. Closed: `Closed`/`Not open yet` — good. Offline: results hook explains;
the claim button is not disabled offline.

**P7. Identical activities until 2 November (M5).** Today every zone offers the same three
cards; the authored variety (`ordered-trail` vs `return-trail`, 55 m target gaps) is real but
not yet live.

**P8. Payload and refresh cadence (M3)** will be felt on a phone as jank every 15 s.

**P9. Identity.** `POST /api/session` always creates a new player; losing the cookie loses
progress unless a passkey was added. Acceptable for a demo, but the UI copy "progress is
saved on this device" should say "in this browser".

## 4. Rules coverage

| Rule | Status | Evidence |
| --- | --- | --- |
| D01 next playable action | partial | Recommendation exists (`App.tsx:~1968-1990`) but targets 2–4 km away reached by teleport (P1) |
| D02 solo, no wallet | implemented | Guest session → free zone → chest → Aura, probe succeeded; `game.mjs:28-45,163` |
| D03 arena/GPS/route distinct | partial | Server validates per realm (`game.mjs:87-93,200-203`); UI says "Walk there" for a teleport and does not label straight-line in demo (P1, P5) |
| D04 phone sheet states | unverified | Sheet/overview/camera offset code exists (`GameMap.tsx:~447-470`); no render check in this audit |
| D05 every state explained | partial | Server codes exist (`GPS_STALE`, `OUT_OF_RANGE`, `OUTSIDE_ZONE`, `TIER_REQUIRED`); client lacks proactive too-far/GPS-uncertain/offline states (P6, H1) |
| D12 confirmed reward, durable receipt | implemented | `adventure_results` in the award transaction, replay with `replayed:true`, one `accept` (`adventure-results.mjs:267-303,433-447`; `useAdventureResults.ts:260-297`) |
| D13 designed choice | partial | Four templates, two trail mechanics, 55 m gaps (`quest-templates.mjs:11-70,193-214`); live only from 2026-11-02 (M5) |
| D16 chest → result → Try it on → map | implemented (code) | `equipAdventureResult` verifies `inventory[].equipped` before closing (`App.tsx:~1822-1878`); device check outstanding |
| D17 preserve selection, invalidate honestly | implemented | `resolveAdventureSelection` checks world id, `endsAt`, zone/quest `closes_at` (`adventure-selection.ts:147-187`) |
| D19 preview/pending/equipped distinct | partial | Equip is confirmed from the server response; `currentAdventureItem` returns owned/listed/reserved/minted (`adventure-results.mjs:138-212`); no explicit preview state in the result flow |
| D21 calm coin feedback | implemented | Coalesced, deduped, capped (`pickup-feedback.ts:27-60`); counters are session-scoped (not persisted) |
| G01 six citywide slots | implemented | Plan is per city/day, world id ignores location (`world.mjs:79-85`, `world-planner.mjs:42-45`); H3 only outside the city |
| G02 no overlap/touch, 250 m gap | implemented | `polygonGap(...) < 250 → skip` (`city-pack.mjs:42-66,117`) |
| G03 geography-led shapes, ≥3 families | partial | Real OSM polygons; family is a bbox heuristic (`city-pack.mjs:138-139`); probe: 5 of 6 "garden" on 10-31 and 11-02 (GEO04 fails) |
| G04 sector spread, real transfers | partial | One zone per sector (`city-pack.mjs:89-96`); transfers are teleport in arena and straight-line everywhere |
| G05 several objectives, entry ≠ completion | partial | Three quests per zone, each needs its own claim; visit and return-trail share a point in 3/6 zones (M2) |
| G06 one daily schedule | implemented | Windows in the stored plan (`world-planner.mjs:25-41`); `localDateBounds` handles 23/25 h days; tests pass |
| G07 seed independent of first player | implemented (city) / partial (outside) | City centre fixed, test "never record the first visitor GPS"; H3 worlds seed at the visitor's cell (H2) |
| G10 shared coins, first claim wins | implemented / partial | Guarded `UPDATE` (`game.mjs:95-100`); but arena and GPS Plzeň worlds each seed the same 6,000 points (M1) |
| G12 truthful sparse fallback | partial | `coverage: "street-only"` and notice exist (`world.mjs:135-143`); hard failure on Overpass and off-centre coins (H2) |
| G14 tutorial arena for remote judges | implemented | `arena` flag, results `realm`, native collector refuses arena fixes (`native-autocollect.ts:356`); arena still pays demo GOLD from the shared pool (M1) |
| E14 personal XP vs shared GOLD | implemented | `quest_claims` per player, `quests.claimant` once (`game.mjs:124-161`); test "a funded quest has one GOLD payout" |
| E15 no reservation, first valid receipt | implemented | No reservation table; first `settleQuest` under `BEGIN IMMEDIATE` wins (`game.mjs:144-155`) |
| E18 progression account-bound | implemented | XP on `players` (`database.mjs:24`); item transfer resets `equipped` only (`game.mjs:571`); Base NFTs are read-only appearance |

## 5. Test suite assessment

Run: `node --test tests/game.test.mjs tests/city-world.test.mjs tests/quest-templates.test.mjs
tests/world-planner.test.mjs tests/adventure-results.test.mjs` → 47 pass, 0 fail, 3.7 s.
Also run here: `http.test.mjs`, `demo-collection`, `adventure-selection`,
`native-autocollect`, `static-files` → 37 pass.

What they prove: treasury conservation and idempotent yield; one coin per claim and no
retry farming; expiry rolls unclaimed backing over once; solo free quest with bounded Aura
supply; one GOLD payout with per-player XP; stale/inaccurate/distant GPS rejected;
23/25-hour local rollover; fixed public centre; deterministic city/day templates and
byte-stable native commitments; return-trail order and GPS replay guard; receipt and
award roll back together; planner leases, backoff and restart recovery; client bookmark
and collection fences.

What they do not prove: the `/api/world` payload shape or size (M3); client/server radius
agreement (M4); the fewer-than-six-zones path (H3) — there is no test that removes a
sector; Overpass failure and off-centre seeding (H2); that the arena cannot drain the
physical prize pool (M1); shape-family diversity (G03 — no GEO04 assertion); any rendered
state at 360/390 px, reduced motion or keyboard (D04/D05/D16); zone opening windows as a
player experiences them; identical legacy cards (M5).

Environment dependence:

- `tests/http.test.mjs:447-448` asserts `GET /` → 200. `static-files.mjs:64-66` returns 503
  "Build the application first." without `dist/index.html`. It passes here because `dist/`
  exists and `npm run check` now builds first (`package.json` diff), but `node --test
  tests/http.test.mjs` on a fresh clone fails.
- Fixed ports: `http.test.mjs:16` 19073, `http-social.test.mjs:16` 19082. Two parallel runs
  on one machine collide; `--test-concurrency=4` is safe only because the two files differ.
- `server/index.mjs:66` loads `.env` from the cwd when present. Spawned-server tests inherit
  the developer's `NEAR_RPC_URL`, `DISABLE_*` flags and signer paths, so a local `.env`
  changes test behaviour. No `.env` is present in this checkout.
- `server/index.mjs:88-99` reads `public/testnet-deployment.json` at boot; a missing manifest
  crashes the server before any route, which the HTTP tests would report as a 15 s startup
  timeout rather than a clear failure.
- Non-city GPS worlds call Overpass; no test exercises that path, so the suite is
  network-free only by construction.

## 6. Top 10 recommended fixes

| # | Fix | Size | Addresses |
| --- | --- | --- | --- |
| 1 | Give the demo coin loop the native collector's gating (blocked fix, retry delay, visible status) or share one scheduler | M | H1, D05 |
| 2 | Street-only worlds: query around the player's coarse position, cache per tile, return a coin-less world with a reason on Overpass failure | M | H2, G12 |
| 3 | Allow 3–6 zones in `buildCityPlan`, set `cityZoneCount`/`coverage`, add a test that removes a sector | S | H3, GEO01 |
| 4 | Viewport coin query (`bbox`) with `visibleZoneCount`/`openEligibleCount`; stop full refresh on SSE `quest` | M | M3, P8 |
| 5 | Separate arena prize bucket or XP-only arena prizes; `realm` on `quests`/`coins` | M | M1, G14 |
| 6 | Make `path-visit` use a different target than the `return-trail` start/finish | S | M2, G05 |
| 7 | One constant per realm for coin and quest radii, served in the manifest | S | M4 |
| 8 | Activate the zone-quest policy now (or for all worlds created after the planner) and delete the legacy branch | S | M5, D13 |
| 9 | Arena first session: start the arena at a free zone (or move the tutorial arena to the central sector) and rename `Walk there` to `Jump there (arena)`; show straight-line in demo distance labels | M | P1, P5, D03 |
| 10 | Remove `/api/config`, retire or document `contracts/game`, move `exit-scheduler`/`treasury-model` to a spec folder, unify realm vocabulary | S | L1–L4 |

Second tier (not in the ten): make the 120,000 GOLD credit and tier maturity an explicit
"demo tier unlock" button so the staking detour is not mistaken for gameplay (P2); add a
"playable now" summary that counts open, eligible, uncompleted quests (P3); fold the two mode
switches into one three-state control (P4); add `clientRequestId` to stake/list (M7).


## Addendum, 1 November 2026: relayer deposits (critical, fixed)

Observed behaviour, not a source reading: the first live staking proof relayed `create_position` with the
3.52 NEAR setup deposit from a fresh managed account. The relayer account lost 3.53 NEAR and the player account
kept its full balance; `EXPERIMENTAL_tx_status` shows the relayer's Delegate receipt carrying the deposit into
the factory call. In NEP-366 the relayer's transaction pays every attached deposit of the delegated actions.

Before the fix `policy.mjs` relayed `buy` up to `RELAY_MAX_BUY_DEPOSIT_YOCTO` (5 NEAR), `buy_access`/`donate`
up to the same cap, `create_position` (3.52 NEAR) and `deposit_and_stake` up to 1,000 NEAR, believing the
player's balance paid them. Any managed account could have drained the relayer up to its balance within the
daily job cap. The pre-send top-up also transferred the storage deposit to the player's account in addition to
the relayer paying it on chain (double spend of 0.05 NEAR per mint).

Fix (`server/relayer/policy.mjs`, `relay.mjs`, `config.mjs`, `src/self-paid-native-transaction.ts`,
`src/native-signer.ts`): only 0, 1 yocto and 0.05 NEAR deposits are relayed and re-checked after every branch;
money actions return `RELAY_SELF_PAID` and the managed signer sends them as ordinary transactions signed by the
device key; the top-up path funds only a 0.01 NEAR state margin once. Tests: `tests/relayer-policy.test.mjs`,
`tests/relayer.test.mjs`. Live re-proof: `public/native-sponsored-stake-proof.json`.
