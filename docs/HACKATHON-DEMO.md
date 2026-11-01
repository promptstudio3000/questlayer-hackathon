# QuestLayer: 3-minute demo video

Script and shot list for the submission video. Everything is recorded against the live testnet host
**https://questlayer.promptstudio3000.com/** with a fresh explorer (private window, no wallet). Nothing in the video
has monetary value; say "testnet" on screen at least once.

Checked on 1 November 2026 against `GET /api/health` (`network: testnet`, features `collectibles, market, rewards,
vaults, relayer, social, creators, tasks`, relayer `relay-20261101.questlayer-dev-20261101.testnet`,
`distribution.status: verified`) and the manifests in `public/native-*-testnet.json`. Re-check both on recording day.

## Before recording

- Desktop browser at 1440×900 (or a phone mirrored at 390×844), private window, sound off, zoom 100 %.
- Open a second tab at `https://testnet.nearblocks.io/` for shot 7 and a third at `/api/health`.
- Pick a fresh name (e.g. "Demo Nov 3"); a reused explorer may have already opened today's chest.
- Record in Plzeň city-demo mode: tapping the map moves the explorer. Label it as city demo, not GPS proof.
- Do not reset the published world or the database for the recording.

## Script and shot list

| # | Time | Shot (what is on screen) | Action | Voice-over |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:15 | Title card, then the first-run page | Type the name under "What should we call you?" | "QuestLayer turns a walk into a small adventure on the real map. To start, you only type a name." |
| 2 | 0:15–0:30 | Plzeň map, ghost explorer in the centre | Press **Start exploring**; slow pan of the map | "No wallet, no seed phrase, no gas prompt. A NEAR account for this player is being created in the background." |
| 3 | 0:30–0:50 | Close-up of a gold coin on a path | Tap next to the coin; coin disappears, XP ticks | "Coins sit on real OpenStreetMap paths. Each one is backed before it is published, and the first valid claim wins." |
| 4 | 0:50–1:20 | **Nearest discovery** card → zone chest | **Walk there** until in range, then **Open chest** | "Six zones a day in Plzeň hold a chest. Opening it pays exact XP and an Aura." Hold on the "Reward collected" sheet. |
| 5 | 1:20–1:35 | Result sheet → map character | Press **Try it on** | "The Aura is worn by your character right away." |
| 6 | 1:35–2:00 | Secure and share panel | **Secure this Aura**, then **Share your Aura** | "Securing mints it as a NEP-171 NFT to the player's own account. The device key signs, our relayer only pays gas. Sharing makes a PNG card." |
| 7 | 2:00–2:25 | Profile → **Advanced**, then NearBlocks tab | Copy the NEAR account id, paste into NearBlocks testnet; show the mint from `nfts.questlayer-dev-20261101.testnet` | "This is the only place the chain is named. Here is the account and the NFT on testnet." |
| 8 | 2:25–2:45 | **Today's pot** card → "How rewards are funded", then `/api/health` tab | Scroll to "Books checked"; highlight `distribution.status: verified` | "Rewards come from a treasury contract with separate coin and zone buckets, and the books are checked live against the chain." |
| 9 | 2:45–3:00 | Architecture diagram from the README, then the URL | Static | "Real map, real ownership, invisible chain. Try it now at questlayer.promptstudio3000.com. Repo link below." |

Optional cut-ins if time allows (replace part of shot 8): Profile → **Market** showing a listed Aura in escrow at
`questlayer-market-20261101b.testnet`; reload the page to show that name, XP and the worn Aura persist.

## NPC and monster segment (about 90 s, optional cut)

An extra segment for a longer cut, or as its own clip after shot 5. The characters only exist in the Plzeň practice
world (`demo:arena-city-plzen:<day>:v2`), which plans them all day, so it records at any hour. Tap-to-move still
applies: walk up by tapping next to the marker (encounters need ≤ 35 m, ≤ 50 m while the character stands at a stop).

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
  errands. The quest Aura is a regular chest-catalog Aura (`mintAura`, entitlement rules), not the NPC-only "Pilgrim's
  Path" edition: no server path grants `pilgrim`, `chronicle` or `wisp` yet. Say "an Aura", not "an NPC-exclusive Aura".
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

## What not to claim

- Not mainnet, not real money. GOLD on the map is practice GOLD unless **Today's pot** shows a funded day.
- Do not say rewards are already funded by staking yield; the vault (`questlayer-vault-20261101b.testnet`) is live
  but a full yield cycle is still being proven ([STATUS.md](STATUS.md)).
- City-demo tap-to-move is not proof of physical presence; browser GPS can be spoofed.
- No claim of original Aavegotchi art ownership, NEAR Intents settlement or completed iOS acceptance.
- NPCs: no "private AI" or attestation claim (replies come from Ollama today); no claim that Ráda's quest Aura is an
  NPC-exclusive edition; the npc-games roll on screen is the operator's proof roll, not a player's roll; Vojtěch's
  trades are testnet market orders, not a price guarantee.

## Fallbacks

- If the relayer is slow on shot 6, cut to the recorded proof `public/native-invisible-account-proof.json`
  (name → sponsored sub-account → relayed mint) and label it "recorded on an earlier testnet generation".
- If the chest is already opened for the day, use another zone from **Nearest discovery**.

The account list with explorer links and the architecture diagram are in the [README](../README.md#what-is-on-chain-and-where-to-see-it).
The 280-character post and the submission payload are in [SUBMISSION.md](SUBMISSION.md).
