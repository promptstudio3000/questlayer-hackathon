# GOLD spending (QGOLD stream 4)

Design source: Claude Doc "QGOLD: návrh ekonomiky" (approved 4 Nov 2026) and
`QGOLD-BUILD-PLAN.md`, stream 4. Testnet only.

Every spend **burns** GOLD. Nothing goes to another player or to the treasury, and
nothing creates money or changes odds. In the QGOLD model the backing stays in the
vault, so every burn raises the backing rate R for all holders.

## Realms

- **QGOLD (default whenever the QGOLD vault manifest exists).** Every spend burns
  the player's own QGOLD on chain first:
  1. The spend endpoint answers `402 QGOLD_BURN` with `details: {kind, amountU}`.
  2. `POST /api/gold/burn/prepare {kind, amountU}` returns the exact call:
     `ft_burn({amount, memo})` with 1 yocto on the QGOLD token, memo
     `questlayer:burn:<kind>:<16 hex>`, signed by the player's latest linked
     NEAR account. The relayer sponsors exactly this call
     (`server/relayer/policy.mjs`), so the explorer account needs no popup.
  3. `POST /api/gold/burn/confirm {txHash}` reads the final transaction from
     RPC and checks the signer (a linked account), the receiver (the token),
     success and the nep141 `ft_burn` event with the game memo. It stores one
     credit in `qgold_burn_credits` (module `qgold-burns`); a hash counts once.
  4. The client (`src/qgold-burn.ts`) runs the same spend again. `burnGold()`
     takes one unused credit of the same kind and amount inside the spend's
     transaction and writes `gold_burns` with `realm='qgold'` and the burn's
     memo. `players.gold_u` is not touched.

  If the spend still fails after the burn (sold out, lure blocked), the credit
  stays unused and pays the next spend of the same kind and amount. The shop and
  lure quote show the QGOLD balance of the linked account (`balanceU`, 6 decimals).
  An external wallet that does not report the transaction hash cannot confirm a
  burn; the explorer account always can.
- **Practice (local testing only).** With no QGOLD vault, or
  `GOLD_SPEND_REALM=practice`, `burnGold()` takes the amount out of
  `players.gold_u` as before.

Public totals: `GET /api/gold/burns`.

## What GOLD buys

Prices live in `server/data/gold-spend.json` and are QGOLD (set 5 Nov 2026,
`gold-spend-v2`). They are sized to what play earns on testnet: a map coin is
worth about 0.0004 QGOLD (the day's coin budget split over every coin in
Czechia) and a cell-zone prize a few hundredths. So a premium emote
(0.025–0.075) is about one good walk, a frame (0.1–0.3) a few days, NPC gear
0.75 (rare) or 2 (epic), a lure 0.01–0.06, a shout 0.005 and a topic 0.01 a day.

| Spend | Rule |
| --- | --- |
| Emotes above the character | 6 basic emotes are free for everyone. 10 premium emotes are unlocked once. An emote shows to nearby players for 30 s (presence carries it). |
| Cosmetics | Marker frames, unlocked once, one worn at a time. Visible to nearby players. |
| Trader premium gear | At a trader (encounter token required). Burn first, then a chest-edition Aura (`polar`, `bloom`, `storm`, `moon`, `comet`) from the shared supply lands in the wardrobe; it is secured as an NFT through the ordinary `redeem_aura` claim. One a day. |
| Golden Altar fee | 0.025 QGOLD per offering, 0.05 for epic recipes (`GOLD_ALTAR_FEE=0` turns it off). |
| Lure | See below. |
| Place messages | See below. |

## Lures

For 30 minutes an actor that is **already on today's map** dwells at the public
place where the player stands, or a cosmetic beacon marks the spot as a meeting
point. The actor service applies the lure as a segment override
(`registerSegmentOverride` in `server/actors/service.mjs`); its rewards and odds
do not change and the first player to win takes it under the usual rules.

- kinds: monster (roamer, lurker), trader, beacon;
- one active lure per player, 200 m apart, the actor within 2 km;
- only at a safe public place: the nearest `safety='ok'` POI from the POI database,
  or one of today's zones or quests, within 75 m (the lure snaps to it);
- only 07:00–22:00 local time;
- GPS only (a fresh fix, accuracy ≤ 35 m). `GOLD_LURE_DEMO=1` lets the demo walk set
  lures on testnet for testing; it is ignored on mainnet;
- players within 1 km see the pillar and the countdown (`GET /api/gold/map`).

## Place messages

- **Shout:** up to 140 characters (emoji welcome), paid per day, at most 7 days from
  its start, no replies.
- **Topic:** a title, an opening message and a discussion. The founder pays the first
  days; anyone can pay to keep it alive. Writing is free from level 2. When more than
  five different players have written in it (6 distinct authors, the founder
  included) it stays **free for good**, and it is archived only after 90 days with
  no post and no read.
- Text filter: no links, phone numbers, e-mails, markup, credential requests or
  private addresses. Three different reports hide a message. GOLD is not returned
  for a removed message.
- Feed `GET /api/places`: radius 1, 3 or 10 km, sorted latest, following, popular or
  recommended (popular, close and fresh, lifted for followed authors). Blocked
  players never show.
- **NEAR Social:** the author can keep a message or a post as a public record under
  their own SocialDB namespace (`<account>/questlayer/places/<id>`, schema
  `questlayer.place/1`). The record carries a geohash-7 cell, never the exact GPS,
  and the burn memo that paid for it. Signed by the player's own account (relayed for
  the invisible account), confirmed by reading the chain back.

## UI

- Inventory → **Shop** tab: balance, emotes, frames, lures, the gear list.
- Map toolbar → **Emotes** button: quick picker of owned emotes.
- Trader sheet: premium gear buttons.
- Community → **Places** tab: compose, feed, topic view with replies.
- Map: emote bubbles and frames on explorers, lure pillars with countdowns, shout
  bubbles and topic pins (tap opens the message).
