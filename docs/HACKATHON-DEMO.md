# QuestLayer: the demo video, "Follow the coin"

The script of the submission video (2:15, 1920×1080) and how it was made. The post that carries it and the
submission texts are in [SUBMISSION.md](SUBMISSION.md); the step-by-step guide for judges is
[JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

**The story in one line:** QuestLayer is a stake-to-play game platform: a real-world GPS game whose prize pool is
staking yield. The video opens on one coin and the claim that nobody paid for it, then answers where it came from.
Each step answers the question the previous one opened: hook → play → locals → creators → the coin → the bank →
layers.

The first minute is only the game, because the track Games With Real Economies is "judged on the game loop, not the
token". The money and the DAO arrive afterwards, as the answer. The video stays on the loop and the gameplay; counts
of contracts, addresses and proofs are in the [README](../README.md) and the walkthrough.

**Pace.** One or two shots per sentence, and every shot and caption stays on screen for at least two seconds. The
voice leaves a pause after each sentence.

## Script

The voice-over is read exactly as written. Times are those of the finished cut.

| Time | Voice-over | On screen |
| --- | --- | --- |
| 0:00 | This coin is backed by real NEAR. Nobody paid for it. Nobody's stake was spent. | A QGOLD coin, "1 NEAR = 1,000,000,000 QGOLD" |
| 0:07 | QuestLayer pays its players from staking yield. Follow the coin. | Logo; the coin flies to the chapter rail |
| 0:12 | It is a game first. Type a name and you are in. No wallet, no seed phrase, no gas. | Phone: the name field, then the map of Plzeň |
| 0:18 | Your city is the board. GPS is the controller. Coins lie on real paths. | Walking the map, a coin: "+2 XP · +250,000 QGOLD" |
| 0:25 | Zones open every day on real streets. Inside: quests, chests and monsters. | Today's zone and its quests, guidance to a chest |
| 0:31 | Loot is wearable. Secure an Aura, and it becomes an NFT in your own account. | The chest opens: the Aura Ember Wisp |
| 0:37 | Monsters guard the corners. Beat them with riddles, rhythm and duels. Never with money. | Lickquidator, the three ways to fight, "You beat it!" |
| 0:44 | The locals are alive. They stand at real places and talk through NEAR AI. | Ráda asks first; the player's question; her reply |
| 0:51 | Vojtěch the merchant has his own NEAR wallet. He buys your Auras and resells them through NEAR Intents. | Vojtěch's greeting and profile, a card with his account |
| 0:58 | Then players take over. Anyone can publish a quest on their own street. Others play it and rate it. | Community quests; "Old town trail" with its photo, rating and discussion |
| 1:05 | Paid quests send eighty percent to the creator. | A creator's earnings, a card "80 %" |
| 1:10 | So, the coin. Where does the money come from? | The phone steps aside; the money diagram begins |
| 1:13 | Players stake NEAR, right in their profile. It goes into a personal, keyless vault, and the principal stays theirs. | Phone: Profile › Stake. Diagram: explorer, personal vault, validators, "withdraw any time" |
| 1:21 | Only the yield flows out, into one shared treasury. Every day, it is scattered across the map. | Yield flows to the treasury and from it to the map; a coin lands in the phone |
| 1:28 | That is QGOLD: minted only against real yield. Spend it, and it burns. | The QGOLD node; "spent QGOLD burns" |
| 1:34 | Why stake? Stakers open the deeper zones. Tier 2 from ten NEAR, Tier 3 from fifty: bigger prizes, rarer chests. | Phone: a locked Tier 3 zone ("Stake 50B QGOLD in one go to enter"), then the Stake screen. Panel: Tier 1 free, Tier 2 stake 10 NEAR, Tier 3 stake 50 NEAR |
| 1:44 | And who runs the bank? The players. | The Sputnik DAO lights up next to the treasury |
| 1:47 | The treasury follows a Sputnik DAO. Every week, explorers vote on its mix. Voting power is earned by playing, never bought. | The mix (90 % staked NEAR, 10 % stablecoins), the four parts of voting power, the council's three keys, the Vote tab of /treasury |
| 1:59 | That whole machine is one layer. GotchiGO runs it on real streets, MetaLayer in a voxel world. The next layer can be yours. | The machine shrinks into the GotchiGO card; MetaLayer and "Your layer" beside it |
| 2:09 | QuestLayer. The stake-to-play game platform. | Logo, "Stake-to-play game platform" and the address of the game |

## How it was made

- **Footage** is the real app: the Test Layer (the Plzeň demo) on the live testnet host, recorded on 14 November 2026
  at phone size (390×844) with a brand-new explorer, by a scripted browser so every take can be repeated. Walking is
  a little faster than real time; the moment a coin pays is slowed down so the amount can be read. The map is dark
  because the game follows the real day and night and the takes were recorded before dawn; the locked Tier 3 zone
  is a still taken in the afternoon, so its map is bright.
- **Animation** is one HTML and CSS timeline, rendered frame by frame in a headless browser and encoded with ffmpeg.
  The money diagram is drawn for the video; it is the same loop as the diagram in the [README](../README.md).
- **Text on screen** repeats every sentence of the voice-over, so the video works muted.

## What the video does not show

- The footage is the Test Layer. Its coins and zones are paid from a practice pool filled by a sponsor; the loop in
  the diagram, where the map is paid from realized staking yield, is GotchiGO's.
- Vojtěch's scene shows his greeting and his profile. No NEAR Intents trade is on screen.
- The Vote tab on screen is GotchiGO's live tally on /treasury; no vote is cast in the video.
- In this testnet pilot Tier 2 zones are still open to every explorer; only Tier 3 zones are locked behind a stake.
- The locked Tier 3 zone and the Stake screen are shown; no stake is made in the video. The Stake screen states the
  one-time vault setup that is not returned (see the limits in the [README](../README.md#how-near-is-used)).
- The Aura on screen has just been found. It becomes an NFT when the player secures it, which the video names but
  does not show.
- Everything is on NEAR testnet and has no monetary value. What else is not claimed is listed at the end of
  [JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

The account list with explorer links and the architecture diagram are in the
[README](../README.md#contracts-on-testnet-world--gotchigo).
