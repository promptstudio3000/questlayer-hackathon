# QuestLayer: 3-minute demo video

Storyboard, shot list and voice-over for the submission video and the demo post on X. Track: **Games With Real
Economies** ("judged on the game loop, not the token; bonus if players never notice the chain"). The slide deck that
goes with it is linked from [SUBMISSION.md](SUBMISSION.md); the step-by-step guide for judges is
[JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

**When:** the video is recorded only after the phone verification with the owner (planned 6–7 November 2026), so the
phone shots show the build that passed it. Everything is recorded against the live testnet host
**https://questlayer.promptstudio3000.com/**. Nothing in the video has monetary value; the caption "NEAR testnet" is on
screen from 0:20 to the end.

**The story in one line:** you go for a walk, the city gives you something to do, what you win is really yours, and
you never see a wallet. Three acts: **play** (0:00–1:10), **own** (1:10–1:55), **economy** (1:55–2:50), then the end
card.

Last checked on 3 November 2026 against `GET /api/health` (build `b6568f1`, `network: testnet`, `poiWorld.status: ready`
with 197,999 quest-ready places, `autoCities.status: on` with 85 unfunded cities, `distribution.status: verified`,
relayer with 12 confirmed jobs, `yieldBackedDays: true`). Re-check on recording day (see "Recording-day checks").

## Rules for the whole video

- **Real play is GPS only.** There is no tap-to-walk. On the phone, record while actually walking. On desktop, the
  Plzeň city demo moves with the **Demo walk** pad (arrows or WASD run, Shift walks); keep the chip "City demo · arrows or
  WASD" visible in the frame so nobody mistakes it for GPS proof.
- **Say "testnet" once out loud** (shot 7) and keep the caption on screen.
- **Yield honestly:** the yield cycle is proven on testnet, but the amount is tiny (the first realized yield into the
  treasury was about 0.0000036 test NEAR). Never say rewards "are funded by yield" in general; say what the
  **Today's pot** card shows on that day (see shot 10).
- **Mainnet is not live.** Say "testnet today, mainnet after launch checks" if it comes up; never imply mainnet.
- English everywhere: the UI language is English by default (Settings → language stays on English for the recording).
- Lead with the player's problem, show one complete moment, name NEAR's role concretely, end with a next step and a
  question (organizer guidance in HACKATHON.md, "A good demo post").

## Recording kit

| Item | Setting |
| --- | --- |
| Phone A (main) | Real GPS in Plzeň, near Šafaříkovy sady or another of the day's zones; screen recording on, 390-wide UI, notifications off, brightness max |
| Phone B or a camera | Street B-roll: hand holding phone A, feet walking, the zone's real place. Vertical and 16:9 both fine; the edit is 16:9 with the phone screen as a picture-in-picture |
| Desktop (fallback and shots 7, 9, 10) | 1440×900 private window, zoom 100 %. Tabs: the game, `https://testnet.nearblocks.io/`, `/api/health` |
| Explorer for shots 1–7 | A fresh name on phone A (e.g. "Demo Nov 6"); a reused explorer may have opened today's chest already |
| Prepared explorer for shot 9 | An explorer with at least one secured Aura, so the market and Vojtěch's offers are not empty |
| Second location for shot 11 | Brno náměstí Svobody `49.1952, 16.6080` (DevTools → Sensors on desktop), or wherever the owner really is outside Plzeň |
| Audio | Voice-over recorded separately, quiet room; light music under it at −20 dB |

Do not reset the published world or the database for the recording.

## Storyboard and shot list (3:00)

Columns: **Source** says what records the shot (P = phone A screen recording, B = B-roll camera, D = desktop screen
recording). Voice-over is about 380 words, which fits 3:00 at a calm pace.

| # | Time | Source | On screen | Action | Voice-over | Caption |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | B | A street in Plzeň, a hand takes out a phone | none | "Walking games give you nothing you own. Crypto games lose you at the wallet. We wanted neither." | QuestLayer |
| 2 | 0:08–0:20 | P | First-run page, then the map with the ghost | Type the name under "What should we call you?", press **Start exploring** | "QuestLayer starts with a name. No wallet, no seed phrase, no gas. A NEAR account is made for you in the background." | Name only |
| 3 | 0:20–0:35 | P + B | Map in GPS mode, coins on the paths around **YOU**; B-roll of feet walking | Walk over a coin; it disappears, XP ticks; the daily board moves to 1/3 | "Then you just walk. Coins sit on real paths from OpenStreetMap. Each one is backed before it appears, and the first valid claim wins." | NEAR testnet (stays on) |
| 4 | 0:35–0:50 | P | A zone: the 3D totem, the translucent wall, the loot icons and the "Open now" countdown | Walk into the zone; the totem grows as you approach | "Zones open for a while every day. Rarer zones open for a shorter time, and everyone sees the countdown." | Zones open daily |
| 5 | 0:50–1:10 | P | "Brute Lickquidator guards this chest" → **Answer its riddles** → win → **Open chest** → "Reward collected" | Answer three questions, open the chest, hold on the result sheet | "Some chests have a guardian. You beat it with skill: riddles about the place, a rhythm or a duel. Losing costs nothing but time. Then the chest pays exact XP and an Aura." | Skill, never money |
| 6 | 1:10–1:20 | P | Result sheet → map | Press **Try it on**; the ghost wears the Aura | "The Aura is yours to wear right away." | |
| 7 | 1:20–1:40 | P, then D | **Secure this Aura** → secured state; desktop: NearBlocks testnet tab with the player's account and the mint from `nfts.questlayer-dev-20261101.testnet` | Press **Secure this Aura**; on desktop paste the account id from Profile → **Advanced** into NearBlocks | "Securing it mints a real NFT to your own NEAR account. Your phone holds the key and signs; our relayer only pays the gas. This is NEAR testnet, and this is the only place you ever see the chain." | NEP-171 · gas sponsored |
| 8 | 1:40–1:55 | P | Ráda the Pilgrim's dialog: portrait, short speech, action buttons | Tap Ráda, ask "Do you have an errand for me?", accept a two-stop errand | "The city has residents. They give you errands across today's zones. The AI only words the reply; the offer itself comes from the game server." | NPCs |
| 9 | 1:55–2:15 | D (prepared explorer) | Vojtěch the Merchant's sheet with offers, then Inventory → **Market** → **Offers** | Show one of Vojtěch's offers and the signed-offer form; do not complete a trade on camera unless rehearsed | "Vojtěch is an NPC with his own NEAR account. He trades Auras on the player market with signed orders. His prices must leave a margin, and his surplus flows back into the game's treasury." | NPC with a wallet |
| 10 | 2:15–2:35 | D | Explore → **Today's pot** card → **How rewards are funded** → **Books checked**; then `/api/health` with `distribution.status: verified` highlighted | Scroll slowly, highlight the source line | "All rewards come from one global treasury, split each day between coins and zone prizes. The books are checked against the chain all the time. Part of the money comes from staking yield; on testnet that yield is still tiny, but the full cycle runs." | One treasury · books verified |
| 11 | 2:35–2:50 | P (or D with Brno) | Another town: coins, an NPC or monster marker, a place quest card, the "Unverified map" badge if it is an auto city | Tap **Use GPS** (or switch location); open a place quest card | "And it is not one city. Open it anywhere in Czechia: almost two hundred thousand public places, filtered for safety, become quests. Outside our showcase city it pays XP and collectibles, never money." | 198k places in Czechia |
| 12 | 2:50–3:00 | static | End card: logo, URL, repo, "Which city should we map next?" | none | "Real map, real ownership, invisible chain. Try it now. Which city should we map next?" | questlayer.promptstudio3000.com · github.com/promptstudio3000/questlayer-hackathon |

### Shot 10: what to say about yield on the day

Open **Today's pot** and read its source line before recording, then pick one:

| What the card shows | Say |
| --- | --- |
| A Plzeň day labelled as funded **from yield** (the first one, `plzen-2026-11-05-v2`, was scheduled to publish from yield on 3 November at 23:00 UTC) | "Today's prizes were paid from staking yield. On testnet the amount is tiny, but the cycle is real." |
| Sponsor funding only | "Today's prizes come from sponsor funding. Staking yield flows into the same treasury; on testnet it is still tiny." |
| **Practice** | Cut the yield sentence; say "Practice GOLD is play money; funded days show their source here." |

### Phone fallback (desktop-only cut)

If the phone recording fails, record shots 2–6 and 8 on desktop in the Plzeň city demo with the **Demo walk** pad
(hold ↑ or W to walk, Shift to run; the quest buttons only turn you toward the target). Keep the chip "City demo ·
arrows or WASD" in frame and change the voice-over in shot 3 to "On a phone you walk for real; here we use the demo
pad." Shot 1 becomes a still of the map.

### Pickup shots (record extra, use if time allows)

- Night: the map's real local night sky and the night cast of characters (actors appear 07:00–22:00 local time; night
  shows different ones).
- The Aura on the character turning with the map rotation.
- Profile → badges after a place visit; the season card "Hackathon Pennant".
- A reload showing that name, XP and the worn Aura persist.

## Edit and export

- 16:9, 1920×1080, 30 fps, under 3:00 (X accepts longer videos only on some account types; also export a 2:20 cut that
  drops shots 8 and 11 in case the owner's account needs it).
- Phone screen as picture-in-picture on the right two thirds over B-roll, or full height centred on a dark
  background (`#1C1433`).
- Burn in captions (many people watch muted).
- The X post text is in [SUBMISSION.md](SUBMISSION.md).

## Recording-day checks

| Check | Expected |
| --- | --- |
| `GET /api/health` → `network` | `testnet` |
| `GET /api/health` → `relayer.enabled` and `lease.lastError` | `true`, `null` (otherwise use the fallback for shot 7 below) |
| `GET /api/health` → `distribution.status` | `verified` |
| `GET /api/health` → `poiWorld.status` | `ready`; `cellsWithQuests` close to `countryCells` |
| `GET /api/health` → `autoCities` | `on` with a city count (then show the **Unverified map** badge in shot 11), or `off` (then towns play as street cells; skip the badge) |
| `GET /api/health` → `yieldBackedDays` and **Today's pot** | decides the shot 10 line (table above) |
| `GET /api/npc/traders` (with the prepared explorer's cookie; it answers 401 without one) | Vojtěch listed with market credit; a prepared explorer sees at least one offer |
| Rehearsal | One full run 30 minutes before recording, on a different monster than the one you record (one try per hour per monster) |
| Time of day | Not in the last 30 minutes before Prague midnight (Ráda has no errands then); daylight for the B-roll |

## NPC and monster segment (about 90 s, optional cut)

An extra segment for a longer cut, or as its own clip after shot 5. The characters only exist in the Plzeň practice
world (`demo:arena-city-plzen:<day>:v2`), which plans them all day, so it records at any hour. Walk up with the **Demo walk** pad
(there is no tap-to-walk since 3 November; encounters need ≤ 35 m, ≤ 50 m while the character stands at a stop).

Checked on 1 November 2026 (22:37–23:05 UTC, across the Prague day change) against build `9973c7a` (`/api/health` → `source.buildId`, module `actors: 1`,
`npc-trader: 1`): `GET /api/actors?worldId=…` returned **16 actors** (4 NPCs: Běla the Chronicler, Vojtěch the
Merchant, Gate Keeper, Ráda the Pilgrim; 6 roamers, 5 guardians, 1 weekly boss). Lurkers (pocket wisps) are listed only
within 60 m, so they are not part of that count. See "Verification log" below for each step.

| # | Time | Shot | Action | Voice-over |
| --- | --- | --- | --- | --- |
| N1 | 0:00–0:10 | Plzeň map with ghost NPC and Lickquidator markers moving along footpaths | Slow pan; tap **Ráda the Pilgrim** | "The city has residents now. Characters walk real footpaths on a daily schedule." |
| N2 | 0:10–0:25 | NPC sheet: greeting, chat box with "AI voice · answers from game data only" | Type "Do you have an errand for me?" and **Send** | "You can talk to them. The AI only phrases the reply; the offers on the buttons were computed by the server first." |
| N3 | 0:25–0:35 | **Offers** → "Walk: Path chest in …, then Path chest in …" (50 XP + Aura) | Pick a line whose stops are both **Path chest** or **Path discovery** (not "There and back"/"Three-stop trail", which need every checkpoint); "Task accepted" appears under **Your tasks** | "Ráda gives a two-stop errand across today's zones." |
| N4 | 0:35–0:55 | Open the first chest; at the second, "Brute Lickquidator guards this chest" → tap the Brute → **Answer its riddles** | Answer the three questions; the result shows the win, +40 XP, void shards and "The zone chest it guarded is open for you now"; open the chest | "Monsters are beaten with skill, not money: riddles about Plzeň, a rhythm or a stance duel. Losing costs nothing but a cooldown. A guardian keeps its zone chest locked until you win." |
| N5 | 0:55–1:10 | Back at Ráda after both stops | **Turn in for 50 XP + Aura**; notice "+50 XP and <Aura>… Secure it on NEAR from your wardrobe" | "Finishing the errand pays XP and an Aura, which you can secure as an NFT through the same award-signed claim as a chest." |
| N6 | 1:10–1:20 | **Vojtěch the Merchant** sheet | Show his offers (see trading note below) | "Vojtěch trades from his own funded testnet account on the signed-order market. His prices must always leave a margin for the game's treasury." |
| N7 | 1:20–1:30 | NearBlocks tab: `questlayer-npc-games-20261101.testnet`, roll `smoke-mvyei21r` | Show `start_roll` then `resolve_roll`, and the `get_roll` result | "Item games use a commit-reveal roll on NEAR. Tickets are earned, never bought, and anyone can recheck the draw." |

### What works today and what to show instead

- **Talk (N2):** works. `greet` returns the persona's template greeting (in Czech for Ráda and Vojtěch);
  `talk` answered through Ollama (`source: "ollama"`, `attested: false`); a quick second message to the same NPC fell
  back to a standard template reply, so send one message per take. Do not show or claim a "Private AI ·
  verified" badge: NEAR AI Cloud is not connected yet.
- **Quest (N3, N5):** Ráda offers lines only for discoveries that stay open at least 30 more minutes, so **do not record
  in the last 30 minutes before Prague midnight** (23:00 UTC in winter): her menu is empty then and she says she has no
  errands. The quest Aura is a regular chest-catalog Aura (`mintAura`, entitlement rules); the NPC-only "Pilgrim's
  Path" edition arrives on the fifth turned-in line, and Běla's first finished chapter set pays the Chronicle Crown
  (`server/earned-editions.mjs`, once per explorer and edition).
  Five of the six zones have a guardian; if neither chest on the chosen line is guarded, film N4 on any roamer
  instead. Ráda gives at most two lines per explorer per day.
- **NPC-only Auras:** today they are reachable only through the monster hunt (**Wardbreaker Horns**: 10 shards + a
  guardian win + one common Aura, `POST /api/hunt/craft`; **Bossbane Fangring**: 3 hits on the weekly boss once it
  falls) and the trader's **Merchant's Ledger** after 10 settled trades. None of these fits a fresh explorer in one
  take, so the segment claims the quest Aura and only mentions the NPC editions.
- **Monster (N4):** works end to end. Each monster allows one attempt per hour per explorer, so rehearse on a
  different monster than the one you record.
- **Trading (N6):** Vojtěch's books are live (`GET /api/npc/traders`: account
  `npc-kupec-vojtech.questlayer-dev-20261101.testnet`, 2 test NEAR market credit, no stock held, 0 trades). A fresh
  explorer sees **no offers** from him: sells need escrowed stock (none yet), premium buys need a secured Aura of a
  "wanted" edition, and a trade-up needs three secured commons. To film a real trade, use a prepared explorer that has
  secured Auras, or let him restock first (trade-ups give him stock). If his offers fail when accepted, the VPS trader
  key swap is not confirmed yet (owner step in the deploy thread); cut N6 to his greeting plus the public books.
- **Mini-game roll (N7):** the `npc-games` contract is live with table `wisp-v1` (60 % trader voucher, 30 % rare,
  9 % epic, 1 % legendary wisp). The game server does not issue roll tickets or call `start_roll` for players yet,
  and the pocket-wisp roll ticket (`rollTickets` in `GET /api/hunt`) is only counted off-chain. Show the recorded
  roll on chain instead and say it is the operator's proof roll, not a player roll.

### Verification log (live host, 1 November 2026, 22:37–23:05 UTC)

Fresh explorers via `POST /api/session`, world from `POST /api/world` (`demo:arena-city-plzen:2026-11-01:v2`, then `…:2026-11-02:v2` after Prague midnight).

| Step | Call | Result |
| --- | --- | --- |
| Actors | `GET /api/actors?worldId=demo:arena-city-plzen:2026-11-01:v2` | 16 actors, all `state: active`; boss HP 1200/1200, week `2026-W44` |
| Meet Ráda | `POST /api/actors/poutnice-rada/encounter` | 200, `enc_…` token, distance 0 m |
| Greet / talk | `POST …/greet`, `POST …/talk` | 200 template greeting; 200 Ollama reply, menu empty (22:39 UTC, inside the last 30 min of the day) |
| Meet Vojtěch | `POST /api/actors/kupec-vojtech/encounter` + `greet` | 200, menu empty for a fresh explorer |
| Trader books | `GET /api/npc/traders` | policy `npc-trader-v1`, credit 2 NEAR, 0 trades |
| Monster | `POST /api/actors/lickquidator-1/encounter`, `GET …/challenge`, `POST …/challenge {format: quiz}`, `POST …/challenge/:id/submit` | formats quiz/rhythm/duel; quiz won 3/3; rewards `xp: 20`, `shards: storm 1` |
| Hunt pouch | `GET /api/hunt?worldId=…` | storm 1, monster XP 20, craft `wardbreaker` needs shards + guardian + common Aura |
| npc-games roll | RPC view `get_roll {"roll_id":"smoke-mvyei21r"}` on `questlayer-npc-games-20261101.testnet` | `Resolved`, tier 1 `aura-rare`, start height 275811236, finished 275811248; first 8 bytes of `random` mod 100 = 79 → rare band (60–89) |
| Quest offers (new day) | encounter Ráda in `demo:arena-city-plzen:2026-11-02:v2` (23:01 UTC) | 3 lines of 50 XP + Aura; `talk` answered in Czech via Ollama and pointed at the first line |
| Route line | accept `Walk: There and back …, then Three-stop trail …`, `POST /api/quests/claim` | 409 "Confirm the stops in order first": route steps need their checkpoints walked; use a chest line in the video |
| Chest line | accept `Walk: Path chest in Univerzitní park, then Path chest in Chvojkovy lomy` | 200 `accepted` |
| Stop 1 | `POST /api/quests/claim` at the chest | 200 |
| Stop 2 | same | 423 `GUARDED` "Brute Lickquidator guards this chest" |
| Guardian | encounter `lick-brute-4`, quiz won | `xp: 40`, `void` shards 2, `unlocks.zoneId …:zone:3` |
| Stop 2 again | `POST /api/quests/claim` | 200, +80 XP, Aura Dewfall Ring (common) |
| Turn in | `POST /api/actors/poutnice-rada/offers/quest:…/complete` | 200 `completed`, +50 XP, Aura **Ember Wisp** (common, serial 1); Ráda's menu is empty afterwards (2 lines per day) |

To repeat the checks on recording day, replay the calls above with a cookie jar (`curl -c jar -b jar`); arena worlds skip
GPS accuracy checks, so `location: {lat, lng}` at the character's current point is enough.

## Czechia shot (shot 11) details

| Check | Expected |
| --- | --- |
| `GET /api/health` → `poiWorld.status` | `ready` (version `cz-…`); `cellsWithQuests` close to `countryCells` |
| `GET /api/health` → `autoCities` | `on` with a city count, or `off` (then skip the auto city line) |
| `GET /api/health` → `questFlavour.cached` | above 0 means place quests show the nightly flavour titles; at 0 they show rule titles, which is fine |
| Rehearsal in Brno | at least one place quest card and one NPC or monster within the visible map; otherwise pick another spot from `npm run world:coverage` "Checked places" |

Since 3 November a fresh explorer outside Plzeň starts in their own cell with a **Nearest quest** line in the coach
and a **Next quest** pin on the map, so shot 11 can also be recorded by a second person who really is in another town.

## What not to claim

- Not mainnet, not real money. GOLD on the map is practice GOLD unless **Today's pot** shows a funded day.
- Do not say rewards are generally funded by staking yield. The harvest → unlock → flush cycle is proven on testnet
  (`public/native-yield-cycle-proof.json`), but the amounts are tiny (about 0.0000036 test NEAR for the first
  realized yield of generation `20261101b`), and testnet liquid-staking prices are frozen. Use the shot 10 table.
- The city-demo walking pad is not proof of physical presence; browser GPS can be spoofed.
- Mainnet is not live; do not show or name mainnet accounts.
- Outside Plzeň: no funded rewards, no GOLD or NEAR; auto city zones are unverified map data. Do not say "the whole
  world" or "Europe": coverage is Czechia.
- No claim of original Aavegotchi art ownership, NEAR Intents settlement or completed iOS acceptance.
- NPCs: no "private AI" or attestation claim (replies come from Ollama today); no claim that Ráda's quest Aura is an
  NPC-exclusive edition; the npc-games roll on screen is the operator's proof roll, not a player's roll; Vojtěch's
  trades are testnet market orders, not a price guarantee.

## Fallbacks

- If the relayer is slow on shot 7, cut to the recorded proof `public/native-invisible-account-proof.json`
  (name → sponsored sub-account → relayed mint) and label it "recorded on an earlier testnet generation".
- If the chest is already opened for the day, use another zone from **Nearest discovery**.
- If no guardian stands at the chosen chest in shot 5, film the riddles on any roamer and the chest separately.
- If Vojtěch shows no offers in shot 9, show his greeting and the market's **Offers** tab only, and keep the voice-over.

The account list with explorer links and the architecture diagram are in the [README](../README.md#what-is-on-chain-and-where-to-see-it).
The 280-character post and the submission payload are in [SUBMISSION.md](SUBMISSION.md).
