# W02 durable system-adventure results

Player problem: a quest can commit successfully while its HTTP reply is lost. Previously its exact reward and Aura identity were available only in the reply, so reload could leave the player with an unexplained balance or item. Repeating a completion also produced an error rather than the original confirmed outcome.

## Implemented server behavior

| Before (source finding) | After | Why / source |
| --- | --- | --- |
| Claim recorded a quest claim, economy changes and name-only history, with no exact result archive. | New claims atomically record the actor, quest, world, arena/GPS realm, title, completion time, exact XP, exact integer demo GOLD and a whitelisted immutable Aura snapshot/ID. | `server/game.mjs`, `server/adventure-results.mjs`: failure writing the result rolls back the entire award, including a final route checkpoint. |
| Duplicate completion rejected an already completed quest. | A canonical result is returned with `replayed:true` and the original scalar reward fields. Existing committed results remain readable/replayable after expiry; a new expired award remains blocked. | Retry recovers the same result without another reward or mint. |
| Historical item names could not establish which inventory row was awarded. | Pre-feature claims have explicit virtual `legacy-unavailable` results and `reward:null`. No name matching, reconstructed item ID, replacement item or invented exact XP/GOLD. | The original economic credit is preserved. |
| A receipt alone could be mistaken for present equipment authority. | Every read separately projects current ownership, equipment, open listing, issued native reservation, minted native claim or missing item. | A transferred item does not disclose its buyer/current owner. Historical artwork and current equipment authority remain separate. |
| An issued voucher could appear expired by wall clock. | It remains reserved until the existing verified restore protocol establishes finalized expiry and absence of a token. | No local expiry shortcut authorizes demo reuse. |
| Repeated equipment intent could toggle an Aura back off. | Optional explicit `desiredEquipped:true` is idempotent; restoring a demo Aura from an active native outfit actually switches to the demo outfit, even if its old slot flag remains set. | Owner, listing and native-reservation checks run before any no-op. |
| Reading an award had no deliberate inspection contract. | Actor-authenticated bounded list/detail helpers never mark viewed. Explicit `markViewed` records the first inspection time once, without changing rewards or equipment. | Reload/background recovery does not consume a result or repeat celebration. |

Module schema: `ADVENTURE_RESULTS_SCHEMA` uses the shared compatibility/version boundary. Its v1 DDL contains only the two owned tables and one index. Exact item IDs intentionally have no inventory foreign key: a historical receipt must survive loss of the current inventory row. The receipt still references the original actor/quest claim and world. No raw GPS evidence, media, consent or native signing authority is stored in a result.

## Integration contract

`createAdventureResults(db)` exposes `list`, `get`, `forQuest`, `latest` and `markViewed`. `list` returns `{results,nextCursor}` with 1–50 results, actor/filter-bound cursors and optional realm/unviewed filtering. `get` throws an actor-safe 404 when unavailable; `forQuest` returns a DTO or null. GET methods never acknowledge a result. Legacy rows are available in the archive, excluded from the new unviewed-result prompt, and may be deliberately acknowledged.

Confirmed DTOs use `domain:"demo"`, `source:"system-quest"`, `reward:{xp,goldU,item}` and `itemCurrent:{status,equippable,equipped,reason,item?}`. Current `equipped` means the demo Aura is actively selected, rather than an inactive demo slot flag retained while a native outfit is displayed. Creator observation completion and native contract receipts use their own namespaces; they do not call this award path.

Parent-owned `server/index.mjs` mounts the actor-authenticated routes and parent-owned result UI consumes the DTO. Source review identified and reported selection A→B→A reopening, online freshness and a delayed-equipment navigation issue for parent integration fixes. Browser observations of that UI are recorded by its owner; this server report does not claim visual/device validation.

## Verification

`node --test tests/adventure-result-presentation.test.mjs tests/adventure-results.test.mjs tests/game.test.mjs tests/city-world.test.mjs tests/quest-templates.test.mjs` — **47/47 passed**. Full output: `focused-tests.txt`. The six presentation tests include owner/realm generation fencing, reconnect freshness, native-to-demo outfit intent and current-item authority checks.

The 11 result tests cover lost-after-commit retry, actual close/reopen, concurrent independent worker connections, expired replay/new expired refusal, receipt-insert rollback, final-checkpoint rollback, exhausted editions/no item, another claimant's shared GOLD, immutable identity after transfer/deletion, current listing/native reservation/mint, native-to-demo outfit restoration, honest legacy detail, actor/realm/cursor isolation, deliberate idempotent acknowledgement and raw-GPS exclusion. The existing duplicate-claim assertions in the game/city/template suites now assert canonical replay instead of the superseded rejection. Failure injection uses temporary SQLite triggers so it does not add unrecognized persistent schema.

The concurrent test exposed a WAL disappearance race in compatibility preflight. The database owner fixed snapshot retry/cleanup; the same cross-connection test then passed. No persistent schema bypass was introduced.

`dev/adventure-results.html` renders the actual result hook and dialog with an injected in-memory fake transport. It includes owned/no-item/legacy/listed/native-outfit states; declared actor/realm/native roundtrips at300/600ms against a1000ms pending detail; an offline/reconnect roundtrip after a fresh detail; and `?text=large` at twice the normal body/secondary/heading text sizes. Late fake reads deliberately ignore abort so the real context fence is exercised. It sends no API, wallet or GPS requests and makes no persistent writes. Equipment callback changes only the synthetic local outfit; it does not claim to test App's equipment navigation behavior. Explicit TypeScript compilation of this dev entry passed. Browser inspection belongs to the parent workstream.

## Boundaries

- Economy policy, reward amounts, tiers, world geometry, native settlement and creator rewards are unchanged.
- Pre-feature exact item/reward details cannot be recovered when they were never recorded. The archive states that limitation.
- Current-item reads are observations; equipment mutations always recheck server authority atomically.
- This evidence uses isolated local SQLite data. It does not exercise real funds, wallets, RPC, physical GPS, Safari/iOS or Chrome/Android hardware.
- No commit, deployment or production database change was performed by this workstream.
