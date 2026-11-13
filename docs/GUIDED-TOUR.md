# Guided tour (helper Pip)

12 November 2026, asked by the owner: a playable demo that walks an explorer step by step through every
quest type, encounter and zone in Plzeň, then through using what they earned, so that every kind of
transaction happens once. It runs in the Test Layer (docs/TEST-LAYER.md); until that is live the testnet
World service turns it on with `TOUR_ENABLED=1`. Mainnet never runs it.

## What the explorer sees

Pip, a small lantern spirit, sits in a card in the top-right corner of the map (below the zone chip on
phones). It offers the tour once; after **Start the tour** each card shows:

1. what just happened (for a few seconds after a step is done),
2. the one thing to do next,
3. where it is: an arrow relative to where the explorer faces and the distance, for coins, finds and quests,
4. **Show me** (starts the map navigation or opens the right screen or dialog) and **Skip**. The stake step marks the Gate Keeper on the map (his Vault tab holds the stake form); with no keeper out nearby it opens the Game economy dialog directly.

The card folds to Pip's head with a step counter and can be closed. While the tour runs, the first-steps
coach steps aside. While the map tools menu is open, Pip shrinks to his lantern on the left so the menu and Pip never overlap; menus from the top bar (map settings, world picker) hide Pip until they close. At the end the card lists every transaction of the run with a link to the explorer.

## Steps (`server/tour/tour.mjs`)

| Chapter | Steps | Done when (the game's own records) |
| --- | --- | --- |
| Start, náměstí Republiky | coin, street find, place visit, zone chest, wear the Aura | ledger `coin`/`find`/`quest`/`chest` actions (or the history feed), an equipped Aura or `equip_aura`. Securing has no step: the client secures every Aura on its own |
| Characters | Ráda's errand, a trail (route quest; World has no clue quests) | ledger `errand`, a `quest_claims` row of a `route` quest |
| Monsters | beat a Lickquidator; beat a Pocket Wisp (hidden at a sparkle) for a roll ticket; roll it (Inventory › Roll at the wisp, in the open above the catalog) | ledger `monster`/`boss`, `monster_rewards` kind `roll`, `start_roll` |
| Trade | sell an Aura, trade with Vojtěch through Intents, buy an emote | a listing or `nft_transfer_call` to the market, a call on the Intents verifier, a QGOLD burn |
| Community | map note, shout, topic, task with a reward | a note, `shout`/`topic` burns, a posted task (QGOLD escrow) |
| People | wave at Ondra, send Ondra a message (Show me opens the chat with him) | a wave, an inbox `set` on NEAR Social |
| Stake | walk to the Gate Keeper and stake; Show me opens the treasury vote right in the game (no NPC to walk to) | `create_position`/`deposit_and_stake`; `act_proposal` or the `vote` mark the client posts when the dialog opens (`action: "seen"`), because voting needs level 3 |

Nothing is ticked by the client: `GET /api/tour` computes every step from the database on each read, so the
tour can never claim a transaction that did not happen. `POST /api/tour {action}` only starts, skips a step,
hides, restarts, or notes that a look-only step was seen (`seen`, only for `vote`). A skipped step never blocks a later one. Settings → "Pip, your guide" hides and shows the helper (`hide` / `show`), also before the tour began: that row has `started_at` 0 and does not count as started. State: table `tour_progress` (module
`guided-tour`).

## Show me

Show me never opens a character's dialog from afar. For a character (Ráda, the Lickquidator, Vojtěch, the Gate Keeper) it marks them on the map and pans there; the explorer walks up and taps them. Coins, finds and place quests start map navigation. Screens that need no walk (Inventory, Market, Shop, the wisp roll, the treasury vote dialog) and map actions at the explorer's own spot open directly.

## A run starts at step one

Every check counts only what the explorer did after `started_at`, the start of the current run. `start`
keeps a running tour; `restart` (the Again button, and once on every page load while the tour runs)
sets `started_at` to now and clears the marks, so Pip is back at 1/21. A finished or hidden tour is left alone.

## The card

- `current` carries `number` (position in the tour), `near` (the line shown within 15 m of the target) and
  `needs` (the QGOLD price of the step); a shortfall reads "You need N more QGOLD. Grab coins, or skip this one."
- Step copy never names the chain: no NEAR, NFT, Intents, escrow or burn (a test guards it).
- Coins and finds inside a zone above the explorer's tier are never the target, and the locked-zone dialog
  stays closed while the tour runs.
- On phones Show me folds the card to the avatar with an arrow and the distance. Outside the map
  (Inventory, Shop, Market) Pip is a one-line strip above the tab bar.
- The game's own "Nearest discovery" card and any older map target are cleared while the tour runs.
- The client re-reads the tour as soon as XP, QGOLD or the inventory changes, so a step ticks at once.
- The finished card keeps the transaction list: plain names, time, a link each, "confirming" while pending.

## Guarantees

Every step has to work for every explorer, so the Test Layer removes the waits that could stop one:

- **Wave.** Ondra, the companion bot that walks near the active explorer (server/test-seed), can be
  waved at. He waves straight back (`sendWave` stores both waves; the reply shows on his card).
- **Message.** Ondra answers chat from fixed lines and stores no text; the tour notes only that the
  chat happened (`tour_marks`), so the message step ticks. Real explorers' messages stay on the
  encrypted NEAR inbox.
- **Monster.** A lost fight can be tried again after 2 minutes in the Test Layer (1 hour in World,
  `ATTEMPT_COOLDOWN_MS`).
- **Sell.** The trader bot Marek buys an Aura a real explorer lists within about 45 seconds.
- **Chest.** Auras are uncapped, so a chest always has one to give.

## Still to build

- An end-to-end run of the whole tour on a phone viewport.
