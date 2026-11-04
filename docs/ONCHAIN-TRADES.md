# Every trade on NEAR (4 Nov 2026)

Owner decision 4 Nov 2026 01:34 UTC: every exchange of anything, NPC trades included, happens on chain.
Testnet only. Part 3 of the "everything on NEAR" plan.

| Trade | Before | Now |
| --- | --- | --- |
| Practice market (Aura for practice GOLD) | game database (`listings`) | **closed.** `POST /api/market/list` and `/api/market/buy` answer `410 MARKET_ON_CHAIN`; open database listings are cancelled at boot (the Auras never left their owners). "Sell" in the collection secures the Aura as an NFT (relayed `redeem_aura`, no fee) and lists it on the market contract for test NEAR (`nft_transfer_call` with a price). The Market tab shows only Secured and Offers; a stored `practice` view opens Secured. `PRACTICE_MARKET=db` brings the old market back for local tests only. |
| NPC trader buy (`trade_buy`) | trader-signed v2 buy order, filled in Market → Signed offers | same order, now filled **in the NPC sheet in one tap**: escrow (`nft_transfer_call {"deposit":true}`, relayed) then `fill_buy_order` (self-paid). |
| NPC trader sale (`trade_sell`) | trader-signed v2 sell order, filled in Market → Signed offers | filled in the NPC sheet with `fill_sell_order` (self-paid, the price is the deposit). |
| NPC trade-up (3 → 1) | player had to `nft_transfer` the Auras outside the app | the sheet sends the three `nft_transfer`s to the trader account (the relayer sponsors exactly the Auras of the player's issued trade-up), the server checks ownership on chain, and the paid-out Aura is **secured as an NFT right away** (award claim redeemed by the player's account). |

NPC traders keep their rules (`server/npc/trader-pricing.mjs`): the margin floor, premiums only from profit and the
surplus sweep into the rewards treasury, so every NPC trade still favours the game treasury.

## On-chain proof (for the explorer link)

- `NpcTrade` views (accept, complete, `GET /api/npc/trades`) carry `txHash` (the fill, or the last hand-over) and
  `txHashes` (all steps). Trade-ups also carry `handovers` (`tokenId → hash`) and `secureItemId`.
- Fill hashes come from the signed-order index (`signed_market_orders.settlement_tx`, read from final receipts).
  Relayed hand-over hashes come from the relayer's own `relay_jobs`. A wallet-signed step is reported with
  `POST /api/npc/trades/tx {tradeId, transactionHash}`; the server reads the final transaction and checks signer,
  receiver, method and token before it stores anything.
- History rows of kind `npc-trade` carry `meta.txHash`, `meta.txHashes` and `meta.network` ("testnet"), so a
  ChainLink icon can link `https://testnet.nearblocks.io/txns/<hash>`.
- The NPC sheet shows an "On NEAR:" line with explorer links for the trades of the encounter.

## Pieces

| Piece | File |
| --- | --- |
| Trade proof, `recordTx`, `handoversFor`, `myTrades` | `server/npc/trader.mjs`, `server/npc/trader-ledger.mjs` |
| Routes `GET /api/npc/trades`, `POST /api/npc/trades/tx` | `server/npc/trader-routes.mjs` |
| Sponsored trade-up hand-over (`tradeUpHandovers` policy context) | `server/relayer/policy.mjs`, wiring in `server/index.mjs` |
| Database market closed | `server/index.mjs` (`PRACTICE_MARKET_ON_CHAIN`) |
| Client on-chain steps | `src/chain-trades.ts`, `src/NpcSheet.tsx`, registration in `src/App.tsx` |
| Sell from the collection on NEAR | `src/Inventory.tsx`, `onSell` in `src/App.tsx` |

## Not yet on chain

- Altar crafting (shards + Aura → Aura, `server/actors/hunt`) and practice-GOLD tasks stay in the game database
  until the QGOLD/QXP token from part 1 lands.
- NEAR Intents for the market is part 5 (its own thread); NPC traders as Intents solvers build on this.
