# Worlds plan: additive world layers, AI-assisted authoring and a complete global Aavegotchi world

Written 1 November 2026 at the owner's request. Planning only: no code, contract, env or deployment change is part
of this document. It builds on `docs/WORLD-GENERATION.md` (spatial rules), `docs/SECOND-CITY-PLAYBOOK.md`
(CityPack pipeline), `docs/CONTINUATION-PLAN.md` ("zones everywhere, money only where it is verified"),
`docs/QUEST-TEMPLATES.md`, `docs/AI-QUEST-DRAFTS.md`, `docs/NPC-PLAN.md` and `docs/ASSET-CATALOG.md`.

Three parts:

- **A.** What a "world" is in QuestLayer today and what an additive world layer is.
- **B.** A `WorldPack` schema and an AI-assisted pipeline (Codex, Ollama today, NEAR AI Cloud later) with
  validation and moderation guardrails. Examples: a CryptoPunks-style layer and a player-made world.
- **C.** A concrete Codex work plan to finish the Aavegotchi world so it is complete and global: POI databases and
  licences, skins, quest types and worldwide quest distribution. Section C.6 has copy-paste Codex prompts.

---

## A. What a world consists of today

### A.1 Two things are mixed together today: *place* and *theme*

| Concern | Where it lives today | Notes |
| --- | --- | --- |
| **Place** (where) | `server/data/cities.json` → `server/data/plzen-v1.json` (CityPack: boundary box, sectors, candidate park polygons, targets, paths, licence, `fieldReview`) | Loaded and validated by `server/spatial/city-pack.mjs` (`LIVE_CITIES`, `DEFAULT_CITY`, `cityFor`). |
| **Daily instance** | `server/world-planner.mjs` `buildCityPlan(pack, day)` → `server/world.mjs` `ensureWorld()` | World id `demo:[arena-]city-plzen:YYYY-MM-DD:v2` (e.g. `demo:arena-city-plzen:2026-11-02:v2`). Outside a CityPack: `demo:<h3-res7-cell>:<day>:v2`, a street-only world with up to 350 coins and no zones. |
| **Zones** | `zones[]` in the manifest | Up to six citywide slots, tiers 1/2/3, opening windows, polygon geometry, sector. |
| **Quest types** | `server/quest-templates.mjs` (`zone-quests-v1`) and native `native-city-v2` | `path-visit`, `ordered-trail`, `return-trail`, `cosmetic-chest`; native adds street finds. |
| **Actors** | `server/data/actors/plzen.json`, `server/data/personas/plzen.json`, `server/data/monster-quiz.json` | 5 NPCs (storyteller, trader, keeper, quest giver, wandering rare) and 6 monsters (roamers, guardians, lurker, boss). Archetype rules in code (`server/npc/`, `server/actors/`), only voice/look in data. **Per city**: no actors outside Plzeň. |
| **Rewards** | Treasury buckets in `ensureWorld`, `server/native/allocation.mjs`, `server/data/aura-catalog.json` | XP, demo GOLD, coins, 9 Aura editions with supply; native NEAR only in `NATIVE_FUNDED_CITIES`. |
| **Skin** (look) | `src/tokens.css`, `src/game-object-art-data.ts`, `src/aura-art-data.ts`, `src/actor-models.ts`, `server/upstream-models.mjs`, Aavegotchi Base appearance | Aavegotchi identity is hard-wired across client files. |
| **Rules** | `docs/GAME-RULES.md`, tier logic, creator policy (`CREATOR_POLICY_VERSION`), operator closures | Global, not per layer. |

So today there is exactly one world theme, *Aavegotchi*, and it is implicit: it has no id, no manifest and no
version. The geography (CityPack, H3 street worlds) is already data-driven.

### A.2 Definition: a world layer

A **world layer** is a versioned, reviewed, additive bundle that adds *what happens* on top of the shared
*where*. It never brings its own geography rules, money or contract.

```
           ┌──────────────── World layers (theme) ────────────────┐
           │ aavegotchi (default)  │  punks-city (preview) │ user:… │
           │ skins · actors · quest flavours · cosmetic rewards   │
           └───────────────┬──────────────────────────────────────┘
                           │ binds to (never owns)
┌──────────────────────────▼───────────────────────────────────────┐
│ Place layer: CityPacks (reviewed) · auto CityPacks · H3 cells    │
│ one geometry registry · six-slot rule · closures · exclusions    │
└──────────────────────────┬───────────────────────────────────────┘
                           │ funded by (only where verified)
┌──────────────────────────▼───────────────────────────────────────┐
│ Economy: treasury buckets · allocation.mjs · rewards contract    │
└──────────────────────────────────────────────────────────────────┘
```

A layer can contain:

1. **Identity and rights:** id, version, name, owner, licence/IP evidence for every asset and trademark, and the
   ownership source if it reads NFTs (read-only, like the Base Aavegotchi check).
2. **Skin:** design-token overrides, map style tweaks, object art set (coin, chest, discovery, route, lock), zone
   colours, avatar source, actor models, sounds. All within `DESIGN.md` budgets.
3. **POI affinity:** which POI categories the layer likes (the Aavegotchi layer prefers parks and viewpoints, a
   punk layer prefers street art, music venues and plazas). Used to pick from the shared POI database, never to add
   coordinates.
4. **Quest types:** references to registered templates only (`path-visit`, `ordered-trail`, …) plus flavour text.
   A layer cannot invent a new validation rule; a new rule is code plus tests plus review (section C.4).
5. **Actors:** NPCs and monsters by archetype (rules in code) with persona cards (data), spawn density and hours.
6. **Rewards:** XP weights inside the existing caps, cosmetic editions with fixed supply. **No layer mints money.**
   GOLD/NEAR prizes only come from the existing allocation for a funded city.
7. **Rules:** language list, opening hours, minimum player level/tier for its content, age/safety flags, density
   caps, kill switch.
8. **Lore:** short world story, glossary, tone rules for AI.

### A.3 Additive, not overlapping

The six-slot and geometry rules in `WORLD-GENERATION.md` stay binding. A layer adds content in three ways:

- **Slot theming:** a slot in a city's daily plan is dressed by one layer for that day (rotation). Same polygon,
  same funding, different skin, flavour and actors. No new system zones.
- **Point content:** POI quests (section C.3), NPCs and monsters anchored to shared POIs, under the same per-cell
  density caps for all layers combined.
- **Opt-in view:** the player chooses which layers they see (default: Aavegotchi). Content of a hidden layer
  does not render and cannot be claimed by that player, so two layers cannot double a reward for one location.

Identity: the existing ids stay byte-for-byte unchanged (`demo:arena-city-plzen:2026-11-02:v2`, native
`plzen-YYYY-MM-DD-v2`). Layer content gets its own namespace, for example
`layer:punks-city:city-plzen:2026-11-05:v1:poi:<poiId>`, and links to the base world by `worldId`. The Aavegotchi
layer is `aavegotchi` and is the implicit layer of every existing world.

---

## B. WorldPack schema and the AI-assisted pipeline

### B.1 WorldPack (`server/data/worlds/<id>-v<n>.json`)

```jsonc
{
  "schema": "questlayer.worldpack/1",
  "id": "punks-city",                  // ^[a-z0-9-]{3,32}$, "aavegotchi" reserved
  "version": "2026-11-05.1",
  "status": "draft",                   // draft | preview | live | retired (registry decides, not the file)
  "kind": "official",                  // official | community | private
  "owner": "questlayer-dev-20261101.testnet",
  "name": { "en": "Punk City", "cs": "Punkové město" },
  "lore": { "en": "…", "cs": "…", "tone": ["streetwise", "friendly"], "forbidden": ["violence", "gambling"] },
  "rights": {
    "assets": [{ "path": "public/worlds/punks-city/coin.svg", "source": "original", "licence": "project" }],
    "trademarks": [],                  // any third-party mark used in text, with permission evidence
    "ownershipSource": null            // or { "chain": "ethereum", "contract": "0x…", "mode": "read-only-avatar" }
  },
  "skin": {
    "tokens": { "--frame": "#ff2d55", "--shell": "#101018" },   // only keys listed in docs/design-tokens.json
    "objects": { "coin": "…", "chest": "…", "discovery": "…" }, // authored SVG/pixel sets, size-capped
    "zoneColors": { "1": "#…", "2": "#…", "3": "#…" },
    "avatar": "starter-template"         // or "owned-nft" when ownershipSource is set
  },
  "poiAffinity": { "street_art": 3, "music_venue": 2, "plaza": 2, "park": 1 },
  "questTypes": [
    { "template": "path-visit", "flavour": { "en": "Tag the wall", "cs": "Označ zeď" } },
    { "template": "poi-category-hunt", "params": { "category": "street_art", "count": 3 } }
  ],
  "actors": [
    { "archetype": "quest_giver", "persona": "punks-city/dj-nova", "density": "1-per-city" },
    { "archetype": "roamer", "model": "punks-city/glitch-rat", "density": "low" }
  ],
  "rewards": {
    "xpWeight": 1.0,                   // multiplier capped by GAME-RULES, never above 1.0 for community packs
    "editions": [{ "id": "punk-halo", "supply": 500, "slot": "above" }],  // needs collectibles supported_editions
    "money": "none"                    // always "none"; funded prizes come from the base world only
  },
  "rules": {
    "languages": ["en", "cs"], "hours": ["08:00", "20:00"], "minLevel": 1,
    "cities": ["*"],                   // or an allowlist of city/region ids
    "densityCapPerCell": 6, "killSwitch": "WORLD_PUNKS_CITY=0"
  },
  "provenance": { "authoredBy": ["human:lubos", "codex", "ollama:deepseek-v4.1-flash"], "promptHashes": ["…"] }
}
```

Registry: `server/data/worlds.json`, same pattern as `cities.json` (status per entry, exactly one default layer,
start-up validation refuses duplicates and invalid packs). Files are hashed like `plzen-v1.json`; a published
layer day is immutable.

### B.2 Who does what

| Actor | Role | Never |
| --- | --- | --- |
| **Owner / moderator** | Writes the brief, approves rights, approves the final pack and every promotion `preview → live`. | — |
| **Codex** (offline, in the repo, on the Mac) | Authoring tool: drafts the WorldPack JSON, persona cards, original SVG/pixel art from code, i18n, validators, importers and tests; opens PRs; CI must pass. | Touch keys, runtime.env, contracts or deploys; invent coordinates; copy third-party art. |
| **Ollama Cloud** (today, `deepseek-v4.1-flash`, server-side) | Runtime and batch text: quest flavour per POI, persona voice, NPC dialogue, landmark clue phrasing, user-world assistant. Uses the existing provider interface and `server/ai/text-policy.mjs`. | Choose rewards, coordinates or approvals; see player GPS; output unfiltered text. |
| **NEAR AI Cloud** (later) | Same interface as Ollama (`GUIDE_AI_PROVIDER=near-ai` already exists in `server/ai/guide.mjs`). Private inference for NPCs and the user-world assistant, and an attestation record per batch. | Same limits as Ollama. |
| **Deterministic validators** | Gate everything (B.4). | Be skipped. |

The rule that already holds for AI quest drafts holds for worlds: **the model picks from lists, code decides.**
POIs are chosen by index from the POI database, templates by id from the registry, rewards come from the policy.

### B.3 Pipeline

```
brief.md ──► 1 draft (Codex / Ollama) ──► 2 validate (CLI, CI) ──► 3 preview (GeoJSON, screenshots, sample dialogue)
                     ▲                          │ fail: report                │
                     └──────── fix ─────────────┘                             ▼
                                         4 moderate (operator CLI approve/reject, hash-chained audit)
                                                                              ▼
                                         5 registry: preview → live (owner) · kill switch · retire
```

1. **Brief** (human, ≤1 page): theme, tone, target cities, POI affinities, rights situation, which quest types.
2. **Draft:** `npm run world:new -- --brief briefs/punks-city.md` (C.6 task W9) asks the model for a WorldPack
   that matches the JSON schema (structured output, re-validated). Codex is used for the art, code and tests;
   Ollama for bulk text. Every model output is stored with its prompt hash in `provenance`.
3. **Validate:** `npm run world:validate -- server/data/worlds/punks-city-v1.json` (B.4). CI runs it on every pack.
4. **Preview:** `npm run world:preview -- 2026-11-05 --layer punks-city` produces GeoJSON plus a contact sheet of
   skins and 20 sampled quest texts and NPC lines in each language.
5. **Moderate:** extend `server/cli/ai-operator.mjs` with `world decide <id> approve|reject --reason`. Writes to
   `ai_operator_audit` (already hash-chained). Community packs also need the creator policy commitment
   (`CREATOR_XP_COMMITMENT`) and a second moderator.
6. **Publish:** registry status change in a PR. `preview` = loaded and validated, only visible to operators and
   testers. `live` = visible to players who opt in. Kill switch env per layer.

### B.4 Guardrails (all deterministic, outside the model)

| Check | Rule |
| --- | --- |
| Schema | JSON schema `questlayer.worldpack/1`, unknown keys rejected, sizes bounded. |
| Rights | Every asset path has `source` + `licence`; `third-party` needs an evidence file in `public/worlds/<id>/provenance.json`; trademark words in text must be listed; "official/endorsed" wording is rejected unless evidenced. |
| Text | `server/ai/text-policy.mjs` (rewards/money promises, links, contact data, unsafe instructions such as fences, roofs, rail, water, private land, night), plus slurs/sexual/violent content lists, CS and EN. |
| Spatial | No coordinates in the pack. Content binds to POI ids that exist in the POI DB, pass the safety filter (C.2.3) and are open (operator closures). |
| Economy | `rewards.money` must be `none`; `xpWeight ≤ 1`; editions need a `supported_editions` entry on the collectibles contract before they are claimable; supply finite. |
| Quest types | Only registered template ids; params within the template's bounds (stops 2–6, ≥55 m apart, trail < 5 km). |
| Skin | Only token keys from `docs/design-tokens.json`; contrast check on every token pair used (WCAG AA); art size budgets; no remote URLs. |
| Actors | Archetypes from code only; persona cards pass the text policy; density inside `densityCapPerCell` shared by all layers. |
| Rate/cost | Batch generation has a token budget per run; runtime generation reuses existing per-person and global limits. |
| Kill switch | Each layer can be disabled by env without a deploy of new code; disabling hides content but keeps receipts and earned items. |

### B.5 Example 1: a CryptoPunks-style layer

- **Rights first.** CryptoPunks art and the name are owned by Yuga Labs; as far as we know, holders received
  commercial rights to *their own* punk in 2022, which is not a licence for us to use the collection as a theme.
  To verify before any work: current CryptoPunks terms and whether a partnership is possible. Until then the
  safe version is **"Punk City", an original theme**: original pixel-art characters inspired by 8-bit street
  culture, no Punk images, no "CryptoPunks" word in product text.
- **If a holder connects an Ethereum wallet** and owns a punk, the layer may show that punk as their avatar
  read-only (same pattern as the Base Aavegotchi appearance: verified ownership, never minted or sold by us).
  Contract to verify: CryptoPunksMarket on Ethereum mainnet `0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB`, plus
  the wrapped-punks contracts.
- **A CC0 alternative** for a fully themed layer is a collection that is genuinely CC0 (for example Nouns); then
  art may be reused with attribution.
- **Content:** POI affinity street art, music venues, plazas, skate parks (reviewed for safety); quest types
  `path-visit` ("tag the wall" = check in), `poi-category-hunt` (three murals), `ordered-trail` (gig crawl, daytime
  only); actors: DJ quest giver, glitch-rat roamer; reward: cosmetic `punk-halo` edition, XP only.

### B.6 Example 2: a player's own world

The creator community already has policy, review, XP commitment and moderation (`server/creators/`). A user world
is a `kind: "community"` WorldPack with tighter limits:

- Created in the app with the AI assistant: the player writes a theme and picks a city; the assistant proposes
  name, lore, 3–8 quests on reviewed places (existing `/api/creator-community/ai/places`), persona cards and a
  palette from a fixed set. The player edits everything.
- Limits: one city, ≤ 12 quests, only templates `path-visit`, `ordered-trail`, `return-trail`, XP only (from the
  creator commitment), skin = palette + one of the authored object sets (no uploaded art in v1), no actors in v1
  except one quest-giver persona, `private` (link only) by default.
- Publishing to `community` (visible to everyone who opts in) goes through the same moderator review as creator
  quests, plus the world validator. Reports and closures use the existing moderation pipeline.

---

## C. Finish the Aavegotchi world: complete and global

### C.1 Target state

| Coverage tier | Where | Content | Money |
| --- | --- | --- | --- |
| **A. Reviewed city** | Plzeň (later Brno, …) | Six daily slots, full quest set, NPCs, monsters, native rewards | Yes, via `NATIVE_FUNDED_CITIES` |
| **B. Auto city** | Every city with ≥ 100k people (GeoNames `cities15000` filtered, roughly 4–5k cities) | Daily zones from an auto-built CityPack (`fieldReview: "auto"`), POI quests, generic NPCs/monsters | No (XP, coins from the demo bucket, cosmetic chests only while supply lasts) |
| **C. Anywhere** | Every H3 res-7 cell on land | Existing street coins plus **POI quests** from the global POI database (C.3), wandering rare, roaming monster | No |

Precedence for one location: reviewed city > auto city > cell (deterministic, as `WORLD-GENERATION.md` requires),
so one place never gets two economic allocations. The "practice worlds anywhere" principle from
`CONTINUATION-PLAN.md` stays: global content is free practice; money only in reviewed, funded cities.

### C.2 POI databases, sources and licences

Cloud sessions cannot reach Overpass or large downloads; all imports run on the Mac or the VPS, and the
resulting files are versioned artefacts (not committed if large; hash recorded in git).

#### C.2.1 Sources

| Source | Use | Licence and obligations | Access |
| --- | --- | --- | --- |
| **OpenStreetMap** | Parks, paths, plazas, viewpoints, artwork, fountains, monuments, access tags, exclusions | ODbL 1.0: attribution "© OpenStreetMap contributors"; a derived *database* we distribute must also be ODbL (share-alike). Game content generated from it is a "produced work" (attribution only). | Geofabrik country extracts or the planet file + `osmium tags-filter`; **not** Overpass for global scale. |
| **Overture Maps Places** | Named POIs with categories and confidence, fills OSM gaps | CDLA-Permissive-2.0 for the places theme (attribution file); other themes such as buildings carry ODbL, check per theme and per release. | GeoParquet releases on S3/Azure, query with DuckDB by bbox. |
| **Wikidata** | Landmark identity, notability (sitelink count), short facts for clue quests, multilingual names | CC0 | Weekly JSON dump or SPARQL in batches; join on OSM `wikidata=` tag. |
| **Wikipedia / Wikimedia Commons** | Optional extra facts and images | Text CC BY-SA (do not paste, only use facts, attribute); images per file licence | Only for reviewed landmark clues. |
| **GeoNames** | City list, population, timezone, admin codes for tier B | CC BY 4.0 | `cities15000.zip` |
| **Natural Earth** | Country/coastline masks, land/sea | Public domain | Static download. |
| **Foursquare OS Places** (optional) | Second opinion for POI existence/closure | Apache 2.0 (verify current terms) | Parquet release. |
| **H3** | Cell index and tiling | Apache 2.0 (library) | Already used. |

Avoid: Google/Apple/Mapbox place APIs (terms forbid storing), WDPA protected areas (non-commercial licence; use OSM
`boundary=protected_area` instead), scraping review sites.

#### C.2.2 Normalised POI record

One SQLite (or PMTiles + SQLite) file per release, partitioned by H3 res-5 parent so the server loads only the
region it needs:

```
poi(id TEXT PK,            -- "osm:n123" | "ovt:<gers-id>" | merged "poi:<hash>"
    lat REAL, lng REAL, h3r7 TEXT, h3r5 TEXT,
    category TEXT,         -- QuestLayer taxonomy (C.2.4)
    name TEXT, names JSON,  -- multilingual from Wikidata/OSM
    wikidata TEXT, notability INTEGER,
    sources JSON,          -- [{source, sourceId, licence, version}]
    safety TEXT,           -- ok | review | excluded (+ reason)
    access TEXT, hours TEXT, path_ref TEXT,   -- nearest mapped public path point, for the check-in target
    source_hash TEXT)
```

Merge rule: OSM is primary for geometry and access; Overture fills missing named POIs only if an OSM public path
is within 40 m (so the check-in target is still on a mapped path); Wikidata adds names and notability.

#### C.2.3 Safety filter (hard exclusions)

Excluded categories and areas: schools, kindergartens, playgrounds (children), hospitals, care homes, prisons,
military, places of worship interiors (exterior landmarks only with `review`), cemeteries (`review`), private or
`access=no/private/customers`, railway land, motorway/trunk roads, water bodies and banks without a path, quarries,
construction sites, embassies, police stations, bars as quest targets (daytime venue listing only), anything with
`disused`/`abandoned`. Targets must snap to a mapped public path point. Operator closures (`place-safety`) apply on
top. Everything is versioned so a closure survives a re-import.

#### C.2.4 Category taxonomy (v1, ~30 categories)

`park, garden, plaza, viewpoint, fountain, monument, memorial, artwork, street_art, castle, ruins, historic_building,
museum (exterior), library (exterior), market, bridge (pedestrian), river_walk, lake_walk, trailhead, nature_reserve
(path only), observatory, landmark_tower, sculpture, picnic_site, information_board, music_venue (exterior),
sports_ground (public), skate_park (review), bench_with_view, other_named`.

Each layer weights these (`poiAffinity`); the Aavegotchi layer favours green and historic categories.

### C.3 Distributing generated quests across the whole world

Builds on what exists: H3 street worlds (`server/spatial/map-data.mjs`, 350-coin cap, no replenishment, bounded
retries), the city/day manifest, the six-slot rule and the allocation function.

1. **Deterministic, not per visitor.** For each cell (res 7, ~5 km²) and local date, seed =
   `hash(layerId, h3r7, localDate, policyVersion)`. A player's position, first login or wallet never changes the
   seed, the same rule as city worlds. The cell world id stays `demo:<cell>:<day>:v2`; POI quests attach to it.
2. **Bounded density.** Per cell per day: `k = min(6, f(POIs available))` POI quests across all layers, at least
   250 m apart, of which at most 3 trails. Empty cell (sea, desert): no invented quest, truthful
   "nothing here yet" plus coins if paths exist.
3. **Lazy materialisation.** The day's POI quests for a cell are only written when the first player loads that
   cell, from the pre-built POI file (no live map query). Same lease/once semantics as street worlds, so two
   requests produce one set.
4. **Rotation.** A POI is not reused in the same cell for 72 h if alternatives exist; notability raises the chance
   of landmark POIs a little.
5. **Flavour text** comes from a cache keyed by `(poiId, template, layerId, language, promptVersion)`. A nightly
   batch pre-generates text for cells that had players in the last 7 days (Ollama now, NEAR AI later); everything
   else uses the deterministic template text. No model call on the player's request path.
6. **Rewards:** XP from `GAME-RULES` caps, coins from the existing demo bucket, cosmetic chest only while edition
   supply lasts and capped per cell/day; no GOLD/NEAR prize outside a funded city.
7. **Auto cities (tier B)** get a full daily plan: the auto CityPack builder (C.6 task W5) runs per city and
   produces candidates exactly like `scripts/build-city-pack.mjs`; the planner publishes fewer zones with a reason
   when sectors are empty. Status `auto` means: visible to players with an "unreviewed map data" notice, never
   funded, promotion to `live` needs the field review in `SECOND-CITY-PLAYBOOK.md`.
8. **NPCs and monsters everywhere.** Replace the per-city `actors/<city>.json` requirement with a generic actor
   template (`actors/_generic.json`) whose homes are resolved from POIs at plan time; reviewed city files override
   it. Wandering rare and one roamer per active cell, a quest giver per auto city.

### C.4 Quest types to add (each one is code + tests + docs, not data)

| Type | What it validates | Data needed |
| --- | --- | --- |
| `poi-visit` | Check-in at a POI's path target (like `path-visit` but outside zones) | POI DB |
| `poi-category-hunt` | Visit N distinct POIs of one category in the cell/city within the day | POI DB |
| `landmark-clue` | Visit + answer a multiple-choice question whose answer comes from Wikidata facts (not the model) | Wikidata facts, AI only phrases the question |
| `photo-observation` | Photo evidence reviewed by the existing moderation pipeline (`docs/MODERATION-AND-EVIDENCE.md`) | Existing evidence flow |
| `npc-errand` | Talk to NPC A, visit POI, return to NPC (actors already move on the map) | Actors + POI DB |
| `monster-encounter` (exists) | Generalised to any city/cell | Generic actors |

### C.5 Skins for the Aavegotchi world

- Extract the current identity into `server/data/worlds/aavegotchi-v1.json` (tokens, object art ids, actor models,
  upstream Gotchiverse models list, avatar rules) without changing anything visible. This proves the schema on the
  real world before any new layer exists.
- Zone skins by place type: park clearing, plaza, river walk, trail pocket (shape families already exist); each
  gets a pin, a border pattern and a chest variant in the authored pixel style.
- Seasonal/regional variants as data (palette swaps of authored art), not new art per city.
- Rights: Gotchiverse props/monsters stay under the owner's recorded developer invitation (`ASSET-CATALOG.md`),
  fetched on demand, with the original stand-ins as fallback; nothing new is copied from unlicensed repositories.

### C.6 Codex work plan with ready prompts

Order matters: W1–W2 make the world model real without changing behaviour, W3–W6 make it global, W7–W10 bring AI
and new layers. Each task is one PR into `claude/upbeat-gauss-5czir7`, green CI, testnet deploy after merge
(standing rule). Tasks marked **Mac** need network access the cloud lacks.

| # | Task | Depends on | Where | Size |
| --- | --- | --- | --- | --- |
| W1 | WorldPack schema, registry and validator | — | cloud | M |
| W2 | Extract the Aavegotchi world as layer `aavegotchi` (no behaviour change) | W1 | cloud | M |
| W3 | Global POI build pipeline (OSM + Overture + Wikidata) | — | **Mac** | L |
| W4 | POI taxonomy and safety filter | W3 | cloud (fixtures) + Mac | M |
| W5 | Auto CityPack generator for GeoNames cities | W3, W4 | **Mac** | L |
| W6 | POI quests in every H3 cell | W2, W4 | cloud | L |
| W7 | Generic NPCs and monsters for any city/cell | W6 | cloud | M |
| W8 | Quest flavour batch with Ollama/NEAR AI and cache | W6 | cloud + VPS | M |
| W9 | `world:new` AI-assisted authoring CLI and moderation | W1 | cloud | M |
| W10 | "Punk City" preview layer (original art) | W2, W9 | cloud | M |
| W11 | Player-made worlds in the creator community | W9 | cloud | L |
| W12 | Global coverage QA report | W5, W6 | Mac | S |

Shared preamble for every prompt (paste first):

> You work in the `questlayer-hackathon` repository on a branch from `claude/upbeat-gauss-5czir7`. Read
> `AGENTS.md`, `docs/WORLD-GENERATION.md`, `docs/WORLDS-PLAN.md` and the files named below before changing code.
> Node 24, `npm ci`, then `npm run check` must pass. Do not touch keys, `.data/`, `runtime.env`, contracts,
> deploy scripts or published manifests; existing world ids, plan hashes and the SHA-256 pin of
> `server/data/plzen-v1.json` must stay unchanged. Product text and docs in English. No new dependency without
> naming its licence in the PR. Keep money rules: no layer, POI quest or AI output may create GOLD/NEAR rewards.
> Finish with tests, a short doc update and a PR description that lists what was verified and what was not.

**W1 — WorldPack schema, registry, validator**

> Add `server/worlds/` with `schema.mjs` (JSON schema `questlayer.worldpack/1` as in docs/WORLDS-PLAN.md B.1),
> `registry.mjs` (loads `server/data/worlds.json` like `server/spatial/city-pack.mjs` loads `cities.json`:
> statuses draft/preview/live/retired, exactly one default layer, refuse duplicates, refuse invalid packs at
> start-up) and `validate.mjs` implementing every row of B.4 that does not need the POI DB (schema, rights,
> text policy via `server/ai/text-policy.mjs`, economy, quest-type ids from `server/quest-templates.mjs`, token
> keys from `docs/design-tokens.json` with a WCAG AA contrast check). Add `npm run world:validate -- <file>`
> printing a JSON report with one reason per failure. Tests: a valid fixture, and one failing fixture per rule.
> Add the validator to CI for every file under `server/data/worlds/`.

**W2 — Aavegotchi as the default layer**

> Create `server/data/worlds/aavegotchi-v1.json` describing the current world: tokens from `src/tokens.css`,
> object art ids from `src/game-object-art-data.ts`, actor models from `src/actor-models.ts` and
> `server/upstream-models.mjs`, Aura editions from `server/data/aura-catalog.json`, quest templates in use,
> rules from `docs/GAME-RULES.md`. Register it as the default in `server/data/worlds.json`. Add `layerId:
> "aavegotchi"` to API responses (`/api/world`, `/api/config`) without adding it to any hashed or persisted
> manifest. Prove with a test that the manifests and native day hashes for 2026-11-02 and 2026-11-03 are
> identical before and after. Read the client skin from the layer only where it is a pure lookup; no visual change.

**W3 — Global POI pipeline (Mac)**

_Status (2 Nov 2026): implemented as a VPS worker for Czechia, see `docs/POI-PIPELINE.md`; runs on the VPS, not
the Mac, with a W4 stub until W4 lands._

> Add `scripts/poi/` with: `fetch.mjs` (downloads Geofabrik extracts for a country list, the Overture places
> release for a bbox via DuckDB, Wikidata items with coordinates via the weekly dump or batched SPARQL; records
> URL, version, date and SHA-256 of every input in `.data/poi/inputs.json`), `extract-osm.mjs` (osmium
> tags-filter to the taxonomy in docs/WORLDS-PLAN.md C.2.4 plus the paths needed for check-in targets),
> `merge.mjs` (record shape and merge rule in C.2.2) and `build.mjs` (writes `.data/poi/poi-<version>.sqlite`
> partitioned by H3 res-5, plus `ATTRIBUTION.md` listing ODbL, CDLA-Permissive-2.0, CC0 and CC BY 4.0 notices).
> Make every stage resumable and bounded by memory. Start with Czechia, then Europe, then the planet; print
> counts per category and per country. Add unit tests on small fixtures in `tests/fixtures/poi/` that run in
> the cloud without network.

**W4 — Taxonomy and safety filter**

> Done: `server/poi/` and `docs/POI-SAFETY.md` (interface for W3/W5/W6, reason codes, closures).

> Implement `server/poi/taxonomy.mjs` (OSM tags and Overture categories → the ~30 categories) and
> `server/poi/safety.mjs` (exclusion list in C.2.3, path snapping to a public path within 40 m, `review` state,
> operator closures from `system-place-safety`). Every excluded POI keeps a reason code. Tests: one fixture per
> exclusion, a school next to a park (park kept, school excluded, target not inside school grounds), a POI with
> no path nearby (excluded), a re-import after a closure (closure kept).

**W5 — Auto CityPacks (Mac)**

> Extend `scripts/build-city-pack.mjs` with `--from-poi <poi.sqlite> --geonames cities15000.txt --min-pop 100000
> --country CZ` to build one CityPack per city from the POI file and OSM paths, with `fieldReview: "auto"`,
> coverage box sized by population, timezone from GeoNames, and the same diagnostics. Add status `auto` to
> `server/data/cities.json` handling: planned daily, visible with an "unreviewed map data" notice, never in
> `NATIVE_FUNDED_CITIES` (start-up refuses that), and lower precedence than reviewed cities. Packs live in
> `.data/city-packs/` on the VPS; only a manifest of hashes is committed. Report: cities built, sectors empty,
> zones per city over 7 sample days.

**W6 — POI quests in every H3 cell**

> In `server/world.mjs`/a new `server/poi-quests.mjs`, attach up to 6 POI quests per H3 res-7 cell per local day
> to street worlds, following docs/WORLDS-PLAN.md C.3 points 1–6: seed `hash(layerId, cell, date, policy)`, lazy
> materialisation on first load with the existing once/lease semantics, ≥ 250 m spacing, 72 h rotation, XP only,
> coins unchanged, chest only while supply lasts with a per-cell cap. Use the POI file through a small read-only
> adapter (SQLite) with a fixture DB in tests. Add new templates `poi-visit` and `poi-category-hunt` to
> `server/quest-templates.mjs` with the same validation style as `path-visit`. Tests: same seed after restart,
> no change from player position, two parallel loads create one set, empty cell creates none, cell inside a
> city uses the city world instead.

**W7 — Generic actors**

> Status: wave 1 done (generic cast, POI homes, per-cell caps; see `docs/ACTORS-API.md`). POIs come from CityPack
> parks, zones and path junctions until the W6 POI DB registers through `registerPoiSource`.

> Add `server/data/actors/_generic.json` and `server/data/personas/_generic.json` (original characters, CS+EN,
> archetype rules unchanged). In `server/actors/definitions.mjs`/`spawns.mjs` resolve actor homes from safe POIs
> at plan time for auto cities and active cells; a reviewed city file overrides the generic one. Density caps per
> cell shared by all layers. Tests: Plzeň unchanged (same spawns for a fixed day), auto city gets one quest giver,
> a cell gets at most one roamer and one wandering rare.

**W8 — Flavour text batch**

> Done (2 Nov 2026): `server/ai/flavour.mjs` (read side for W6) and `server/ai/flavour-batch.mjs`, see
> `docs/QUEST-FLAVOUR.md`.

> Add `server/ai/flavour-batch.mjs` and `npm run ai:flavour -- --since 7d`: for cells and cities with players in
> the last 7 days, generate quest titles/descriptions per `(poiId, template, layerId, language, promptVersion)`
> through the existing provider interface (`template|ollama|anthropic|near-ai|off`), validate with
> `server/ai/text-policy.mjs`, store in a new cache table registered via `registerModuleSchema`, fall back to the
> deterministic template text. Model input: POI name, category, Wikidata short facts, layer lore; never player
> data. Hard token budget per run, audit row per batch. No model call on any player request path. Tests with a
> fake provider.

**W9 — `world:new` authoring CLI and moderation**

> Add `npm run world:new -- --brief <file.md> --id <id>` that asks the configured provider for a WorldPack draft
> as structured output, re-validates with W1, writes `server/data/worlds/<id>-v1.json` with status `draft` and
> `provenance`, and prints the validation report. Extend `server/cli/ai-operator.mjs` with `world preview <id>`
> (GeoJSON for one day + 20 sampled texts per language) and `world decide <id> approve|reject --reason` writing
> to `ai_operator_audit`. Approval never changes the registry; that stays a PR. Tests with a fake provider,
> including a draft that promises money (rejected) and one with an unknown template (rejected).

**W10 — "Punk City" preview layer**

> Using `world:new` and manual edits, create `server/data/worlds/punks-city-v1.json` with original 8-bit street
> art (authored in code like `src/game-object-art-data.ts`), no CryptoPunks images or name in product text, POI
> affinity street_art/music_venue/plaza, two quest types, one quest-giver persona and one roamer, one cosmetic
> edition marked not yet claimable. Status `preview`. Add the opt-in layer switch in the client behind
> `WORLD_LAYERS_UI=1`, only visible to operators. Document the rights position in `docs/WORLDS-PLAN.md` B.5.

**W11 — Player-made worlds**

> Add `kind: "community"` WorldPacks to the creator community: routes to create/edit a private world from the
> AI assistant (reusing `/api/creator-community/ai/places` and quest drafts), limits from docs/WORLDS-PLAN.md
> B.6, submission into the existing moderation queue, share link for `private`, opt-in listing for approved
> `community` worlds. Everything XP-only from the creator commitment. Tests: limits enforced, unapproved world
> invisible to others, report → closure hides it.

**W12 — Global coverage QA (Mac)**

_Status (2 Nov 2026): implemented for Czechia on the VPS POI file, see `docs/WORLD-COVERAGE.md`: `npm run
world:coverage`, `poiWorld` in `/api/health`, and the `npm run e2e:world` journeys. Auto-city sectors are a 3 km
six-sector proxy until W5 lands; POI quest counts are the C.3 capacity until W6 lands._

> Add `npm run world:coverage -- --poi <file> --cities <n> --days 365` producing a report: per country cells
> with ≥1 POI quest, quests per cell distribution, share of excluded POIs by reason, auto cities with all six
> sectors, empty-sector list, and a random sample of 50 POI quests with map links for manual review. Save it in
> `output/qa/worlds-coverage/`.

### C.7 Order for the hackathon (until 14 Nov) and after

- **Before submission (realistic):** W1, W2, W4 with fixtures, W6 on a Czechia POI file, W7, W8 (Ollama). That
  makes the demo "go anywhere in Czechia and find quests and NPCs", while Plzeň stays the funded showcase.
  W3/W5 for Czechia only on the Mac.
- **After submission:** W3/W5 Europe then planet, W9–W11 (new layers and player worlds), NEAR AI Cloud switch
  once a key exists (`docs/NPC-PLAN.md` §12), PostGIS migration when the POI DB outgrows SQLite.

### C.8 Open decisions for the owner

1. Coverage scope before 14 Nov: Czechia only (recommended) or Europe.
2. Should auto cities show daily zones, or only POI quests until a field review (recommended: zones with the
   "unreviewed" notice, never funded)?
3. CryptoPunks: ask Yuga Labs / check terms, or go with the original "Punk City" theme (recommended for now).
4. Player-made worlds: private-only first (recommended), or public listing from day one.

Owner answers (2 Nov 2026): 1. Czechia only before 14 Nov. 2. Auto cities show zones with an "unverified map"
notice and are never funded. 3. Original "Punk City" theme. 4. Player worlds private-only.

### C.9 Implementation status

**W1 and W2 are implemented** (2 Nov 2026):

- `server/worlds/schema.mjs` checks the `questlayer.worldpack/1` shape (unknown keys rejected, sizes bounded,
  64 KiB per pack). `server/worlds/validate.mjs` adds every B.4 rule that does not need the POI DB: rights
  (assets under `public/worlds/<id>/`, third-party evidence file, known trademarks listed, no "official/endorsed"
  wording without evidence), text policy (`server/ai/text-policy.mjs`), economy (`money: "none"`, `xpWeight ≤ 1`,
  finite edition supply, editions only in official packs), quest templates from `server/quest-templates.mjs`,
  archetypes from `server/actors/definitions.mjs`, actor models and object kinds from the client sources (copied to
  `server/data/world-lookups.json` because the deploy ships `server/` only; a test keeps the copy in sync),
  token keys from `docs/design-tokens.json` with a WCAG AA check on every overridden text pair, and rules
  (private worlds name their cities, the default layer is open from level 1).
- `server/worlds/registry.mjs` loads `server/data/worlds.json` at start-up: statuses draft/preview/live/retired,
  exactly one live official default, duplicates and invalid packs refused, private packs never live, a kill
  switch env per layer (the default cannot be switched off), and the SHA-256 of each pack file. At start-up asset files are not checked (they are not deployed); CI checks them.
- `server/data/worlds/aavegotchi-v1.json` describes today's world (23 Aura editions, Plzeň actors and personas,
  the four zone-quest templates, zone tier colours, built-in object art, 08:00–20:00) and is the default layer.
  Its file hash is pinned in `tests/world-layers.test.mjs`; a change is a new `-v<n>` file.
- `/api/config` returns `layerId` and the live `layers`; `/api/world` returns `layerId`. Neither is stored in a
  manifest. A test pins the Plzeň plan hashes for 2026-11-02 and 2026-11-03.
- `npm run world:validate [-- <file>]` prints a JSON report; `npm test` validates every file under
  `server/data/worlds/`, so CI gates them.
- Not done yet: the client still reads its skin from `src/tokens.css` (no visual change); POI-bound checks
  (spatial, per-cell density across layers) arrive with W4/W6.

**W6 is implemented** (2 Nov 2026, `server/poi-quests.mjs`):

- Street worlds (`demo:<h3r7>:<day>:v2`, never city worlds or the arena) get up to 6 POI quests on the first load
  of the day, read from the W3 file (`POI_DB_PATH`, default `/var/lib/questlayer-poi/current.sqlite`, opened
  read-only, reopened when the symlink changes). Only `safety='ok'` rows with a `path_ref` target are used.
  `POI_QUESTS=off` disables it; a missing file changes nothing.
- Seed `hash(layerId, cell, localDate, poi-quests-v1)`; targets ≥ 250 m apart; up to 2 category hunts
  (`poi-category-hunt`, 3 stops of one category, any order, progress in `poi_hunt_stops`) and single visits
  (`poi-visit`); POIs used in the cell during the 3 previous local days are only reused when nothing else fits;
  Wikidata notability raises the chance a little. Open during the layer hours (08:00–20:00 local).
- Once semantics: quest rows, the world manifest (`poiQuests`, extra zones with `source: "poi"`) and the job key
  `poi-quests:<worldId>` are written in one transaction.
- Rewards: 40 XP visit, 90 XP hunt, one chest per cell/day (60 XP, Aura only while edition supply lasts),
  `gold_u = 0` always; street coins unchanged.
- An empty cell stores `poiQuests.status = "empty"` and the client says "Nothing here yet".
- Titles: the stored rule text, replaced at read time by validated W8 flavour text (`flavourText`, cache hit only); chests keep their own text and the activity objective stays authoritative.
- Auto cities (W5) get the same POI quests per H3 cell inside the city, materialised for the cell the player
  loads from (job key `poi-quests:<worldId>:<cell>`, `manifest.poiQuests.cells`), spaced 250 m from the city's
  own zones too. XP and cosmetics only, the "Unverified map" notice stays. Since 3 Nov 2026 reviewed cities (Plzeň,
  GPS world and city demo) get them the same way next to their own reviewed zones (`POI_QUESTS_REVIEWED_CITIES=off`
  turns it off). A city world also searches another cell when the player walks ~650 m from every searched spot, or
  taps "Search this area" after moving the map there (`POST /api/world` with `explore`, same city only).

**W5 is implemented** (2 Nov 2026) for Czechia with a 15,000-people threshold (owner decision: Czechia only before
14 Nov). It runs on the VPS as a step of the World worker instead of on the Mac, because the OSM extracts already
live there. Details in `docs/POI-PIPELINE.md` "Auto cities (W5)": `scripts/poi/auto-cities.mjs` builds the packs,
`server/spatial/auto-cities.mjs` loads them lazily with hash checks, `cityFor` resolves reviewed > auto > cell,
the client shows the "Unverified map" notice, auto zones carry no prize, and `NATIVE_FUNDED_CITIES` refuses auto
cities at start-up.
