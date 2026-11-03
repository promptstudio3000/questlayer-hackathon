# Landmark clues and NPC errands

3 November 2026. Two quest types from `docs/WORLDS-PLAN.md` C.4, for street cells and
auto cities that get POI quests (W6, `server/poi-quests.mjs`). Testnet, Czechia only,
like the POI file they read. Reviewed cities (Plzeň) and native publications are
unchanged.

## `landmark-clue`

A visit to a named place, plus one multiple-choice question about it.

- **Where the answer comes from.** Only Wikidata facts in the checked POI file
  (`poi.facts`, written by `scripts/poi/merge.mjs`): the short description per language
  and, from cache version 2 of `scripts/poi/fetch.mjs`, the inception year (P571).
  No model writes an option or picks the answer. The question is a fixed template in
  English and Czech; the place name comes from the POI file.
- **Question kinds** (`server/landmark-clue.mjs`):
  - *inception*: "In which century was X founded or built?" The right century and three
    neighbouring ones, never a future century and never BC next to an AD answer.
  - *description*: "Which short description of X is the one Wikidata gives?" The right
    description and three descriptions of other kinds of places in the same H3 res-5
    area. Descriptions that are equal after normalising, contain the place's name, or
    are Wikimedia housekeeping ("category", "disambiguation") are skipped. Fewer than
    two usable wrong options means no clue: the place stays a plain visit.
- **Plan.** `planCellPoiQuests` turns up to two single visits per cell and day
  (`MAX_CLUES_PER_CELL`) into clues, most notable place first, never the chest. The
  choice is deterministic for the same cell, day and POI file.
- **Answering.** The answer is sent with the visit (`POST /api/quests/claim`
  `{questId, fix, answer}`); the ordinary location, opening-hours and tier checks run
  first. One answer per player (`landmark_clue_answers`): right = 70 XP, wrong = 20 XP
  and the right option is shown. A second claim replays and never re-scores. GOLD is
  always 0.
- **Player view.** `worldView` adds `quest.clue = {question, options[{id,text}], source,
  policy, xp}`; `result {choice, correct, answer}` appears only after this player
  answered. The answer never leaves the server before that. `POST /api/world` takes
  `lang: "cs"` for the Czech question and options. A clue keeps its rule title
  ("Clue at X"): W8 flavour text built from the Wikidata description could give the
  answer away, so it is not applied to clues.
- **AI.** Nothing on a request path calls a model. The question needs no model at all;
  a future AI phrasing may only reword the question template and must be checked to
  contain no option text.

### Data refresh

Existing POI releases have descriptions only, so description clues work on the VPS
file today. Inception questions appear after the next POI worker run (Sundays 02:40
UTC, or `systemctl start questlayer-poi`): the cache version bump refetches every
Wikidata id once (about one SPARQL batch of 250 ids per second).

## `npc-errand`

A quest giver (generic cast: Lenka the Wayfinder) sends the player to one of today's
POI quests and wants them back to report.

- **Offer.** `buildMenu` adds at most one errand per NPC, player and day
  (`MAX_ERRANDS_PER_DAY`), only when an open POI quest exists in the player's world.
  A landmark clue is preferred. It is a `quest` offer with `terms.errand`, so no table
  migration was needed; it does not use up the daily quest lines.
- **Visit.** The ordinary quest claim at the place (with its answer for a clue).
- **Return.** Turn-in (`POST /api/actors/:id/offers/:offerId/complete`) needs an
  encounter with the same NPC created **after** the place's quest claim. An encounter
  checks GPS distance to the NPC's server-computed position, so the meeting that handed
  out the errand cannot be reused (`NPC_ERRAND_RETURN`).
- **Reward.** 40 XP, plus 10 XP when the errand was a landmark clue answered right. No
  Aura, no GOLD, no NEAR.

## Tests

`tests/landmark-errand.test.mjs`: Wikidata year parsing and facts, deterministic clue
options, plan limits, one answer with right/wrong XP and no answer leak, the Czech view,
and the errand accept → visit → stale meeting refused → fresh meeting turn-in path.
