# Roaming NPCs and monsters: shared interfaces (N0+M0)

Implements the contract in `docs/NPC-PLAN.md` §14. Other slices build on these names; propose changes in the design
thread instead of forking them.

| Piece | Where | Notes |
| --- | --- | --- |
| Definitions | `server/data/actors/<cityId>.json`, validated by `server/actors/definitions.mjs` | §14 `ActorDefinition` plus two optional fields: `element` (`ember`/`frost`/`storm`/`void`, monsters) and `count` (1–20, planned archetypes spawn numbered instances `<id>-<n>`). |
| Client | `src/actors-layer.ts`, `src/ActorSheet.tsx`, `src/actors.css` | Lazy chunks. The layer draws markers with sprites from `src/actor-models.ts`, interpolates once a second and refetches every minute or after 120 m. Tapping opens the encounter sheet with the animated model; NPCs hand off to `src/NpcSheet.tsx` and challenge offers to `src/MonsterChallenge.tsx` when those files exist. |
| Client types | `src/actor-types.ts` | `ActorView`, `ActorSegment`, `ActorsResponse`, `ActorOffer`, `ActorEncounter`. |
| Schema | `server/actors/schema.mjs`, module `actors` v1 | Tables: `actor_encounters`, `actor_offers`, `actor_relationships`, `actor_progress`, `actor_shards`, `actor_challenges`, `actor_player_fixes`, `ai_npc_requests`. A later version can only loosen CHECK clauses (no new columns or tables), so slice detail goes in the JSON `data`/`terms`/`spec`/`result` columns. |
| Offer menus | `server/actors/menu.mjs` | `registerMenuBuilder(kindOrArchetype, builder)`; the builder gets `{actor, def, persona, player, world, dayId, now, db, expiresAt}` and returns `Offer[]`. Monsters default to one `challenge` offer. |
| Movement | `server/actors/schedule.mjs` | Pure. `pathGraph(pack, closed)` joins the city pack's mapped footways (path ends within 15 m are linked, fragments under 60 points dropped, closed places removed). `planDay(def, pack, seed, dayId, {dayStart, hours, home, allDay})` → contiguous `ActorSegment[]` (3–8 stations within `rangeM`, dwell between walks at `speedMps`); `positionAt(segments, t)`. Practice worlds plan all day. |
| Spawns | `server/actors/spawns.mjs` | Pure. `planSpawns(city, pack, seed, dayId, {zones, closed})`: guardians at today's open zones, roamers and lurkers on seeded path points, monsters ≥ 150 m apart, disabled definitions skipped. Seed = `sha256(actors-v1 ‖ city ‖ world blueprint)`. |
| Service | `server/actors/service.mjs` | `createActorService(db)` → `list`, `encounter`, `requireEncounter({token, player, actorId})` → `{encounterId, actor, def, worldId, dayId, seed, menu, menuHash}` or a 403/404/410 error. |
| Routes | `server/actors/routes.mjs` | `GET /api/actors?worldId=&lat=&lng=`, `POST /api/actors/:id/encounter {worldId, location}`. An empty menu (not a trader) also carries `comeBack: {reason: "beaten" | "boss_beaten" | "nothing_today", at}`: the actor's first active minute tomorrow (next Monday for a beaten weekly boss); the client words it via `src/come-back.ts`. |
| Flag | `ACTORS_ENABLED=1` | Off by default (tests, mainnet); on for the testnet VPS. |

Encounter rules: distance ≤ 35 m (≤ 50 m while the actor dwells at a station), GPS accuracy ≤ 30 m and a fix at most
15 s old, no movement faster than about 15 km/h since the player's previous fix. Practice (arena) worlds skip the GPS checks
like arena coins do. Tokens (`enc_…`) last 5 minutes and bind player, actor, day, segment and menu hash.

Lurkers (60 m) and the wandering rare (300 m) are only listed for a player already within reveal range. `GET /api/actors` sends at most the next 20 minutes of segments (the map refetches every minute; see docs/PERFORMANCE-BUDGET.md).

## Generic cast for every city and street cell (W7)

`docs/WORLDS-PLAN.md` C.6 W7, wave 1. Which cast plays in a world is decided in `castFor` in
`server/actors/service.mjs`:

| World | Cast | Walkable graph | Homes |
| --- | --- | --- | --- |
| City with a reviewed file (`server/data/actors/<cityId>.json`, today Plzeň) | that file, unchanged | the CityPack | as reviewed |
| Any other CityPack (preview or future auto cities) | `server/data/actors/_generic.json` | the CityPack | NPCs at a seeded safe POI |
| Active street cell (H3 res 7 world outside a city) | `_generic.json`, capped by `DENSITY_CAP_PER_CELL` | the cell's cached public-path snapshot (`geo_cache`, the same one street coins use; `minComponent` 8) | NPCs at a seeded safe POI |

- The generic cast is original QuestLayer characters with persona cards in `server/data/personas/_generic.json`:
  quest giver Lenka the Wayfinder, storyteller Grandpa Tobiáš, wandering rare Firefly, one Glitch Moth roamer and two
  Pocket Wisp lurkers. The loader rejects traders, keepers, guardians and bosses in the generic file (treasury or
  reviewed zones), fixed coordinates, and more instances than the per-cell cap.
- `homeFrom: "poi"` (NPCs only, generic file only) resolves a home at plan time from `server/actors/pois.mjs`:
  CityPack candidate parks, today's open zones, sources added with `registerPoiSource`, and path junctions as the
  fallback every mapped cell has. Wave 2 (13 Nov 2026): the server registers the W3 POI file
  (`server/actors/poi-file-source.mjs`), so generic NPCs stand at real, named, safety-`ok` places on a public path
  (the street cell, or an auto city's centre cell and its six neighbours; the 60 most notable). `ACTOR_POI_HOMES=off`
  turns it off; with no POI file nothing changes. Closed and excluded places are dropped; the home snaps to
  the path graph within 250 m, and generic NPCs stay 150 m apart.
- `DENSITY_CAP_PER_CELL` (`server/actors/definitions.mjs`) is shared by all layers: per cell at most 1 quest giver,
  1 storyteller, 1 wandering rare, 1 roamer, 2 lurkers.
- Cell instance ids get a 6-hex suffix from the cell (`glitch-moth-1a2b3c`), so a win in one cell is not a win in
  the next one. City ids are unchanged.
- No model or map call happens on the player path: a cell without a cached snapshot has no actors until the street
  world hydrates. Rewards stay XP, shards, roll tickets and cosmetic editions; there is no GOLD/NEAR prize outside
  funded cities.
