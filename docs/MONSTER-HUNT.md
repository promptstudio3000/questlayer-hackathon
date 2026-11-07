# Monster hunt: rewards, guardian chests, lurkers and the weekly boss

Slices M3 and M4 of `docs/NPC-PLAN.md` §13, built on the actor interfaces (§14, `docs/ACTORS-API.md`) and the
challenges in `docs/MONSTER-CHALLENGES.md`. Everything is behind `ACTORS_ENABLED=1` (testnet only).

| Piece | Where | Rule |
| --- | --- | --- |
| Win rewards | `server/actors/hunt/rewards.mjs` (`onChallengeResult`, wired as the challenge `onResult` hook) | Once per monster per day: XP (roamer 20, guardian 40, lurker 25), element shards (1, 2, 1; at most 12 a day), a roll ticket for lurker wins. Rows in `monster_rewards` keyed by (player, source, kind), so replays pay nothing. No GOLD. |
| Crafting | `POST /api/hunt/craft {worldId, itemId?}` | 10 shards + one common Aura (not equipped, never listed, never claimed) + at least one guardian win → **Wardbreaker Horns** (supply-capped, claims use `earned:monster:`). One craft a day. The offered common goes to the `monster-hunt-altar` system account (Golden Altar), so edition supply stays honest. |
| Guardian chests | `server/actors/spawns.mjs` (placement), `server/actors/hunt/guardians.mjs`, checked in `/api/quests/claim` | Only zones with a chest quest get a guardian, and it stands on the path point nearest that chest (at most 40 m away). While it is on duty, the chest answers 423 `GUARDED` until you beat that guardian today. The win result names the chest (`unlocks: {zoneId, questId}`, only while you have not opened it) and its **Open the chest** button points the map at it. Off duty (or actors off) the chest is open, so it is never stuck. Already opened chests replay as before. |
| Lurkers | `server/actors/spawns.mjs` (`finds` option, filled from today's street finds in `service.mjs`) | Each lurker hides within 40 m of a seeded street find (still ≥ 150 m from other monsters). Without finds they fall back to seeded path points. |
| Weekly boss | `server/actors/hunt/boss.mjs`, `lick-boss` in `server/data/actors/plzen.json` | One per city per ISO week at náměstí Republiky, out 08:00–20:00 (practice worlds all day). Shared HP (`BOSS_HP`, default 1200). A hit is a seeded mini-game replayed by the server; damage = level power (capped at level 20) × score share. One hit per player per 10 minutes. At zero HP every landed hitter gets 60 XP and a roll ticket; 3+ landed hits also get a **Bossbane Fangring** while supply lasts. The leaderboard counts hits, never money. |
| Arena | ActorView `arena` (decorator in `hunt/index.mjs`), drawn by `src/actors-layer.ts` | The Great Portal (Gotchiverse model from PR #55) stands under the boss. |
| Client | `src/BossFight.tsx`, reward line in `src/MonsterChallenge.tsx` | Strike flow, HP bar, hunters-by-hits board, hunt pouch with the craft button. |

Routes: `GET /api/hunt?worldId=` (pouch + boss), `GET /api/hunt/boss?worldId=` (event page), `POST /api/actors/:id/boss
{encounter}` (start a hit), `POST /api/actors/:id/boss/:hitId {taps | samples}` (resolve it).

Schema module `monster-hunt` v1: `monster_rewards`, `monster_boss_events`, `monster_boss_hits`.

Roll tickets are only counted for now; the `npc-games` slice (§7) redeems them.
