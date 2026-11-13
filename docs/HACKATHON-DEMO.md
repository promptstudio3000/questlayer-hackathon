# QuestLayer: 3-minute demo video

Storyboard, shot list and voice-over for the submission video and the demo post on X. Track: **Games With Real
Economies** ("judged on the game loop, not the token; bonus if players never notice the chain"). The slide deck that
goes with it is linked from [SUBMISSION.md](SUBMISSION.md); the step-by-step guide for judges is
[JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

**When:** after the owner's iPhone pass of the release test plan, so the phone shots show the build that passed it.
Everything is recorded against the live testnet host **https://questlayer.promptstudio3000.com/**. Nothing in the
video has monetary value; the caption "NEAR testnet" is on screen from 0:18 to the end.

**The story in one line:** you go for a walk, the city gives you something to do, what you win is really yours, you
meet other people, and you never see a wallet. Three acts: **play** (0:00–1:05), **own and meet** (1:05–2:00),
**economy** (2:00–2:50), then the end card.

Rewritten on 10 November 2026 for the current testnet. Checked against `GET /api/health` (build `e37aa07`,
`network: testnet`, `distribution.status: verified`, relayer `relay-20261101.questlayer-dev-20261101.testnet` with
111 confirmed jobs and a limit of 500 sponsored operations a day, `qgoldVault.status: ok`, `marketEscrow` on
`questlayer-qgold-escrow-20261109.testnet`, `chainLedger` day roots confirmed for 7–9 November, `autoCities: on` with
85 unfunded cities), the public `/treasury` page, and a fresh explorer at 390 px. That build already serves the
encrypted inbox (PR #247) and the retired game contract (PR #249). The owned-Aavegotchi sign-in (PR #250) went live
in release `20261110T013541Z` later that night, so shot 9 can be filmed. The fuller player profile (PR #252, phase 1)
was not merged yet; shot 9 uses only the explorer on the map and Inventory → **Your Aavegotchis**. Re-check on recording day (see "Recording-day checks").

## Rules for the whole video

- **Real play is GPS only.** There is no tap-to-walk. Record the play shots on a phone while actually walking in
  Plzeň: GPS play is where coins carry backed QGOLD. The city demo (Demo walk pad: arrows or WASD, it runs by default,
  Shift walks) gives **XP only**, so never say a demo-pad coin is worth money.
- **Say "testnet" once out loud** (shot 7) and keep the caption on screen.
- **Yield honestly.** One reward day (5 November) was paid entirely from staking yield, and the full cycle is proven,
  but the amounts are tiny: the `/treasury` page showed 0.000014 test NEAR of realized yield on 10 November. Testnet
  liquid-staking prices are frozen. Say "the cycle is real, the testnet amounts are tiny".
- **Mainnet is not live.** Say "testnet today, mainnet after launch checks" if it comes up.
- **Demo bots are labelled.** The test world's bots carry a **demo-bot** label and cannot receive messages; the inbox
  shot needs two real explorers.
- English everywhere (the default UI language).
- Lead with the player's problem, show one complete moment, name NEAR's role concretely, end with a next step and a
  question (organizer guidance in HACKATHON.md, "A good demo post").

## Recording kit

| Item | Setting |
| --- | --- |
| Phone A (main) | Owner's iPhone, real GPS in Plzeň near one of the day's zones (Šafaříkovy sady, Lobezský park, Univerzitní park…); screen recording on, notifications off, brightness max |
| Phone B | A second explorer for the inbox shot (shot 8): a second phone or a helper, with its own explorer account created that day |
| Camera | Street B-roll: hand holding phone A, feet walking, the zone's real place. The edit is 16:9 with the phone screen as picture-in-picture |
| Desktop (shots 7, 10, 11) | 1440×900 private window, zoom 100 %. Tabs: the game, `/treasury`, the Ledger page, `https://testnet.nearblocks.io/` |
| Explorer on phone A | A fresh name (e.g. "Demo Nov 12"); a reused explorer may have opened today's chest already |
| Ethereum wallet | The owner's MetaMask or Rabby with his Aavegotchis, for shot 9 |
| Second location for shot 12 | Brno or wherever the owner really is outside Plzeň; on desktop, DevTools → Sensors, Brno `49.1952, 16.6080` |
| Audio | Voice-over recorded separately; light music under it at −20 dB |

Before recording: on phones A and B, both explorers **wave at each other** from the player dialog (or A uses **Ask to
message** and B **Accept**s). The inbox opens only after a mutual wave within one hour or an accepted request. Do
not reset the published world or the database.

## Storyboard and shot list (3:00)

Columns: **Source** says what records the shot (P = phone A screen recording, P2 = phone B, B = B-roll camera,
D = desktop screen recording). The voice-over is about 400 words, which fits 3:00 at a calm pace.

| # | Time | Source | On screen | Action | Voice-over | Caption |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | B | A street in Plzeň, a hand takes out a phone | none | "Walking games give you nothing you own. Crypto games lose you at the wallet. We wanted neither." | QuestLayer |
| 2 | 0:08–0:18 | P | "What should we call you?", then the guide "Your city has stories." | Type the name, **Start exploring**, then **Let's explore** | "QuestLayer starts with a name. No wallet, no seed phrase, no gas. A NEAR account is made for you in the background." | Name only |
| 3 | 0:18–0:32 | P + B | GPS map, coins on the paths around **YOU**, the objective button "Open Street find · 60 m away"; B-roll of feet | Walk over a coin; the GOLD counter rises, the daily board moves to 1/3 | "Then you walk. Coins sit on real paths from OpenStreetMap, and each one carries its share of the day's budget in NEAR." | NEAR testnet (stays on) |
| 4 | 0:32–0:45 | P | A zone: 3D totem, translucent wall, loot icons, countdown | Walk in; the totem grows as you approach | "Zones open for a while every day. Rarer ones open for less time, and everyone sees the countdown." | Zones open daily |
| 5 | 0:45–1:05 | P | Guardian → **Answer its riddles** → win → **Open chest** → "Reward collected" | Answer three questions, open the chest | "Some chests have a guardian. You beat it with skill, never money. Losing only costs time. The chest pays exact XP and an Aura." | Skill, never money |
| 6 | 1:05–1:13 | P | Result → map | **Try it on**; the ghost wears the Aura | "It's yours to wear right away." | |
| 7 | 1:13–1:30 | P, then D | **Secure this Aura** → secured, with its proof link; desktop: the mint on NearBlocks testnet | Press **Secure this Aura**; on desktop open the proof link | "Securing it mints a real NFT to your own NEAR account. Your phone holds the key; our relayer only pays the gas. This is NEAR testnet." | NEP-171 · gas sponsored |
| 8 | 1:30–1:48 | P + P2 | Tap phone B's explorer on the map → player dialog (level, XP, badges, what they wear) → **Write a message** → it arrives on phone B | Type "Chest at the park is open, coming?", send; cut to phone B showing it | "Other explorers are on the map too. Tap one, see what they wear, and write. Messages are encrypted on the phone and stored on NEAR. Nobody else can read them, not even us." | End-to-end encrypted, stored on NEAR |
| 9 | 1:48–2:00 | P | Settings (gear) → **Advanced** → **Ethereum wallets** → sign; the explorer turns into the owner's Aavegotchi; Inventory → **Your Aavegotchis** | Sign the readable message in MetaMask or Rabby | "Already in the Aavegotchi world? Sign in with your Ethereum wallet and your own gotchi walks the map. Nothing is sent on Ethereum." | Bring your gotchi |
| 10 | 2:00–2:15 | P or D | An NPC dialog (Ráda or Vojtěch the Merchant): portrait, short reply, offers | Ask "Do you have an errand for me?"; show Vojtěch's offers | "Characters live here too. Vojtěch trades from his own NEAR account, and his prices must leave a margin for the game's treasury. Replies come from NEAR AI; offers come from the game server." | NPCs with wallets |
| 11 | 2:15–2:37 | D | `/treasury`: treasury, QGOLD backing and rate R, yield realized, "How the money moves"; then the Ledger page | Scroll slowly; hover the flow boxes | "Fees and sponsors fill one treasury. Only its yield is spent: each morning it becomes the map's coins. A coin you collect becomes QGOLD backed by that NEAR, and spending it burns it, so the backing rises. Every trade and reward has a proof on chain. On testnet the yield is tiny, but the cycle is real." | One treasury · backed QGOLD |
| 12 | 2:37–2:50 | P (or D in Brno) | Another town: coins, a character, a place quest | **Use GPS**; open a place quest | "And it is not one city. Almost two hundred thousand public places across Czechia, filtered for safety, become quests." | 198k places in Czechia |
| 13 | 2:50–3:00 | static | End card: logo, URL, repo, "Which city should we map next?" | none | "Real map, real ownership, invisible chain. Try it now. Which city should we map next?" | questlayer.promptstudio3000.com · github.com/promptstudio3000/questlayer-hackathon |

### Phone fallback (desktop-only cut)

If the phone recording fails, record shots 2–6 and 10 on desktop in the Plzeň city demo with the **Demo walk** pad
(hold ↑ or W; it runs by default, Shift walks). Keep the "City demo" chip in frame and change the shot 3 line to
"On a phone you walk for real and coins carry NEAR; here we use the demo pad, which earns XP only." Shot 8 then needs
two desktop browsers (two private windows with two explorers); shot 1 becomes a still of the map.

### If something is not ready on the day

| Not ready | Instead |
| --- | --- |
| No **Your Aavegotchis** row after Ethereum sign-in (wallet read failed or gotchis not claimed) | Cut shot 9 and give its 12 seconds to shot 11 |
| Inbox send stays on "Sent. Waiting for NEAR to confirm." | Keep the shot; the caption still holds. If it fails, show the player dialog and the wave only |
| No guardian at the chosen chest | Film the riddles on any roamer and the chest separately |
| Vojtěch shows no offers | Show his greeting and the Market's **Offers** tab |
| Relayer slow on shot 7 | Cut to `public/native-invisible-account-proof.json` labelled "recorded on an earlier testnet generation" |

### Pickup shots (record extra, use if time allows)

- Night: the map's real local night sky and the night cast of characters (actors appear 07:00–22:00 local time).
- A Secret or task in Explore → **Nearby**, funded in QGOLD escrow.
- Profile → badges after a place visit; the season card.
- A reload showing that name, XP and the worn Aura persist.

## Edit and export

- 16:9, 1920×1080, 30 fps, under 3:00. Also export a 2:20 cut without shots 9 and 12 in case the owner's X account
  limits video length.
- Phone screens as picture-in-picture over B-roll, or full height centred on a dark background (`#1C1433`).
- Burn in captions (many people watch muted). The X post text is in [SUBMISSION.md](SUBMISSION.md).

## Recording-day checks

| Check | Expected |
| --- | --- |
| `GET /api/health` → `network` | `testnet` |
| `GET /api/health` → `relayer` | `enabled: true`, `lease.lastError: null`, `sponsorship.operations` well below `limitOperations` (500) |
| `GET /api/health` → `distribution.status`, `qgoldVault.status` | `verified`, `ok` |
| `GET /api/health` → `chainLedger.days` | yesterday's day `confirmed` |
| `GET /api/inbox/summary` with phone A's cookie | 200 (401 without a session); the conversation with phone B is open |
| `/treasury` | loads with live numbers; note the "Yield realized" figure for the voice-over |
| Shot 9 rehearsal | Ethereum sign-in dresses the explorer in the highest-BRS gotchi and Inventory → Items lists **Your Aavegotchis** (PR #250, live since release `20261110T013541Z`); if PR #252 is merged by then, the profile panel can replace the Inventory row |
| Rehearsal | One full run 30 minutes before, on a different monster than the one you record (one try per hour per monster) |
| Time of day | Daylight, between 07:00 and 22:00 Prague time (characters and most place quests are out), not in the last 30 minutes before midnight |

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

## Czechia shot (shot 12) details

| Check | Expected |
| --- | --- |
| `GET /api/health` → `poiWorld.status` | `ready` (version `cz-…`); `cellsWithQuests` close to `countryCells` |
| `GET /api/health` → `autoCities` | `on` with a city count, or `off` (then skip the auto city line) |
| `GET /api/health` → `questFlavour.cached` | above 0 means place quests show the nightly flavour titles; at 0 they show rule titles, which is fine |
| Rehearsal in Brno | at least one place quest card and one NPC or monster within the visible map; otherwise pick another spot from `npm run world:coverage` "Checked places" |

Since 3 November a fresh explorer outside Plzeň starts in their own cell with a **Nearest quest** line in the coach
and a **Next quest** pin on the map, so shot 11 can also be recorded by a second person who really is in another town.

## What not to claim

- Not mainnet, not real money: test NEAR and testnet QGOLD have no monetary value. Demo-pad play earns XP only.
- Do not say rewards are generally funded by staking yield. One day (5 November) was paid fully from yield and the
  cycle is proven (`public/native-yield-day-proof.json`, `public/native-yield-cycle-proof.json`), but the amounts are
  tiny and testnet liquid-staking prices are frozen.
- Do not say nightly QGOLD payouts have run at scale: the contract and worker are live, but no payout day with real
  claims had run on 10 November.
- The city-demo walking pad is not proof of physical presence; browser GPS can be spoofed.
- Mainnet is not live; do not show or name mainnet accounts. The Intents verifier on screen is our own experimental
  testnet deployment, not `intents.near`.
- Outside Plzeň: auto city zones are unverified map data. Do not say "the whole world" or "Europe": coverage is
  Czechia.
- Aavegotchi: the player brings their own gotchi from their wallet; no claim of owning Aavegotchi art, and no claim
  that QuestLayer lends or rents wearables.
- NPCs: replies come from NEAR AI Cloud with an Ollama fallback; the model never decides offers or rewards. No claim
  that Ráda's quest Aura is an NPC-exclusive edition. Vojtěch's trades are testnet orders, not a price guarantee.
- Inbox: say "nobody else can read the text"; the sender, time, size and a hashed recipient are visible on chain.

## Fallbacks

The "If something is not ready on the day" table above covers the recorded shots. If the chest is already opened
for the day, pick another zone from Map tools → **Nearby discoveries**.

The account list with explorer links and the architecture diagram are in the [README](../README.md#what-is-on-chain-and-where-to-see-it).
The 280-character post and the submission payload are in [SUBMISSION.md](SUBMISSION.md).
