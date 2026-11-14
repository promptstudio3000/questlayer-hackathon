# Hackathon submission kit (the owner submits)

Rules source: https://nearhackathon.com/HACKATHON.md (read again before submitting). One submission per
repository, cannot be edited, accepted 2026-11-01T00:00Z to 2026-11-14T23:59Z. The repository must be public.
Nothing in this file is sent automatically; the owner confirms the exact payload first.

## Demo post on X (the owner publishes, then pastes the link)

Main post (271 characters; attach the demo video itself, not a link):

> Location games earn billions and pay players nothing. Play-to-earn paid players with other players' money.
>
> QuestLayer pays from staking yield: stake NEAR, keep all of it, and the yield lands on real streets as QGOLD.
>
> Built at NEAR HACKATHON @NEARProtocol #NEARHackathon

First reply (what runs on NEAR; attach the diagram of the whole loop):

> What runs on NEAR here:
> - type a name, get an account; a NEP-366 relayer pays gas
> - NPCs talk through NEAR AI Cloud; one merchant has his own wallet and trades via NEAR Intents
> - QGOLD is minted only against realized staking yield
> - a stock Sputnik DAO v2 runs the treasury

Second reply (next step and a question):

> Play it now, no wallet: https://questlayer.promptstudio3000.com
> Code: https://github.com/promptstudio3000/questlayer-hackathon
>
> Question: would you stake 10 NEAR to open harder zones in your city, if you could always take it back?
>
> @NearLegion @NearBuilders

The video is 2:07 and under 512 MB, so it fits an X account without Premium (140 seconds). Every sentence is on
screen as text, because X plays video muted until it is tapped. Keep the post pinned through judging.

## Demo video and judge walkthrough

- Video: "Follow the coin". Its script and how it was made are in [HACKATHON-DEMO.md](HACKATHON-DEMO.md).
- Judge walkthrough: [JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md), which maps the track criteria to "do X, see Y"
  steps and terminal checks of the economy.

## Submission payload (fill in, then the owner runs the curl from HACKATHON.md)

`idea` is the "What did you build?" field: 1,960 characters of the 2,000 allowed.

```json
{
  "requestId": "<uuid v4>",
  "projectName": "QuestLayer",
  "leadName": "<owner name>",
  "email": "<owner email>",
  "size": "1",
  "tracks": [
    "games",
    "social",
    "nfts",
    "open"
  ],
  "nearAddress": "<mainnet payout account, e.g. team.near>",
  "projectUrl": "https://github.com/promptstudio3000/questlayer-hackathon",
  "demoUrl": "https://x.com/<owner>/status/<id>",
  "idea": "QuestLayer is a real-world GPS game whose prize pool is staking yield. Players stake NEAR, keep 100% of the principal, and only the realized yield is paid out on real streets as QGOLD. Free-to-play location games pay players nothing; play-to-earn paid them with other players' deposits. Here rewards can never exceed income that has already arrived.\n\nTry it (no wallet, no install): open questlayer.promptstudio3000.com, type a name, move with the demo pad. Collect coins on real paths in Plzeň, open a daily zone, beat a monster at riddles, wear the Aura you win, talk to an NPC, play a quest another player made. Then open /treasury to see where the money sits.\n\nHow NEAR is used:\n- Invisible accounts: a name creates a sponsored NEAR sub-account. The key stays on the device; a NEP-366 relayer pays gas.\n- QGOLD: a NEP-141 token that is its own vault, minted only against realized staking yield, fully backed by NEAR, no admin withdraw. Spending burns it.\n- Stake to play: keyless staking vaults. A one-time stake of 10 or 50 NEAR opens Tier 2 and Tier 3 zones and can only be withdrawn, never spent.\n- Social money: a stock Sputnik DAO v2 with Trezu role names governs the treasury. Explorers vote weekly on its mix. Voting power is earned by play (active days, level, followers, quests others played), never bought. A 2-of-3 council approves each daily run only if it matches the vote and the hard limits.\n- NPCs: dialogue runs on NEAR AI Cloud in attested enclaves; the server alone decides rewards. A merchant NPC has his own NEAR account and trades Auras through a NEAR Intents verifier.\n- NFTs: Auras are NEP-171 with royalties, visited places mint badges, MetaLayer land is an NFT.\n- Creators: players publish quests, tasks and secrets. Ratings go to NEAR Social; paid quests send 80% to the creator.\n\n16 contracts with reproducible builds, all on testnet. Layers: Test Layer (demo), GotchiGO (real GPS play) and MetaLayer (voxel world, first slice).",
  "consent": true
}
```

Tracks: **games** (the first minute is the game loop; NPCs with wallets, NEAR Intents), **social** (a stock Sputnik
DAO v2 with Trezu's role names decides the treasury mix, [TREASURY-DAO.md](TREASURY-DAO.md)), **nfts** (Auras with
royalties, badges for visited places, MetaLayer land) and **open**.

Checklist before sending: repository public and `main` in sync with the development branch, LICENSE file present,
no secrets in history (run a secret scan), README "do X, see Y" steps verified on a fresh clone, demo post live,
`tracks` reviewed, payout account is a **mainnet** account.
