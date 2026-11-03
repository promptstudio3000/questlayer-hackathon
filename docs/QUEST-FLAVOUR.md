# Quest flavour texts (World worker W8)

Task W8 of `docs/WORLDS-PLAN.md` C.6, rule C.3 point 5. POI quests (W6) get their title and description from a
cache that a nightly batch fills with model-written text. Nothing on a player request path calls a model.

## Read side (W6 uses this)

```js
import { flavourText } from "./ai/flavour.mjs";
const { title, description, source } = flavourText(db, { poi, template: "poi-visit", lang: "cs" });
// source: "cache" (validated model text) or "template" (deterministic fallback)
```

- Synchronous, read-only lookup keyed by `(poiId, template, layerId, lang, promptVersion)`.
- `poi` is a row of the W3 POI file (`id, category, name, names, facts`). Templates: `poi-visit`,
  `poi-category-hunt`. Languages `en`, `cs` (anything else reads English). Layer defaults to `aavegotchi`.
- A miss, a new prompt version or a new layer returns the template text, so the game works with the batch off.

## Write side (nightly batch)

`server/ai/flavour-batch.mjs`, started in the server process (`startFlavourWorker`) or by hand:

```
npm run ai:flavour -- --since 7d [--dry-run] [--max-pois N] [--budget N] [--poi PATH] [--layer ID]
```

1. **Active regions**: `worlds` rows created in the window (a row exists only when a player opened that world).
   Street worlds give their H3 res-7 cell; a city world (`city-<id>`) expands to the res-7 cells of the city's
   coverage box (at most 120). Arena worlds are ignored. Only region ids are read: no player, wallet or position.
2. **POIs**: up to 24 per cell from the W3 file (`POI_DB_PATH`, default `/var/lib/questlayer-poi/current.sqlite`),
   opened read-only, `safety='ok'` only, notable first. Already cached texts are skipped.
3. **Model**: chunks of 4 POIs, all missing `(template, lang)` items in one structured call. Input is the POI's
   names, category, Wikidata short description and the layer lore; place data is marked untrusted. The prompt
   lists the exact words the text policy rejects (also used figuratively, such as "dive into history"). Items
   that come back missing or rejected get **one follow-up call** per chunk that names each item's problem in plain
   words; the rejected text itself is never sent back. Keys are matched ignoring spaces and case.
4. **Validation** (`validateFlavour`): length limits (title 3-80, description 20-220; an over-long description
   keeps its leading whole sentences when they fit), every rule of `server/ai/text-policy.mjs` (rewards, money,
   links, markup, unsafe advice, credentials, promises, prompt leaks), no numbers that are not in the POI's own
   name or facts, and the right language. The word rules and the language check ignore the place's own names,
   including Czech declined forms (`withoutNames`): "Plavecký stadion" or "Vyhlídka Skok" are names, not advice
   to swim or jump. The language check counts Czech and English signal words and ignores capitalised proper
   nouns, so English text may name Czech towns and streets. A rejected text is not stored; players keep the
   template text.
5. **Budget and audit**: the run stops before a call whose worst-case size would exceed `FLAVOUR_TOKEN_BUDGET`
   (estimated at 3.5 characters per token). One `ai_flavour_batches` row per run records counts, calls, failed
   calls, tokens, outcome (`completed`, `budget`, `skipped`, `failed`) and reason. `ai_flavour_rejections` counts
   the final rejections per batch, reason (`missing`, `schema`, a policy rule, `invented-number`,
   `wrong-language`, length) and language, with one short redacted sample each. `/api/health` shows the last
   batch as `questFlavour.lastBatch` with `rejectionRate` (rejected / checked) and `topRejectionReasons` (no
   texts, no POI ids).

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `FLAVOUR_AI_PROVIDER` | value of `QUEST_AI_PROVIDER`, else `template` | `template` (no batch), `ollama`, `anthropic`, `near-ai`, `off` |
| `FLAVOUR_BATCH` | on | `off` stops the nightly timer (manual runs still work) |
| `FLAVOUR_BATCH_HOUR_UTC` | `1` | the timer runs once per UTC date at or after this hour (claims `flavour:<date>` in `daily_jobs`) |
| `FLAVOUR_TOKEN_BUDGET` | `120000` | hard estimated token cap per run |
| `FLAVOUR_MAX_POIS` | `300` | POIs per run |
| `POI_DB_PATH` | `/var/lib/questlayer-poi/current.sqlite` | W3 POI file |

Keys come from the existing variables (`OLLAMA_API_KEY`, `ANTHROPIC_API_KEY`, `NEAR_AI_API_KEY`) and are never
logged or printed. On the testnet VPS `QUEST_AI_PROVIDER=ollama` is already set, so the batch uses Ollama
(`deepseek-v4.1-flash`) without a new setting. Switching to NEAR AI later is `FLAVOUR_AI_PROVIDER=near-ai` plus
`NEAR_AI_API_KEY` and `NEAR_AI_MODEL`.

A new prompt version (`FLAVOUR_PROMPT_VERSION`) makes every cached text a miss, so the next batches refill the
cache while players see template text. `AI_DEBUG_REJECTED=1` logs redacted samples of rejected texts.

## Tests

`tests/ai-flavour.test.mjs`: fixture POI file and a fake provider; template texts pass their own checks, every
rejection reason, cache read after a batch, only missing items asked again, budget stop with no call, provider
failure keeps templates, active-region window (arena ignored, city expanded), skips without provider or POI
file, once-per-date timer, configuration, a CLI dry run that never prints the key, the CLI on a database that
already has every catalog module's tables, realistic model outputs from `tests/fixtures/flavour-model-outputs.json`
(good text passes, unsafe text stays rejected) and the follow-up call with reasons in the health summary.

## 3 Nov 2026 rejection fix

The first VPS batch accepted 213 and rejected 779 texts (79 %). The audit then stored only counts, so the cause
was found from the validator: it screened the place names themselves (sports grounds, viewpoints and streets with
words like "plav", "skok", "tunel"), rejected English text that named a Czech town or district, rejected text one
sentence over the limit, and counted items the model left out as rejected with no second chance. The fixture set
goes from 5 of 10 good texts rejected to 0 with every unsafe sample still rejected. Prompt version stays
`flavour-v1`: texts accepted before still pass the new checks.

The CLIs in `server/cli/` load `server/schema-catalog.mjs` before opening the database, so tables that other
modules create lazily no longer fail preflight with `SCHEMA_INCOMPATIBLE`.
