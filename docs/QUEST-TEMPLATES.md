# Reusable zone quests

31 October 2026. Implementation scope: W01 content definitions, W02 requirement
metadata and W06 checkpoint integrity. This is a backend capability record, not a
claim that the complete city pilot or mobile experience has passed its exit gate.

The player problem is that every zone previously repeated the same visit, three-stop
walk and chest without a reusable description of what the evidence service actually
checks. The new registry makes those requirements explicit and adds a return walk.
It does not invent landmarks, verified walking routes or automatic photo judgment.

## Implemented templates

| ID | Player action | Validated requirement | Reward boundary |
| --- | --- | --- | --- |
| `path-visit` | Confirm visit | Accepted location at one target, inside the zone, during its opening and at the required tier | Existing 50 XP once; the existing funded shared prize can pay once |
| `ordered-trail` | Record stop | Three distinct target confirmations in order | Existing 100 XP once after the last stop; no extra GOLD budget |
| `return-trail` | Record stop | Start → second stop → third stop → return to start | The same 100 XP as the ordered trail, once after the return; no extra GOLD budget |
| `cosmetic-chest` | Open chest | Accepted location at the chest with the same zone/time/tier checks | Existing 80 XP once; an Aura only while the existing bounded edition has supply |

Each newly prepared demo zone still contains exactly three choices: one visit, one
trail and one chest. A shared city/day seed and slot parity select three ordered
trails and three return trails across the six zones. Player identity, request order,
first login and current player coordinates do not influence the choice. The return
walk revisits a marker; its connecting lines do not claim that a safe circular route
or a pedestrian connection has been verified.

Visit and chest constructors can be reused with a single supplied target. Trail
constructors require three distinct targets. The generator supplies the visit at
target 1, chest at target 2 and trail from all three existing path targets. The
constructor rejects non-finite coordinates, targets outside the published polygon
(including holes), missing targets and distinct trail targets less than 55 m apart.
This is a versioned separation check against the current 25 m demo proximity radius,
not a new promise of GPS accuracy or a replacement for path/access review.

The current server checks a target coordinate, not the complete journey between
targets. It has no physical cache code, image review, object recognition, verified
landmark answer or verified walking duration. Observation text in existing native
quests remains optional. No reward requires an unimplemented observation check.

## Activation and immutable worlds

- Policy: `zone-quests-v1`, template version `1`.
- Earliest generation date: **2 November 2026**, in the city's local calendar.
- Only a city/day that has not already been prepared receives the new definitions.
  Existing persisted `world_blueprints` are read first and retain their original body
  and integrity hash, including a pre-prepared future day without template metadata.
- Existing materialized worlds and quests keep their IDs, titles, target coordinates,
  checkpoint counts, progress, prize reservations and receipts. Response metadata
  describes their saved requirements; it does not regenerate them.
- The CityPack, six city slots, polygons, seed, zone schedules and source hash stay
  unchanged. New plans carry a separate `questPolicy` and per-zone `questActivities`.
- `native-city-v1` publication remains exactly its original three-stop format. The
  native manifest function and signed reward message are unchanged. Demo template
  metadata is excluded from the hashed native body, including when reconstructing
  an already published day from a fresh database.
- `describeNativeQuest` enriches a response only. It must never be copied into the
  persisted or hashed v1 manifest. Native template variety needs an explicit future
  publication policy and migration, not a change under existing v1 day IDs.

## Native manifest v2 (`native-city-v2`, built 1 November)

- New, not-yet-prepared native dates from **3 November 2026** (`NATIVE_V2_START_DAY`) are
  prepared as manifest `version: 2` under the day id `<city>-YYYY-MM-DD-v2`.
  `NATIVE_MANIFEST_V2_FROM=YYYY-MM-DD` moves the date; `NATIVE_MANIFEST_V2_FROM=off` keeps
  every new date on v1. A date that already has a stored manifest of either version keeps
  it, and a date that is already on chain without its durable manifest still stops the
  publisher, under either id, so a date is never published twice.
- Each of the six slots names a `template`: `path-visit` (1 stop, 40 XP), `ordered-trail`
  (3 stops, 80 XP), `return-trail` (3 stops and back to the first, 100 XP) and
  `cosmetic-chest` (1 stop, 50 XP). The rotation comes from the city/day hash, so every
  day carries all four. Stops are always the zone's own published targets; a zone that
  cannot carry its template keeps the v1 three-stop walk.
- Attestation is unchanged: the attestor accepts the checkpoints in order and signs the
  same reward message; the contract is unchanged (six quests, XP at most 500 each).
- Payout exposure is identical to v1 for the same budget: the same coins, coin unit and
  tier-weighted zone prizes, still bounded by the city allocation, the per-publication cap
  and the contract's per-date total. A native chest grants no item; the first opener takes
  any funded zone prize.
- `finds` lists up to 60 coin indexes spaced about 150 m apart. A street find is a
  highlighted coin: same unit, the contract's fixed 2 XP, no new right.
- v1 days, their hashes and golden tests are untouched. Tests: `tests/native-manifest-v2.test.mjs`.

Do not rewrite this policy's semantics in place after publication. A future mechanic
needs a new version, honest evidence capabilities and an activation decision that
preserves prepared worlds and outstanding claims.

## API and UI contract

`server/quest-templates.mjs` exports:

| Export | Responsibility |
| --- | --- |
| `questTemplateCatalog()` | JSON-safe implemented template catalog and explicitly planned capabilities; no publication or monetary side effects |
| `instantiateQuestTemplate(id, zone)` | Validate supplied target geometry and produce one immutable definition for the caller to persist |
| `zoneQuestTemplates(zone, {cityId, day})` | Deterministic three-choice set for a new city/day slot |
| `describeStoredQuest(quest, metadata)` | Describe an already stored demo quest without altering its requirement |
| `describeNativeQuest(quest)` | Describe an existing native three-stop quest outside its committed body |

The catalog can be returned by `GET /api/quest-templates`. Demo `worldView` includes an
`activity` object per quest. Native snapshot enrichment uses the same shape:

```text
activity
  templateId, version, policy
  icon: visit | trail | return | chest
  objective, actionLabel
  steps: [{index, label, point: {lat, lng}}]
  evidence: {kind, attests, doesNotAttest, observationRequired: false}
  safety: {access, routing, instruction, fieldReview}
  distanceLowerBoundM, distanceBasis
  durationMinutes: null
  rewardConstraint
```

The existing quest fields remain authoritative for reward amount, XP, tier, opening,
shared-prize status, personal completion, current checkpoint and remaining chest
supply. Templates have no permission to change these values. The catalog is a
capability list, not a promise that every listed template is active in today's world.

Use the objective and current step in the compact player surface. Put evidence,
access limitations and reward detail in a deliberate detail view. Map the icon key
to the existing Phosphor or authored object family; never render it as random emoji.
`distanceLowerBoundM` sums straight lines between stops and excludes travel to the
start. It is not a walking-distance estimate. A single-target activity has zero
inter-target distance, not a zero-distance player journey. No duration is advertised
without a reviewed pedestrian route or field timing.

## Progress, replay and settlement

Ordered progression checks the client's expected checkpoint against the stored
player-specific checkpoint. Skips and stale/repeated progression requests cannot
advance it, and a different player cannot reuse another player's progress. Distinct
targets cannot all be confirmed from one stationary coordinate under the current
proximity radius.

For newly generated physical demo trails, each accepted GPS timestamp must advance
strictly beyond the previous one. The progress row's `updated_at` stores the accepted
fix timestamp for this policy; legacy rows and arena rows retain server receipt time.
This prevents replaying the starting fix at the return marker. Freshness, accuracy,
zone membership, opening and tier are checked before storage. Browser coordinates
can still be fabricated; this mechanism does not establish spoof resistance or prove
that a person physically walked a route. The arena continues to be simulation.

The last checkpoint and its quest settlement now commit in one database transaction.
If receipt/history persistence fails, both checkpoint and award roll back, so the
same final step can be retried. Cash amounts, XP amounts, prize ordering, edition
supply, tier calculations and the 50/50 treasury split are unchanged. Completed
quests continue to reject duplicate completion; existing history is the durable
receipt. A completed response must not be recreated as a second reward celebration.

## Planned capabilities and remaining gates

| Capability | Required work before enabling it |
| --- | --- |
| Landmark clue | Reviewed facts and permissions, authored clue/answer pairs, accessibility alternatives, replay policy |
| Geocaching interaction | Approved and accessible cache sites, owner permission, environmental constraints, maintained cache evidence, lost-cache recovery |
| Photo observation | Private upload handling and EXIF removal, retention/consent, review and appeals, clear limits on automated judgment |
| A route with walking time | Licensed pedestrian graph, barrier/access checking, actual route lengths, accessible alternatives and field timing |
| Native template variety | New immutable publication version, reward/receipt compatibility tests, bounded funded allocation and migration review |
| Location-specific optional prompts | Reviewed place facts that do not change completion requirements or invent missing landmarks |

No full native-template migration, stronger physical attestation, new creator
publication rights or AI evidence approval is implemented by this slice. Real field
access and phone GPS behavior still need physical walking tests. Rendering and
interaction verification belongs to the integrating UI slice.

## Verification

`tests/quest-templates.test.mjs` covers geometry rejection (including holes), catalog
isolation, deterministic variety, no template monetary authority, preservation of
legacy prepared future days and materialized worlds, native golden hashes across
the activation boundary, ordered return progression, cross-player/repeated requests,
GPS timestamp replay and failed final-receipt rollback/retry.

The focused suite additionally runs the existing city, world planner, game economy
and native reward tests. This retains 365-date polygon separation checks, treasury
conservation, exactly-once shared rewards, bounded Aura supply, midnight/DST and
native worker recovery. These are automated server tests, not evidence of physical
presence, safe walking access, perceived game quality or real-device usability.
