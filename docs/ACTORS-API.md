# Roaming NPCs and monsters: shared interfaces (N0+M0)

Implements the contract in `docs/NPC-PLAN.md` §14. Other slices build on these names; propose changes in the design
thread instead of forking them.

| Piece | Where | Notes |
| --- | --- | --- |
| Definitions | `server/data/actors/<cityId>.json`, validated by `server/actors/definitions.mjs` | §14 `ActorDefinition` plus two optional fields: `element` (`ember`/`frost`/`storm`/`void`, monsters) and `count` (1–20, planned archetypes spawn numbered instances `<id>-<n>`). |
| Client types | `src/actor-types.ts` | `ActorView`, `ActorSegment`, `ActorsResponse`, `ActorOffer`, `ActorEncounter`. |
| Schema | `server/actors/schema.mjs`, module `actors` v1 | Tables: `actor_encounters`, `actor_offers`, `actor_relationships`, `actor_progress`, `actor_shards`, `actor_challenges`, `actor_player_fixes`, `ai_npc_requests`. A later version can only loosen CHECK clauses (no new columns or tables), so slice detail goes in the JSON `data`/`terms`/`spec`/`result` columns. |
| Offer menus | `server/actors/menu.mjs` | `registerMenuBuilder(kindOrArchetype, builder)`; the builder gets `{actor, def, persona, player, world, dayId, now, db, expiresAt}` and returns `Offer[]`. Monsters default to one `challenge` offer. |
| Service | `server/actors/service.mjs` | `createActorService(db)` → `list`, `encounter`, `requireEncounter({token, player, actorId})` → `{encounterId, actor, def, worldId, dayId, seed, menu, menuHash}` or a 403/404/410 error. |
| Routes | `server/actors/routes.mjs` | `GET /api/actors?worldId=&lat=&lng=`, `POST /api/actors/:id/encounter {worldId, location}`. |
| Flag | `ACTORS_ENABLED=1` | Off by default (tests, mainnet); on for the testnet VPS. |

Encounter rules: distance ≤ 35 m (≤ 50 m while the actor dwells at a station), GPS accuracy ≤ 30 m and a fix at most
15 s old, no movement faster than 15 m/s since the player's previous fix. Practice (arena) worlds skip the GPS checks
like arena coins do. Tokens (`enc_…`) last 5 minutes and bind player, actor, day, segment and menu hash.
