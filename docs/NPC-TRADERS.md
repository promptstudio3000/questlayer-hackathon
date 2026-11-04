# NPC traders and the vault keeper (N3)

Implements slice N3 of `docs/NPC-PLAN.md` (§2.2, §2.3, §6, §11.3). **Testnet only.**

Since 4 Nov 2026 the traders trade on the game's **NEAR Intents verifier** (docs/NEAR-INTENTS-MARKET.md), the
same market players use. The trader's stock (Auras) and purse (wNEAR) sit in the verifier. A buy or sale settles
as two opposite `token_diff` intents in one `execute_intents`: the player signs their side with the device key, and
the server signs the trader's side with the trader's verifier key. The trader's intent is never published, so
nobody but the player at the counter can take the deal. Like every trade, the buyer's wNEAR leg pays the
verifier fee (2 %), which goes to the treasury (docs/NEAR-INTENTS-MARKET.md, "Trade fee to the treasury").

## What players get

| Offer | What happens | Who signs / pays |
| --- | --- | --- |
| `trade_buy` (premium buy) | Accepting reserves a buy of one exact token of a "wanted" edition the player owns (10 min). In the NPC sheet one tap deposits the Aura into the verifier (relayed `nft_transfer_call`), signs a sell `token_diff`, settles, and takes the NEAR straight back to the player's account (`native_withdraw`, solver-paid). | The player receives the price; the trader pays the price plus the fee. |
| `trade_sell` | Accepting reserves an Aura from the trader's stock in the verifier (3 min) for the player in range. One tap wraps and deposits the price plus the fee (self-paid), signs a buy `token_diff` and settles. | The player pays the price plus the fee; the trader receives the price. |
| `trade_up` | The player sends 3 common Auras to the trader account, taps "Check hand-over", and receives one rare Aura (game claim, secured on NEAR via award-signed `redeem_aura`). The commons become resale stock at cost 0. | Player transfers; server checks on-chain ownership. |
| Merchant's Ledger | After 10 settled trades with one trader, the NPC-only `ledger` edition (PR #52) is granted once. | Award claim with the `earned:npc:` prefix. |
| Keeper (Strážce Brány) | Plain-language view of the player's market balance and vaults (staked amount, contribution, earned credit, exit/unlock epoch). It never moves funds. | Read-only; actions stay on the usual confirmation screens. |

## Economics (owner decision 1 Nov 2026: the float must grow and favour the treasury)

All in `server/npc/trader-pricing.mjs` (pure, unit-tested):
- **Float:** 2 test NEAR as wNEAR in the verifier per trader.
- **Margin floor:** sells at `max(market × 0.90, cost × 1.10)` and never above the market; buys at
  `min(market × 1.15, resale / 1.10)` where resale = max(rarity reference, local floor). Without a local
  order book the player's alternative is a quick sale at 80 % of the reference.
- **Premiums only from profit:** daily premium budget = 50 % of realized 7-day profit, plus 0.1 test NEAR/day
  in the first week. A trader with a 7-day loss pays no premiums. Open buy orders can never exceed the credit.
- **Caps:** 3 trades per player per trader per day (the 4th is refused), 24 per trader per day.
- **Fee:** a trader buy costs the price plus the fee, so the purse check, the reserve for open buys and the lot's cost
  basis all use that gross amount; a sale earns the price. The margin floor holds on what the trader receives.
- **Sweep:** the keeper withdraws wNEAR above float + 0.25 buffer from the verifier (only when no buy is open,
  `ft_withdraw`), unwraps it (`near_withdraw`) and pays it into rewards `fund_rewards("sponsor",
  "npc-<id>-<yyyymmdd>-<n>")`. Each sweep is a public receipt and appears in `GET /api/npc/traders`.
- **Patron rates (GAME-LOOPS P1-5, Tier 2+, tier only, no level gate):** stock sells at `max(market × 0.85,
  cost × 1.10)`; premium buys at `min(market × 1.20, resale / 1.10)`; a patron-only 3 rares → 1 epic trade-up
  (the epic comes from game edition supply, the rares become stock at cost 0); and the premium budget prefers
  patrons: non-patrons may spend only the first 50 % of a day's budget, patrons the rest. The tier is checked
  again on accept (`NPC_TRADE_PATRON`). The margin floor, caps and sweep are unchanged, so the float still grows.

## Starting stock (keeper, every 10 min)

A new explorer should see Vojtěch's offers right away, so the keeper keeps his shelf filled:
- **Shelf:** the trader's Auras in the verifier plus in its wallet. Target **3**.
- **Mint:** when the shelf is short, one stock Aura per tick (max **3 a day**). The server signs an award claim
  `earned:npc-stock:<actor>:<yyyymmdd>:<n>` with its award key and the trader account redeems it to itself
  (`redeem_aura`, 0.05 NEAR attached, unused storage refunded). Claim ids are deterministic, so a retry returns the
  same token. The collection must already trust the server's award key (`get_award_signer`), otherwise the report
  says `skipped: award-signer`.
- **Editions:** rare and epic chest Auras only (polar, bloom, storm, moon, comet), least-stocked first. A common's
  reference (0.02) cannot carry the ~0.02 NEAR it costs to mint and escrow one with a 10 % margin. NPC/monster
  editions are claim-only and never stocked. An edition past 200 of its 256 on-chain copies is skipped.
- **Cost basis:** the NEAR the mint really took (storage + gas) plus a 0.003 escrow-gas allowance, rounded up. The
  usual rule then prices the sale at `max(market × 0.90, cost × 1.10)`, e.g. ~0.045 test NEAR for a rare.
- **Deposit:** the same tick deposits the new token into the verifier (`nft_transfer_call`, msg `""`), so the next
  encounter shows it as a `trade_sell` offer; the trader's intent is signed only when the player signs theirs.
- **Funding:** mints are paid from the trader's liquid NEAR above the 0.5 gas reserve, never from the 2 NEAR float in
  the verifier. A sweep leaves up to 0.1 NEAR (`STOCK_RESERVE`) liquid for restocking and sends the rest to the treasury.
  With too little liquid the report says `skipped: low-liquid` and restocking waits for the next sweep.
- `NPC_TRADER_STOCK=0` turns stocking off; the rest of the keeper keeps running.

## Pieces

| Piece | File |
| --- | --- |
| Pricing rules | `server/npc/trader-pricing.mjs` |
| Books (module `npc-trader` v1: trades, lots with cost basis, sweeps) | `server/npc/trader-ledger.mjs` |
| Trader keys and NEP-413 signing | `server/npc/trader-keys.mjs` |
| Offer menu (registered as the `trader` menu builder), accept, trade-up, reconcile, public books | `server/npc/trader.mjs` |
| Private pair settlement (trader intent + player intent) | `settlePair` in `server/native/intents-market.mjs` |
| Keeper worker (settle, register the key, deposit stock, sweep, restore float; every 10 min) | `server/npc/trader-keeper.mjs` |
| Routes | `server/npc/trader-routes.mjs` |
| Client (one-tap deposit, sign and settle) | `src/NpcSheet.tsx`, `src/npc-client.ts`, `fillOnChain` in `src/chain-trades.ts` |

Routes: `POST /api/actors/:id/offers/(trade_buy|trade_sell|trade_up):<hex>/accept`,
`POST /api/npc/trades/fill {tradeId, signed}` (the player's signed `token_diff` for an accepted buy or sale),
`POST /api/actors/:id/offers/trade_up:<hex>/complete`, `POST /api/actors/:id/keeper`, `GET /api/npc/traders`.

If a fill stops after it was sent, the trade keeps the trader's nonce; the next reconcile sees it used on the
verifier and books the trade. An unsigned deal lapses at its deadline, and a deal accepted before a fee change
must be accepted again.

## Turning it on (operator, testnet)

The traders open when `ACTORS_ENABLED=1`, the NEAR Intents verifier is deployed
(`public/native-intents-testnet.json`) and the private file `npc-traders.json` exists in the state directory (`/var/lib/questlayer-hackathon/` on the VPS; override with `NPC_TRADERS_PATH`).
`NPC_TRADER_ENABLED=0` turns them off. No other runtime.env change is needed.

On the Mac, one command per step:
1. `node scripts/npc-trader-testnet.mjs setup` (dry run, shows the plan)
2. `node scripts/npc-trader-testnet.mjs setup --execute` creates `npc-kupec-vojtech.<operator>.testnet` with
   2.6 test NEAR, registers the intent-signing key on the verifier (`add_public_key`) and deposits the 2 NEAR float
   as wNEAR; keys go to `.data/npc-traders.json` (600).
3. `bash scripts/install-npc-traders-vps.sh` installs the file on the VPS, then deploy/restart.
4. `node scripts/npc-trader-testnet.mjs status` shows the purse, stock, key and anything left in market v2.
   Emergency stop: set `NPC_TRADER_ENABLED=0`, then `node scripts/npc-trader-testnet.mjs cancel-all --execute`
   removes the signing key from the verifier (the keeper would add it back while the traders run).

**Moving an existing trader off market v2 (once, 4 Nov 2026):** after the deploy,
`node scripts/npc-trader-testnet.mjs leave-market` (dry run), then `... leave-market --execute` cancels the
trader's market v2 listings (the Auras come back to its wallet) and withdraws its market credit. The keeper then
registers the key, deposits the Auras and the float into the verifier on its next ticks. Nothing else changes.

The file holds two keys per trader: the **signing key** registered on the verifier (it can only move what the
trader holds in the verifier) and the trader **account key**, which the keeper uses for the key registration,
deposits, sweeps and the float. Without the account key the keeper only reports what it would do.

## Known limits

- The NPC sheet does the trade-up hand-over (three relayed `nft_transfer`s), settles trader buys and sales on NEAR
  Intents in one tap and secures the trade-up payout as an NFT. Every trade carries its tx hashes; see
  `docs/ONCHAIN-TRADES.md`.
- Buys and sales are signed with the explorer's device key. An Aura held by another linked wallet has to move to
  the explorer account before a trader can buy it in the NPC sheet.
