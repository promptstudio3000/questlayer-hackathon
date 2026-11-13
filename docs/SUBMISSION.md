# Hackathon submission kit (draft, owner submits)

Rules source: https://nearhackathon.com/HACKATHON.md (read again before submitting). One submission per
repository, cannot be edited, accepted 2026-11-01T00:00Z to 2026-11-14T23:59Z. The repository must be public.
Nothing in this file is sent automatically; the owner confirms the exact payload first.

## Demo post on X (owner publishes, then pastes the link)

Draft (≤ 280 characters, attach the demo video):

> Built at NEAR HACKATHON: QuestLayer, a walk-and-discover game on the real map of Czechia. Type a name, do
> quests at real places near you, wear your Aura. NEAR account, rewards and NFTs run in the background: no
> wallet popups. @NEARProtocol #NEARHackathon github.com/promptstudio3000/questlayer-hackathon

Optional tags: @NearLegion @NearBuilders. End with a question, e.g. "Which city should we map next?"

## Demo video, pitch deck and judge walkthrough

- Video: the 3-minute storyboard with shot list, voice-over, recording kit and fallbacks is
  [HACKATHON-DEMO.md](HACKATHON-DEMO.md). It is recorded after the phone verification (planned 6–7 November 2026).
- Pitch deck (15 slides, track "Games With Real Economies", updated 10 November 2026):
  https://claude.ai/artifact/VPSfVp6AF1vTfGqmi4bDrs (private until the owner shares it; export as PDF or PPTX from the
  deck's Share menu). Outline: problem, product, the world, the game loop, other explorers (player dialog, encrypted
  inbox, own Aavegotchi), invisible chain, NPCs with wallets, player-owned markets, the economy (treasury yield and
  backed QGOLD), the honest state, on chain, safe and fair, what comes next, try it.
- Judge walkthrough: [JUDGE-WALKTHROUGH.md](JUDGE-WALKTHROUGH.md), which maps the track criteria to "do X, see Y"
  steps and terminal checks of the economy.

## Submission payload (fill in, then the owner runs the curl from HACKATHON.md)

```json
{
  "requestId": "<uuid v4>",
  "projectName": "QuestLayer",
  "leadName": "<owner name>",
  "email": "<owner email>",
  "size": "1",
  "tracks": ["games", "social", "open"],
  "nearAddress": "<mainnet payout account, e.g. team.near>",
  "projectUrl": "https://github.com/promptstudio3000/questlayer-hackathon",
  "demoUrl": "https://x.com/<owner>/status/<id>",
  "idea": "QuestLayer is a location-based exploration game on real OpenStreetMap geography across Czechia: about 198,000 safety-filtered public places become daily quests in every street cell, with NPCs, monsters and street coins, while Plzeň is the reviewed city with funded reward days. Players start with a name only; the server creates a sponsored NEAR sub-account per player and relays NEP-366 meta-transactions, so rewards (NEP-171 Auras, XP, level entitlements) and the fixed-price Aura market settle on NEAR testnet without wallet popups, seed phrases or gas prompts. The economy is backed before publication (coins and zone prizes reserved from funded buckets, 50/50 allocation, first valid claim wins, exactly-once settlement) and documented in one readable rules page.",
  "consent": true
}
```

Track `social` (Social Money, 11 Nov 2026, Lubos): the treasury decides on a stock Sputnik DAO v2 with Trezu's role
names; explorers vote weekly on the mix from their own accounts, the council approves every run
([TREASURY-DAO.md](TREASURY-DAO.md)).

Checklist before sending: repository public, LICENSE file present, no secrets in history (run a secret scan),
README "do X, see Y" steps verified on a fresh clone, demo post live, `tracks` reviewed, payout account verified.
