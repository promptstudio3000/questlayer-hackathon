# Monster challenges (slices M1 + M2)

Implements `docs/NPC-PLAN.md` §13.2–§13.5 on the shared actor interfaces (§14, `docs/ACTORS-API.md`). A player who
holds an encounter token for a monster (roamer, guardian or lurker) picks one of three challenges. The weekly boss
is a separate shared event (M4). Rewards for a win (XP, shards, guardian chests, roll tickets) belong to M3, which
plugs into the service's `onResult` hook. This slice decides only who won.

## Fairness rule
Power comes only from the account level (`demoProgression(...).level`, from spendable XP, which can't be traded)
and the player's skill. Auras, Aavegotchi items and GOLD are never read and never sent. There is no wagering: a
loss costs one hour of cooldown on that monster and nothing else.

## Formats
Each monster offers the quiz, one mini-game (picked per monster per day) and the duel.

| Format | What the player does | What the server checks |
| --- | --- | --- |
| Quiz | 3 questions, 20 s each; get 2 right | Answers live in `server/data/monster-quiz.json` (Plzeň places, city facts, game lore) plus generated Aura-catalog questions. A question about the place the monster stands at (nearest city-pack place within 300 m) comes first. Only prompts and shuffled choices reach the client. Total time ≤ 65 s. |
| Rhythm | tap on 8 beats; 6 hits win | Taps are matched to the seeded beats within ±160 ms. Taps under 70 ms off all count the same (a bot gets no edge). Mashing costs hits, and taps < 90 ms apart fail. The submit can't arrive before the beats were played. |
| Trace | drag through 5–7 runes in order | Samples in the unit square: every rune hit in order, ≥ 75 % of samples inside the glowing corridor, at most 4.5 units/s finger speed, 1.2–20 s total. |
| Memory | repeat a 6-rune sequence | Exact order, first tap after the show ends, ≥ 140 ms between taps. |
| Duel | 3 rounds of Strike / Guard / Trick plus a timed tap | Strike beats Trick, Trick beats Guard, Guard beats Strike. The monster's three stances are fixed by the seed and committed as `sha256(picks:salt)` at the start, then revealed at the end. Damage = level power (20 + 2 per level, capped at level 20) × tap skill. Tap offsets under 35 ms count as 35 ms. Win by knocking the monster out. |

The monster's published tendency (roamer Strike, guardian Guard, lurker Trick, 50 % of its picks) makes reading it a
skill. Simulated win rates for a player who reads the tendency against a random picker, at level 1 / 10:
roamer 59 % / 94 % vs 14 % / 63 %; guardian 31 % / 80 % vs 3 % / 63 %.

## API
- `GET /api/actors/:id/challenge?encounter=enc_…` → `{status, formats, tendency, level, offers}`
- `POST /api/actors/:id/challenge {encounter, format}` → `{challenge}` (counts as the attempt and starts the 1 h cooldown)
- `POST /api/actors/:id/challenge/:cid/submit {answers | taps | samples}` → `{result, detail, retryAt?}`
- `POST /api/actors/:id/challenge/:cid/round {stance, tapOffsetMs}` → `{duel, result?, detail?}`

Errors: `ACTORS_DISABLED` 503, `COOLDOWN` 429, `ALREADY_DEFEATED` 409, `CHALLENGE_ACTIVE` 409, `CHALLENGE_EXPIRED`
410, `BOSS_EVENT` 400, plus the encounter errors from `requireEncounter`.

Storage: `actor_progress` (attempts, defeats, `cooldown_until` per player, monster and day) and `actor_challenges`
(audit row with the seed, format `quiz`/`minigame`/`duel`, the result). Live round state stays in memory; a restart
ends open challenges, and the attempt still counts.

## Client
`src/MonsterChallenge.tsx` (lazy chunk, kept out of the first load by the bundle budget) exports
`<MonsterChallenge actor encounter onClose onResult? />`. The actors layer opens it for a monster's `challenge` offer.
