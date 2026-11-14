# QuestLayer: the demo video, "Follow the coin"

The script of the submission video (2:07, 1920×1080) and how it was made. The post that carries it and the
submission texts are in [SUBMISSION.md](SUBMISSION.md); the step-by-step guide for judges is
[JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

**The story in one line:** QuestLayer is a real-world GPS game whose prize pool is staking yield. The video opens on
one coin and the claim that nobody paid for it, then answers where it came from. Each step answers the question the
previous one opened: hook → play → locals → creators → the coin → the bank → layers.

The first minute is only the game, because the track Games With Real Economies is "judged on the game loop, not the
token". The money and the DAO arrive afterwards, as the answer.

## Script

The voice-over is read exactly as written. Times are those of the finished cut.

| Time | Voice-over | On screen |
| --- | --- | --- |
| 0:00 | This coin is backed by real NEAR. Nobody paid for it. Nobody lost anything. | A QGOLD coin, "1 NEAR = 1,000,000,000 QGOLD" |
| 0:05 | Play-to-earn paid players with other players' money. Then it collapsed. | A ring of players paying each other breaks apart |
| 0:08 | QuestLayer pays from staking yield. Follow the coin. | Logo; the coin flies to the chapter rail |
| 0:12 | It is a game first. Type a name and you are in. No wallet, no seed phrase, no gas. A NEAR account appears behind you. | Phone: name, intro, the map of Plzeň |
| 0:19 | Your city is the board. GPS is the controller. Coins lie on real paths, zones open daily on real streets, landmarks become quests. | Walking the map, a coin (+250,000 QGOLD), today's zone, guidance to a chest |
| 0:28 | Monsters guard the corners. Beat them with riddles, rhythm and duels. Never with money. | Lickquidator: the ways to fight, a riddle about the cathedral tower, "You beat it!" |
| 0:33 | Loot is wearable. Secure an Aura, and it is an NFT in your own account. | The chest and the Aura Ember Wisp |
| 0:38 | The locals are alive. They stand at real places and talk through NEAR AI. The model writes the words. The server decides the rewards. | Ráda asks first; the player types a question; the reply arrives |
| 0:46 | Vojtěch the merchant has his own NEAR wallet. He buys your Auras and resells them through NEAR Intents. | Vojtěch's greeting and profile, a card with his account |
| 0:52 | Then players take over. Anyone can publish a quest on their own street. Others play it, and rate it on NEAR Social. | Community quests; the quest "Old town trail" with its photo, rating and discussion |
| 0:59 | Paid quests send eighty percent to the creator. The world writes itself. | The list of creators, a card "80 %" |
| 1:03 | So, the coin. Where does the money come from? | The phone steps aside; the money diagram begins |
| 1:06 | Players stake NEAR in a personal, keyless vault. The principal never moves. It stays theirs. | Explorer, personal vault, validators; an arc "withdraw any time" |
| 1:11 | Only the yield flows out, into one shared treasury. Every day that yield, and nothing else, is scattered across the map. | Yield flows to the treasury and from it to the map |
| 1:18 | That is QGOLD. Minted only against yield that already arrived. Spend it and it burns, so every coin left is backed by more. | The QGOLD node; "spent QGOLD burns" |
| 1:25 | Stake more, go deeper. A savings account, with monsters. | The tiers Free, Staker, Tier 2, Tier 3; the Stake screen |
| 1:29 | And who runs the bank? The players. | The Sputnik DAO lights up next to the treasury |
| 1:31 | The treasury follows a Sputnik DAO. Every week, explorers vote on its mix. Voting power is earned by playing: active days, levels, followers, quests others played. Never bought. | The mix (90 % staked NEAR, 10 % stablecoins), the four parts of voting power, the Vote tab of /treasury |
| 1:43 | A two-of-three council signs each daily run, only if it matches the vote. | Three keys, two light up; the whole loop pulses once |
| 1:47 | That whole machine is one layer. GotchiGO runs it on real streets. MetaLayer runs it in a voxel world. The next layer can be yours. | The machine shrinks into the GotchiGO card; MetaLayer and "Your layer" beside it |
| 1:55 | Live on NEAR testnet today. Sixteen contracts. Every payout, a public transaction. | Three figures and the addresses of the game and the repository |
| 2:01 | QuestLayer. Stake once. Play everywhere. Lose nothing. | Logo and slogan |

## How it was made

- **Footage** is the real app: the Test Layer (the Plzeň demo) on the live testnet host, recorded on 14 November 2026
  at phone size (390×844) with a brand-new explorer, by a scripted browser so every take can be repeated. Walking is
  sped up; everything else plays as a player sees it. The map is dark because the game follows the real day and
  night and the takes were recorded before dawn.
- **Animation** is one HTML and CSS timeline, rendered frame by frame in a headless browser and encoded with ffmpeg.
  The money diagram is drawn for the video; it is the same loop as the diagram in the [README](../README.md).
- **Text on screen** repeats every sentence of the voice-over, so the video works muted.

## What the video does not show

- The footage is the Test Layer. Its coins and zones are paid from a practice pool filled by a sponsor; the loop in
  the diagram, where the map is paid from realized staking yield, is GotchiGO's.
- Vojtěch's scene shows his greeting and his profile. No NEAR Intents trade is on screen.
- The Vote tab on screen is GotchiGO's live tally on /treasury; no vote is cast in the video.
- The Aura on screen has just been found. It becomes an NFT when the player secures it, which the video names but
  does not show.
- Everything is on NEAR testnet and has no monetary value. What else is not claimed is listed at the end of
  [JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md).

The account list with explorer links and the architecture diagram are in the
[README](../README.md#contracts-on-testnet-world--gotchigo).
