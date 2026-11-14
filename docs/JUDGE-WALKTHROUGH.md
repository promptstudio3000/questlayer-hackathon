# Judge walkthrough

A guided tour for the jury and for automated screeners (HACKATHON.md, Q-017). Each step is "do X, see Y", says how
long it takes and what it proves. Tracks: **Games With Real Economies**, **Social Money**, **NFTs That Do
Something** and **Open Innovation**.
Everything runs on NEAR **testnet**; nothing has monetary value. Mainnet is not live (see "Not claimed" at the end).
Paths A, B and C were walked again on the live build on 14 November 2026 with a brand-new explorer; the labels
below are the ones on screen.

Live host: **https://questlayer.promptstudio3000.com/** (planned to stay up through judging, 16–18 November 2026, and ideally to 25 November).
It opens the **Test Layer**, the Plzeň demo; GotchiGO, the real GPS game, is at `/?world=1`.
Repository: https://github.com/promptstudio3000/questlayer-hackathon. Submission texts and the script of the demo
video: [SUBMISSION.md](SUBMISSION.md), [HACKATHON-DEMO.md](HACKATHON-DEMO.md).

## How the track criteria map to the product

| The track asks for | Where to see it in QuestLayer | Step below |
| --- | --- | --- |
| A game loop judged on play, not the token | Walk → coins → zone → chest → Aura → wear → level up; monsters are beaten with skill, never with money | A1–A5 |
| Players never notice the chain | Name-only start; sponsored NEAR sub-account; device key signs; NEP-366 relayer pays gas; the account, its keys and the on-chain feed live in Settings | A1, A6, C3 |
| NPCs with wallets | Vojtěch the merchant trades from his own funded NEAR account with signed market orders and NEAR Intents; his surplus sweeps into the treasury. NPC replies run on NEAR AI Cloud | B2, C4 |
| Player-owned markets | Secured Auras are NEP-171 NFTs in the player's account; signed orders, a NEAR Intents verifier for NFT swaps, 2 % NEP-199 royalty; player tasks and Secrets paid from a QGOLD escrow contract | A6, B3, B6 |
| An economy that evolves without a dev patch | One global treasury whose yield becomes the daily map budget; collected coins mint QGOLD backed by that NEAR, spending burns it; books audited against the chain; new towns join from map data | B4, C1, C2, C7, D |
| Shared budgets on Sputnik DAO and Trezu (track Social Money) | The treasury follows `questlayer-treasury.sputnik-v2.testnet`: explorers at level 3+ vote weekly on the mix from their own accounts, the council (2 of 3, Trezu role names) approves every daily run, and the mix script refuses to run without that approval | B8 |
| Players, not just a token | Tap another explorer for their profile, wave, and send end-to-end encrypted messages stored on NEAR Social; bring your own Aavegotchi with an Ethereum wallet | B5, B7 |

## Path A: the core loop in a browser (about 3 minutes, no install)

The Test Layer is the Plzeň demo. You move with the **demo pad** (drag the stick, or arrows / WASD; it runs by
default, Shift or the **Run** toggle walks). Real play moves only with a phone's GPS (Path D); there is no
tap-to-walk. Test Layer coins and zones pay Test QGOLD from a practice pool filled by a sponsor; QGOLD paid from
realized staking yield is GotchiGO's.

| # | Do | See | Proves |
| --- | --- | --- | --- |
| A1 | Open the live host. Type a name under "What should we call you?", press **Start exploring**, then **Let's explore**. Answer Pip's tour offer with **Start the tour** or **Not now** | The Plzeň map with your ghost labelled YOU and the banner "Welcome to náměstí Republiky". The top bar marks the layer ("Test Layer" on desktop, a TEST tag on a phone). No wallet, extension or seed phrase was asked for | Name-only onboarding |
| A2 | Move with the pad: ↑ (or W) forward, ←/→ to turn. Walk over a gold coin on a path; **Point me there** on the coach card turns you towards the nearest find | A toast "+2 XP · +250,000 QGOLD", then "1 coin: 250,000 QGOLD and 2 XP confirmed". The coin is gone for every player, so late in the day the nearest one can be a few hundred metres away | Server-authoritative pickups on real OpenStreetMap paths; the first find creates the explorer's NEAR account in the background |
| A3 | Tap the zone banner (**náměstí Republiky**) or open **Explore** and filter **Zones** | A sheet with the zone's activities for today (Path stop, Round trip, Path chest), the XP of each and the QGOLD still to win there | Daily zones on real streets |
| A4 | Pick **Path chest**, follow "Guiding you to Path chest", then press **Open Path chest** and **Open chest** | "Nice find!" with an Aura (for example Ember Wisp, Common) and +80 XP. **Try it on** puts it on your ghost: "Equipped. Your new glow is on the map." | A chest for every explorer; the reward is cosmetic |
| A5 | Walk up to a monster on the map (for example **Lickquidator**, "Roaming monster"), tap it, pick **Riddles** and press **Start challenge**. Rune path, rhythm and duel are the other formats; the choice changes by day | Three questions about the place and the game, 20 seconds each. Win: "You beat it!" with XP and a shard. Lose: "It got away this time", and nothing is taken from you | Skill, not money, decides fights |
| A6 | **Inventory → Wardrobe → Advanced → Secure this Aura**. If the card still says "Being secured" after a minute, press **Check claim** | "Your Aura is secured." and one more secured item in the list. **Settings → Account** shows your account under **NEAR wallet**; **Settings → Advanced → On-chain feed** lists "Explorer account created" and "Aura secured as NFT" with links to https://testnet.nearblocks.io/ | NEP-171 NFT in the player's own account, gas sponsored, no wallet popup |
| A7 | Reload the page | Name, XP, Aura and equipment are still there | Persistent explorer |

Each explorer has their own chest, so it does not matter who came before you. If you already opened it today, pick
another zone from **Explore → Zones**.

## Path B: characters and the market (about 3 minutes)

The characters stand and walk at real places in Plzeň and are labelled on the map with their role: Ráda (Quest
giver), Vojtěch (Trader), Běla (Storyteller), Gate Keeper (Keeper).

| # | Do | See |
| --- | --- | --- |
| B1 | Walk to **Ráda** and tap her | A dialog with three tabs. **Talk**: she asks you a question (**Answer · +30 XP**), and you can type your own and press **Send**. **Tasks**: the walks she offers. **Profile**: her story and the places she knows. Offers and rewards are computed by the server; the language model on NEAR AI Cloud only words the reply |
| B2 | Walk to **Vojtěch** | The same three tabs; **Tasks** is what he sells for QGOLD and **Profile** says "Travelling Merchant". His own account is `npc-kupec-vojtech.questlayer-dev-20261101.testnet` (C4) |
| B3 | **Inventory → Shop → Market**, then **More trading tools** | Auras other explorers sell, priced in QGOLD; below it the secured-Aura market marked "TEST NETWORK" and "NEAR Intents (test)" |
| B4 | Open https://questlayer.promptstudio3000.com/treasury | What is held on chain right now (treasury, prize pool, QGOLD vault), the yield per day, what 1B QGOLD is backed by and the treasury mix; the tabs **Vote**, **Money flow**, **QGOLD**, **Model** and **Safety** go deeper |
| B5 | Tap another explorer on the map (bots wander the demo, tagged "bot") | The player card: level, XP, finds, what they wear, **Message** and **Wave**. Bots carry a **demo-bot** label; **Message** on a bot opens a short demo chat, nothing is stored |
| B6 | **Community → Tasks**, or **Explore** filtered to **Community** | Player tasks (take a photo, answer a question, deliver something) with their QGOLD reward and places left, and Secrets hidden in the fog; **Post a task** creates one. Rewards are held in the QGOLD escrow contract |
| B7 | With a second browser or phone and a second explorer: tap each other on the map and press **Message** (within 1 km you can write right away; farther apart, **Ask to message** and accept) | "End-to-end encrypted. Only you and the other explorer can read a message." The message is stored as ciphertext under the sender's NEAR Social account ([PLAYER-INBOX.md](PLAYER-INBOX.md)) |
| B8 | Open **/treasury** and the **Vote** tab | "Weekly treasury vote": the mix in force (staked / stables / reserve), today's run, the explorer voters, the council (3 keys, 2 approve a run), recent decisions and the DAO account `questlayer-treasury.sputnik-v2.testnet` with Trezu's role names. Explorers at level 3+ vote from inside GotchiGO; a vote lands as `act_proposal` from the explorer's own account on https://testnet.nearblocks.io/address/questlayer-treasury.sputnik-v2.testnet |
| B9 | Optional, with an Ethereum wallet that holds Aavegotchis: **Settings → Advanced → Ethereum wallets → Link MetaMask or Rabby** | The wallet signs a readable message only; **Inventory → Wardrobe → Original Aavegotchi look** then lets the explorer wear a gotchi you own |

## Path C: verify the economy yourself (about 5 minutes, terminal)

All reads are public; no key is needed.

| # | Run | Expect |
| --- | --- | --- |
| C1 | `curl -s https://questlayer.promptstudio3000.com/api/health` | `"network":"testnet"`, `distribution.status: "verified"`, `qgoldVault` (status, rate, supply, backing), `marketEscrow`, `chainLedger.days` (confirmed day roots with transactions), `relayer.sponsorship` (500 operations a day), `poiWorld`, `autoCities` |
| C2 | `curl -s https://questlayer.promptstudio3000.com/api/native/distribution` | `status: "verified"` with named checks: ledger conservation (funded = accounted for), every reserved coin and prize explained by an open day, contract `questlayer-rewards-20261101b.testnet` |
| C3 | Open `public/native-invisible-account-proof.json` in the repository | Name → sponsored sub-account → relayed mint, with transaction hashes (recorded on an earlier testnet generation, so account names differ) |
| C4 | Open https://testnet.nearblocks.io/address/npc-kupec-vojtech.questlayer-dev-20261101.testnet | The trader's own account and its market transactions |
| C5 | Open `public/native-yield-cycle-proof.json` | Staking vaults harvested yield, unstaked and flushed it into the rewards treasury; funding grew by exactly what the vaults paid, split 50/50 into coin and zone buckets |
| C6 | `get_roll` on the item-games contract (command below) | A resolved commit-reveal roll anyone can recompute |
| C7 | Open `public/native-yield-day-proof.json` | Reward day `plzen-2026-11-05-v2`, paid entirely from realized staking yield |

```bash
curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,
  "method":"query","params":{"request_type":"call_function","finality":"final",
  "account_id":"questlayer-npc-games-20261101.testnet","method_name":"get_roll",
  "args_base64":"eyJyb2xsX2lkIjoic21va2UtbXZ5ZWkyMXIifQ=="}}'
# args_base64 is {"roll_id":"smoke-mvyei21r"}; decode result.result (bytes) as UTF-8 JSON
```

The full account list with NearBlocks links is in the [README](../README.md#contracts-on-testnet-world--gotchigo).

## Path D: real GPS play on a phone (optional)

On a phone in Czechia, Slovakia or Austria open **https://questlayer.promptstudio3000.com/?world=1** (GotchiGO) and
allow location. The map moves to where you stand: street coins, the NPC and monster cast at named places, and place
quests at real public places, with a **Nearest quest** line in the coach and a **Next quest** pin. Places away from
the reviewed cities come from map data nobody has walked and carry an **Unverified map** notice; the reward rules
are in [MAP-REWARDS.md](MAP-REWARDS.md). In the Test Layer the same switch is **Settings → Map → Use GPS**. On
desktop, set a location first (Chromium DevTools → Sensors → Location, e.g. Brno `49.1952, 16.6080`).

## Path E: run and test it locally (about 10 minutes)

Requirements: Node.js 24, npm. No wallet, no keys.

```bash
npm ci
npm run dev       # http://127.0.0.1:5173/ ; the API listens on 127.0.0.1:8787
npm run check     # build, bundle budget, application tests, mainnet-guard tests
bash scripts/build-contracts.sh --test   # contract tests (Rust, wasm32 target)
```

Locally there is no country import and no relayer, so outside Plzeň you get street cells and **Secure this Aura**
needs the setup in [HOW-TO-TRY.md](HOW-TO-TRY.md). Contract WASM hashes are pinned in `contracts/wasm-sha256.json` and
checked in CI.

## Not claimed

- **Mainnet is not live.** Contracts and a dry run are prepared ([MAINNET-PLAN.md](MAINNET-PLAN.md)); mainnet goes
  live only after phone testing and the owner's go.
- **Yield is real but tiny.** One reward day was paid fully from yield and the cycle runs on testnet, but realized
  yield was 0.000014 test NEAR on 10 November, and testnet liquid-staking prices are frozen. Most prize money is
  sponsor funding; `/treasury` shows the figures.
- **Nightly QGOLD payouts** are live in the contract and worker, but no payout day with real claims had run on
  10 November.
- **NPC AI** runs on NEAR AI Cloud with an Ollama fallback; offers and rewards never come from the model.
- **The first-alpha game contract** (`game.questlayer-dev-20261101.testnet`) was retired on 10 November; the live
  game never called it.
- **Inbox metadata is public.** Only the text is private; sender, time, size and a hashed recipient are on chain.
- **GPS can be spoofed.** A travel guard, XP caps per cell and day, and rate limits limit the damage; the demo
  pad is labelled as a demo.
- **Coverage is Czechia, Slovakia and Austria**, plus demo cities elsewhere. The Intents verifier is our own
  experimental testnet deployment, not `intents.near`. No app-store release.
