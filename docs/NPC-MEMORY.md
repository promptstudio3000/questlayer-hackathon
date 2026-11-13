# NPC missions and shared memory

Every NPC has an agent card (`server/data/npc-agents/<persona>.md`, agents.md style) with a
mission topic, the question it asks and its rules. Players answer; NEAR AI turns a useful
answer into a neutral tip for the place; other players get those tips back in normal NPC
conversations. Plan: https://claude.ai/artifact/UDffrVXsT3NKpjBNLjUstG

## Pieces

| File | What |
| --- | --- |
| `server/npc/agents.mjs` | Topic catalog (`pub`, `food`, `sights`, `secret`, `view`), agent card loader, `missionFor` |
| `server/data/npc-agents/*.md` | One card per persona; front matter `persona`, `topic`, `ask_en`, `ask_cs`; body goes into the system prompt |
| `server/npc/lore.mjs` | Schema module `npc-lore` v1 (`npc_lore`, `npc_lore_answers`), guard, NEAR AI judge, XP, tip facts |
| `server/data/npc-lore/*.json` | Reviewed starter tips per place (`city:plzen`) |
| `server/npc/lore-web.mjs` | Wikipedia GeoSearch (off unless `NPC_WEB_SEARCH=wikipedia`) |
| `server/cli/npc-lore.mjs` | `npm run npc:lore -- list --database /abs/db --place city:plzen`, `set --id … --state hidden` |
| `src/NpcChat.tsx` | Chat mode (lazy chunk) |

## API

- `POST /api/actors/:id/greet` now returns `mission: {topic, ask, answered, xp, left}`.
- `POST /api/actors/:id/mission {encounter, answer}` → `{outcome, say, xp, note?, mission}`.
  Outcomes: `new`, `confirmed`, `duplicate`, `off_topic`, `rejected`, `pending`, `limited`.
- `POST /api/actors/:id/talk` adds up to four `tip-N` facts ("Explorers say …") for the place.

## Place key

`city:<cityId>` when the world has a city pack (Plzeň and auto CityPacks), otherwise
`h3:<res-6 cell>` of the NPC's position (about 36 km²).

## Safety

1. Rule guard before the model: 6–300 characters; no links, contacts, markup, credential
   requests; no prompt-injection phrases; no personal data (home, names, phone, birth number);
   no abuse. Refused answers never reach the model.
2. NEAR AI (private inference) gets the answer only inside `<explorer_answer>` and returns strict
   JSON (`verdict`, `tip`, `place`, `matches`, `say`).
3. The tip is screened again (also unsafe advice, prices, rewards). A near copy of a known tip
   becomes a confirmation. The NPC reply is dropped for the template line if it mentions
   numbers or rewards.
4. Contributors are stored only as a one-way hash, never returned; NPCs say "explorers tell me".
5. Without NEAR AI an answer is kept as `pending` (never shown, no XP) for the operator CLI.

## XP

| Setting | Default |
| --- | --- |
| `NPC_LORE_XP` (new tip) | 30 |
| `NPC_LORE_CONFIRM_XP` (confirmation) | 10 |
| `NPC_LORE_DAILY` (rewarded answers per player and day) | 3 |
| `NPC_LORE_ATTEMPTS` (answers of any kind per day) | 10 |

One rewarded answer per NPC and day, and the XP also goes through the fair-play location caps.

## Web search

`NPC_WEB_SEARCH=wikipedia` (optional `NPC_WEB_SEARCH_LANG=cs`). On a greeting, at most once a
week per place, the server asks `<lang>.wikipedia.org` GeoSearch for pages within 2.5 km of the
NPC, keeps the first sentence of up to five intros as `web` sights for seven days. Only the
coordinates are sent. Needs outbound HTTPS to `*.wikipedia.org` on the VPS.
