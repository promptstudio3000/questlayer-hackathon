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
| `QUEST_AI_PROVIDER` | `template` | `template` (offline, deterministic), `anthropic`, or `off` (emergency disable) |
| `ANTHROPIC_API_KEY` | – | Required for `anthropic`; without it the template provider is used |
| `QUEST_AI_MODEL` | `claude-opus-5-5` | Claude model for drafts |
| `QUEST_AI_LIMIT_PER_HOUR` | `6` | Suggestions per person per hour |
| `QUEST_AI_LIMIT_PER_DAY` | `20` | Suggestions per person per day |
| `QUEST_AI_LIMIT_GLOBAL_PER_DAY` | `300` | Suggestions for everyone per day |

`off` leaves the city and the manual creator flow fully playable.
