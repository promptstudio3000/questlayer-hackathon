# NPC traders and the vault keeper (N3)

Implements slice N3 of `docs/NPC-PLAN.md` (§2.2, §2.3, §6, §11.3). **Testnet only.**

## What players get

| Offer | What happens | Who signs / pays |
| --- | --- | --- |
| `trade_buy` (premium buy) | The trader signs a market v2 **buy** order for one exact token of a "wanted" edition the player owns (10 min). Only the token's owner can fill it. In Market → Signed offers the player taps "Hand to the market and accept" (escrow, then `fill_buy_order`). | Trader signs the order; player fills (self-paid 1 yocto). |
| `trade_sell` | The trader signs a **sell** order for an Aura from its escrowed stock (3 min), only after the player in range accepts. | Player fills with `fill_sell_order` and pays the price. |
| `trade_up` | The player sends 3 common Auras to the trader account, taps "Check hand-over", and receives one rare Aura (game claim, secured on NEAR via award-signed `redeem_aura`). The commons become resale stock at cost 0. | Player transfers; server checks on-chain ownership. |
| Merchant's Ledger | After 10 settled trades with one trader, the NPC-only `ledger` edition (PR #52) is granted once. | Award claim with the `earned:npc:` prefix. |
| Keeper (Strážce Brány) | Plain-language view of the player's market balance and vaults (staked amount, contribution, earned credit, exit/unlock epoch). It never moves funds. | Read-only; actions stay on the usual confirmation screens. |

## Economics (owner decision 1 Nov 2026: the float must grow and favour the treasury)

All in `server/npc/trader-pricing.mjs` (pure, unit-tested):
- **Float:** 2 test NEAR market credit per trader (`deposit_near`).
- **Margin floor:** sells at `max(market × 0.90, cost × 1.10)` and never above the market; buys at
  `min(market × 1.15, resale / 1.10)` where resale = max(rarity reference, local floor). Without a local
  order book the player's alternative is a quick sale at 80 % of the reference.
- **Premiums only from profit:** daily premium budget = 50 % of realized 7-day profit, plus 0.1 test NEAR/day
  in the first week. A trader with a 7-day loss pays no premiums. Open buy orders can never exceed the credit.
- **Caps:** 3 trades per player per trader per day (the 4th is refused), 24 per trader per day.
- **Sweep:** the keeper withdraws credit above float + 0.25 buffer (only when no buy order is open) and pays it into
  rewards `fund_rewards("sponsor", "npc-<id>-<yyyymmdd>-<n>")`, then re-deposits the float. Each sweep is a
  public receipt and appears in `GET /api/npc/traders`.
- **Patron rates (GAME-LOOPS P1-5, Tier 2+, tier only, no level gate):** stock sells at `max(market × 0.85,
  cost × 1.10)`; premium buys at `min(market × 1.20, resale / 1.10)`; a patron-only 3 rares → 1 epic trade-up
  (the epic comes from game edition supply, the rares become stock at cost 0); and the premium budget prefers
  patrons: non-patrons may spend only the first 50 % of a day's budget, patrons the rest. The tier is checked
  again on accept (`NPC_TRADE_PATRON`). The margin floor, caps and sweep are unchanged, so the float still grows.

## Starting stock (keeper, every 10 min)

A new explorer should see Vojtěch's offers right away, so the keeper keeps his shelf filled:
- **Shelf:** the trader's Auras in market escrow plus in its wallet. Target **3**, the market's limit of active
  listings/deposits per account.
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
- **Escrow:** the same tick escrows the new token (`nft_transfer_call {"deposit":true}`), so the next encounter shows
  it as a `trade_sell` offer; the sell order itself is signed per player after they accept (3 min).
- **Funding:** mints are paid from the trader's liquid NEAR above the 0.5 gas reserve, never from the 2 NEAR market
  float. A sweep leaves up to 0.1 NEAR (`STOCK_RESERVE`) liquid for restocking and sends the rest to the treasury.
  With too little liquid the report says `skipped: low-liquid` and restocking waits for the next sweep.
- `NPC_TRADER_STOCK=0` turns stocking off; the rest of the keeper keeps running.

## Pieces

| Piece | File |
| --- | --- |
| Pricing rules | `server/npc/trader-pricing.mjs` |
| Books (module `npc-trader` v1: trades, lots with cost basis, sweeps) | `server/npc/trader-ledger.mjs` |
| Trader keys and NEP-413 signing | `server/npc/trader-keys.mjs` |
| Offer menu (registered as the `trader` menu builder), accept, trade-up, reconcile, public books | `server/npc/trader.mjs` |
| Keeper worker (settle, restock escrow, sweep, restore float; every 10 min) | `server/npc/trader-keeper.mjs` |
| Routes | `server/npc/trader-routes.mjs` |
| Client | `src/NpcSheet.tsx`, `src/npc-client.ts`, `src/SignedOrdersPanel.tsx` (escrow-then-accept) |

Routes: `POST /api/actors/:id/offers/(trade_buy|trade_sell|trade_up):<hex>/accept`,
`POST /api/actors/:id/offers/trade_up:<hex>/complete`, `POST /api/actors/:id/keeper`, `GET /api/npc/traders`.

## Turning it on (operator, testnet)

The traders open when `ACTORS_ENABLED=1`, the market is v2 and the private file `npc-traders.json` exists in the
state directory (`/var/lib/questlayer-hackathon/` on the VPS; override with `NPC_TRADERS_PATH`).
`NPC_TRADER_ENABLED=0` turns them off. No other runtime.env change is needed.

On the Mac, one command per step:
1. `node scripts/npc-trader-testnet.mjs setup` (dry run, shows the plan)
2. `node scripts/npc-trader-testnet.mjs setup --execute` creates `npc-kupec-vojtech.<operator>.testnet` with
   2.6 test NEAR, registers the order-signing key and deposits the 2 NEAR float; keys go to `.data/npc-traders.json` (600).
3. `bash scripts/install-npc-traders-vps.sh` installs the file on the VPS, then deploy/restart.
4. `node scripts/npc-trader-testnet.mjs status` shows float, stock and keys. Emergency stop:
   `node scripts/npc-trader-testnet.mjs cancel-all --execute` voids every outstanding NPC order.

The file holds two keys per trader: the market **signing key** (can only commit the trader's market credit) and the
trader **account key**, which the keeper uses for escrow, sweeps and the float. Without the account key the keeper
only reports what it would do.

## Known limits

- Trade-up hand-over is a plain `nft_transfer` to the trader account; the in-app transfer button is a follow-up
  (today the sheet names the tokens and the receiver).
- v2 sell orders can be filled by anyone who sees them, and the order appears in the public order book so the player
  can fill it from Market → Signed offers. The 3-minute deadline keeps the gap small; the price never breaks the
  margin floor whoever fills it. The optional v3 `taker` field (§6.4) would bind it to one player.
