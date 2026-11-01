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

## What not to claim

- Not mainnet, not real money. GOLD on the map is practice GOLD unless **Today's pot** shows a funded day.
- Do not say rewards are already funded by staking yield; the vault (`questlayer-vault-20261101b.testnet`) is live
  but a full yield cycle is still being proven ([STATUS.md](STATUS.md)).
- City-demo tap-to-move is not proof of physical presence; browser GPS can be spoofed.
- No claim of original Aavegotchi art ownership, NEAR Intents settlement or completed iOS acceptance.

## Fallbacks

- If the relayer is slow on shot 6, cut to the recorded proof `public/native-invisible-account-proof.json`
  (name → sponsored sub-account → relayed mint) and label it "recorded on an earlier testnet generation".
- If the chest is already opened for the day, use another zone from **Nearest discovery**.

The account list with explorer links and the architecture diagram are in the [README](../README.md#what-is-on-chain-and-where-to-see-it).
The 280-character post and the submission payload are in [SUBMISSION.md](SUBMISSION.md).
