# Bounded AI quest drafts (W11)

Creators (and operators signed in as players) can ask for a suggested quest for
one reviewed CityPack place and one creator template: visit, trail (2–6 stops)
or chest. The suggestion only fills the quest editor. The author edits it, saves
it as a draft and submits it through the normal creator review. Nothing is saved
or published by the drafting service.

## Routes (creator community must be enabled)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/creator-community/ai/status` | Provider, live cities, remaining limits |
| GET | `/api/creator-community/ai/places?city=plzen` | Open reviewed places with their stop count |
| POST | `/api/creator-community/ai/quest-drafts` | `{cityId, candidateId, template, stops?, notes?, language?}` → suggestion |

The suggestion's `draft` field has exactly the shape `POST /quests` accepts.

## Boundaries enforced outside the model

- The model never writes coordinates. It picks stops by index from mapped public
  path points inside the place; closed places (operator closures) and exclusions
  are removed first. Stops are at least 55 m apart and a trail stays under 5 km.
- Output must match a strict JSON schema (sent to the provider as structured
  output and re-validated). Text is length-bounded and rejected when it promises
  rewards or money (NEAR, GOLD, XP, Aura, prizes, currencies), contains links or
  contact details, markup, unsafe instructions (fences, roofs, railways, water,
  private land, night) or prompt leakage. Czech and English are checked.
- Any rejected, refused, truncated or failed generation falls back to the
  deterministic template draft, and the response says why.
- Every draft ends with a fixed safety line; rewards and price stay in the form.
- Place names (OpenStreetMap) and creator notes are passed as untrusted data.
- Rate limits per person (hour, day) and globally per day. Every request,
  including limited ones, is audited in `ai_quest_draft_requests` with the
  provider, model, outcome, reason and input/output hashes; the response carries
  policy, prompt and CityPack versions.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUEST_AI_PROVIDER` | `template` | `template` (offline, deterministic), `ollama`, `anthropic`, or `off` (emergency disable) |
| `ANTHROPIC_API_KEY` | – | Required for `anthropic`; without it the template provider is used |
| `QUEST_AI_MODEL` | `claude-opus-5-5` | Claude model for drafts |
| `QUEST_AI_LIMIT_PER_HOUR` | `6` | Suggestions per person per hour |
| `QUEST_AI_LIMIT_PER_DAY` | `20` | Suggestions per person per day |
| `QUEST_AI_LIMIT_GLOBAL_PER_DAY` | `300` | Suggestions for everyone per day |

`off` leaves the city and the manual creator flow fully playable.

## Ollama Cloud

`QUEST_AI_PROVIDER=ollama` and/or `GUIDE_AI_PROVIDER=ollama` use Ollama's
`/api/chat` with the same JSON schema passed as `format`, then the same checks.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OLLAMA_API_KEY` | – | Ollama Cloud key; only in the VPS `runtime.env`, never in the repository |
| `OLLAMA_MODEL` | `deepseek-v4.1-flash` | Cloud model; `gpt-oss:120b` or `kimi-k2.6` are alternatives |
| `OLLAMA_BASE_URL` | `https://ollama.com` | https, or a localhost Ollama |

Without a key both features stay on their deterministic answers.

The Ollama path asks for structured output with thinking off, accepts JSON in
code fences or surrounded by prose, and retries once in plain JSON mode with
the schema in the prompt. Extra keys are ignored; content checks are unchanged.
`AI_DEBUG_REJECTED=1` logs a redacted, truncated sample of rejected output
(reason and up to 400 characters) to the service log for diagnosis.

# Grounded guide

`POST /api/npc {question, worldId?, location?}` answers from facts the server
builds for this player (`server/ai/guide.mjs`): open zones, the nearest eligible
discoveries for the player's tier (straight-line distance, closing time, chest
editions), discoveries opening later, street coins and, when a testnet day is
published, its coins, claims used, the unclaimed pot (coins plus open zone
prizes, first finisher only) and its funding source.

A model only rephrases those facts. Its JSON answer must cite known fact ids,
may contain no number that is not in the facts, and is screened for links,
markup, unsafe instructions, requests for keys or passwords, promises and
prompt leakage. Anything else returns the rules answer built from the same
facts. Per-player hourly limit `GUIDE_AI_LIMIT_PER_HOUR` (30). Every request is
audited in `ai_guide_requests` with fact/answer hashes; questions are not stored.

`GUIDE_AI_PROVIDER`: `template` (default), `ollama`, `anthropic`, `near-ai`
(only with `NEAR_AI_ENABLED=1` and a key, see docs/NEAR-AI-CLOUD.md) or `off`. `GUIDE_AI_MODEL` overrides the model.

# Operator previews

Operator authority is local database access; there is no HTTP route.

```
node server/cli/ai-operator.mjs preview-day --database /abs/db.sqlite --operator NAME --city plzen --day 2026-11-05
node server/cli/ai-operator.mjs draft  --database ... --operator NAME --city plzen --candidate ID --template trail [--stops 3] [--language cs]
node server/cli/ai-operator.mjs list   --database ... --operator NAME [--state previewed|approved|rejected]
node server/cli/ai-operator.mjs decide --database ... --operator NAME --proposal ID --action approve|reject --reason TEXT --apply
node server/cli/ai-operator.mjs audit|verify --database ... --operator NAME
```

`preview-day` builds today's or a future day's city plan with operator place
closures applied and stores nothing. `draft` stores a proposal in state
`previewed`; `decide` moves it to `approved` or `rejected` once. Approval never
publishes: an approved proposal goes through the creator flow and review. All
actions append to the hash-chained `ai_operator_audit`; `verify` detects edits.
