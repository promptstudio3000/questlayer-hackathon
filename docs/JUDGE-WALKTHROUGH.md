# Judge walkthrough

A guided tour for the jury and for automated screeners (HACKATHON.md, Q-017). Each step is "do X, see Y", says how
long it takes and what it proves. Track: **Games With Real Economies** (also submitted to Open Innovation).
Everything runs on NEAR **testnet**; nothing has monetary value. Mainnet is not live (see "Not claimed" at the end).

Live host: **https://questlayer.promptstudio3000.com/** (planned to stay up through judging, 16–18 November 2026, and ideally to 25 November).
Repository: https://github.com/promptstudio3000/questlayer-hackathon. Pitch deck and video storyboard:
[SUBMISSION.md](SUBMISSION.md), [HACKATHON-DEMO.md](HACKATHON-DEMO.md).

## How the track criteria map to the product

| The track asks for | Where to see it in QuestLayer | Step below |
| --- | --- | --- |
| A game loop judged on play, not the token | Walk → coins → zone with a guardian → chest → Aura → wear → level up; skill decides fights, money never does | A1–A5 |
| Players never notice the chain | Name-only start; sponsored NEAR sub-account; device key signs; NEP-366 relayer pays gas; the chain is named only in Profile → Advanced | A1, A6, C3 |
| NPCs with wallets | Vojtěch the Merchant trades from his own funded NEAR account with signed market orders; his surplus sweeps into the treasury | B2, C4 |
| Player-owned markets | Secured Auras are NEP-171 NFTs in the player's account; fixed-price escrow and signed orders on the market contract | A6, B3 |
| An economy that evolves without a dev patch | One global treasury, a daily budget split by player demand, prizes backed before they appear, books audited against the chain; new towns join from map data | C1, C2, D |

## Path A: the core loop in a browser (about 3 minutes, no install)

Desktop shows the Plzeň **city demo**: you move with the **Demo walk** pad (arrows or WASD run, Shift walks). Real play
moves only with a phone's GPS (Path D); there is no tap-to-walk.

| # | Do | See | Proves |
| --- | --- | --- | --- |
| A1 | Open the live host. Type a name under "What should we call you?", press **Start exploring** | The Plzeň map with your ghost in the centre and the chip "City demo · arrows or WASD". No wallet, extension or seed phrase was asked for | Name-only onboarding |
| A2 | Hold ↑ (or W) to walk, ←/→ to turn, Shift to run. Walk over a gold coin on a path | The coin disappears, XP ticks, the daily board in the top bar counts the coin | Server-authoritative pickups on real OpenStreetMap paths |
| A3 | Open **Show discoveries** → **Nearest discovery**, press **Turn toward it**, walk there | A zone with a 3D totem, a translucent wall and a countdown; inside, **Open chest** | Daily zones; rarer zones open for a shorter window |
| A4 | If "… guards this chest" appears, tap the monster and pick **Answer its riddles** (or rhythm, or duel) | Win: XP and shards, the chest unlocks. Lose: a one-hour cooldown, nothing else | Skill, not money, decides fights |
| A5 | **Open chest** | "Reward collected" with the exact XP and an Aura; press **Try it on** and the ghost wears it | Backed prize, cosmetic reward |
| A6 | **Secure this Aura**, then Profile → **Advanced** | The Aura shows as secured; Advanced shows your account `<name>.play-20261101.questlayer-dev-20261101.testnet`. Paste it into https://testnet.nearblocks.io/ to see the mint from `nfts.questlayer-dev-20261101.testnet` | NEP-171 NFT in the player's own account, gas sponsored, no popup |
| A7 | Reload the page | Name, XP, Aura and equipment are still there | Persistent explorer |

If a chest is already opened for the day, pick another zone from **Nearest discovery**.

## Path B: characters and the market (about 3 minutes)

The characters walk real footpaths in Plzeň on a daily schedule (07:00–22:00 local time; the practice world plans them
all day).

| # | Do | See |
| --- | --- | --- |
| B1 | Walk to **Ráda the Pilgrim** and tap her; type "Do you have an errand for me?" | A short dialog with her portrait, action buttons and a reply. The offers on the buttons are computed by the server; the language model only words the reply |
| B2 | Walk to **Vojtěch the Merchant** | His offers when he holds stock or wants an Aura you secured; a brand-new explorer may see none. His account is `npc-kupec-vojtech.questlayer-dev-20261101.testnet` |
| B3 | Inventory → **Market** → **Offers** | The secured-Aura market marked "Test network": list an Aura at an exact price in test NEAR for a set time, buy, cancel |
| B4 | Explore → **Today's pot** → **How rewards are funded** | The coins and zone prizes left today, where the money came from, and a **Books checked** chip |

## Path C: verify the economy yourself (about 5 minutes, terminal)

All reads are public; no key is needed.

| # | Run | Expect |
| --- | --- | --- |
| C1 | `curl -s https://questlayer.promptstudio3000.com/api/health` | `"network":"testnet"`, the feature list, `distribution.status: "verified"`, `poiWorld` (290,817 places, 197,999 quest-ready on 3 November), `autoCities`, `relayer.jobs.confirmed`, `yieldBackedDays` |
| C2 | `curl -s https://questlayer.promptstudio3000.com/api/native/distribution` | `status: "verified"` with named checks: ledger conservation (funded = accounted for), every reserved coin and prize explained by an open day, contract `questlayer-rewards-20261101b.testnet` |
| C3 | Open `public/native-invisible-account-proof.json` in the repository | Name → sponsored sub-account → relayed mint, with transaction hashes (recorded on an earlier testnet generation, so account names differ) |
| C4 | Open https://testnet.nearblocks.io/address/npc-kupec-vojtech.questlayer-dev-20261101.testnet | The trader's own account and its market transactions |
| C5 | Open `public/native-yield-cycle-proof.json` | Staking vaults harvested yield, unstaked and flushed it into the rewards treasury; funding grew by exactly what the vaults paid, split 50/50 into coin and zone buckets |
| C6 | `get_roll` on the item-games contract (command below) | A resolved commit-reveal roll anyone can recompute |

```bash
curl -s https://rpc.testnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,
  "method":"query","params":{"request_type":"call_function","finality":"final",
  "account_id":"questlayer-npc-games-20261101.testnet","method_name":"get_roll",
  "args_base64":"eyJyb2xsX2lkIjoic21va2UtbXZ5ZWkyMXIifQ=="}}'
# args_base64 is {"roll_id":"smoke-mvyei21r"}; decode result.result (bytes) as UTF-8 JSON
```

The full account list with NearBlocks links is in the [README](../README.md#what-is-on-chain-and-where-to-see-it).

## Path D: anywhere in Czechia on a phone (optional)

On a phone in Czechia, open the host and press **Use GPS** (top bar). The map moves to where you stand: street coins,
the generic NPC and monster cast, and up to six place quests a day at real public places, with a **Nearest quest**
line in the coach and a **Next quest** pin. Towns with at least 15,000 people get daily zones marked **Unverified map**.
Outside Plzeň everything pays XP and cosmetics only, never GOLD or NEAR. On desktop, set a location first (Chromium
DevTools → Sensors → Location, e.g. Brno `49.1952, 16.6080`).

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
- **Yield is real but tiny.** The full yield cycle runs on testnet; the first realized yield into the current treasury
  was about 0.0000036 test NEAR, and testnet liquid-staking prices are frozen. Most of today's prize money is
  sponsor funding. **Today's pot** shows the source for each day.
- **NPC AI is not attested.** Replies come from a private model; offers and rewards never come from the model.
- **GPS can be spoofed.** A travel guard, XP caps per cell and day, and rate limits limit the damage; the city-demo
  pad is labelled as a demo.
- **Coverage is Czechia only.** No NEAR Intents settlement and no app-store release.
